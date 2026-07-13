import dns from "dns";
dns.setDefaultResultOrder("ipv6first");

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "dist")));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RAILRADAR_API_KEY = process.env.RAILRADAR_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "dummy_key");

const hasKey = (key) => key && !key.startsWith("your_") && key.trim() !== "";
const hasGemini = () => hasKey(GEMINI_API_KEY);
const hasRailRadar = () => hasKey(RAILRADAR_API_KEY);

const parseJson = (text) => {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
};

const geminiError = (err) => {
  const msg = err?.message || String(err);
  if (msg.includes("429") || msg.includes("quota")) return "Gemini quota exceeded — wait a few minutes or check your usage at ai.google.dev";
  if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID")) return "Invalid GEMINI_API_KEY — get a new key from aistudio.google.com/apikey";
  if (msg.includes("fetch failed")) return "Cannot reach Gemini API — check your internet connection";
  if (msg.includes("not found") || msg.includes("404")) return `Gemini model "${GEMINI_MODEL}" not available — set GEMINI_MODEL=gemini-2.5-flash in .env`;
  if (err instanceof SyntaxError) return "Gemini returned invalid JSON — please try again";
  return "Gemini error: " + msg;
};

const railRadarError = (response, err, body) => {
  if (err) return "RailRadar network error — " + err.message;
  if (!hasRailRadar()) return "RailRadar key not set — add RAILRADAR_API_KEY to .env for live train data";
  if (response?.status === 429) return "RailRadar rate limit reached";
  if (response?.status === 401 || response?.status === 403) return "RailRadar key invalid or subscription expired";
  const apiMsg = body?.message || body?.error;
  if (response && !response.ok) return `RailRadar error (HTTP ${response.status})${apiMsg ? ": " + apiMsg : ""}`;
  if (body?.data?.trains?.length === 0) return "RailRadar found no trains for this route";
  return "RailRadar returned no data for this request";
};

const estimateFare = (classCode, distanceKm = 800) => {
  const rates = { "1A": [5.2, 1200], "2A": [3.2, 700], "3A": [2.2, 500], CC: [1.8, 300] };
  const [rate, base] = rates[classCode] || [0.9, 120];
  return Math.round(base + distanceKm * rate);
};

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    geminiConfigured: hasGemini(),
    liveTrainsConfigured: hasRailRadar(),
    geminiModel: GEMINI_MODEL,
  });
});

// Step 1: Get trip metadata (coordinates, budget, food, trains station codes)
app.post("/api/trip-meta", async (req, res) => {
  const { source, destination, days, groupType, groupSize } = req.body;

  if (!source?.trim() || !destination?.trim()) {
    return res.status(400).json({ error: "Source and destination are required.", source: "gemini" });
  }
  if (!hasGemini()) {
    return res.status(503).json({
      error: "Gemini API key is missing — add GEMINI_API_KEY to your .env file",
      source: "gemini",
      geminiError: "GEMINI_API_KEY is not configured on the server",
    });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });

    let preferenceInstruction = "";
    if (groupType === "solo") {
      preferenceInstruction = "Select places, attractions, and budget recommendations tailored specifically for a solo traveler (e.g., social hubs, backpacker cafes, group walking tours, safe neighborhoods, and budget-friendly public transport options).";
    } else if (groupType === "couple") {
      preferenceInstruction = "Select places, attractions, and budget recommendations tailored specifically for a couple (e.g., romantic views, scenic spots, cozy cafes/restaurants, couple-friendly activities, and mid-range to premium options).";
    } else if (groupType === "family") {
      preferenceInstruction = "Select places, attractions, and budget recommendations tailored specifically for friends/family (e.g., group-friendly landmarks, amusement parks, spacious lodging, family-friendly restaurants, and multi-passenger transport options).";
    }

    const prompt = `Plan a trip from "${source}" to "${destination}" for ${days} days, ${groupSize} travelers (${groupType}).
${preferenceInstruction}
Return JSON only:
{
  "source": { "name": "string", "lat": number, "lng": number, "stationCode": "e.g. NDLS" },
  "destination": { "name": "string", "lat": number, "lng": number, "stationCode": "e.g. MAO" },
  "distanceKm": number,
  "hotelAvgPriceINR": number,
  "famousFoods": [{ "name": "string", "description": "string" }],
  "placesToVisit": [{ "name": "string", "description": "string", "lat": number, "lng": number }],
  "souvenirs": [{ "name": "string", "description": "string" }],
  "budget": { "transport": number, "lodging": number, "food": number, "shopping": number }
}
Use accurate coordinates and nearest major railway station codes.`;

    const result = await model.generateContent(prompt);
    res.json(parseJson(result.response.text()));
  } catch (err) {
    console.error("/api/trip-meta:", err);
    const message = geminiError(err);
    res.status(500).json({ error: message, source: "gemini", geminiError: message });
  }
});

// Step 2: Stream day-by-day itinerary
app.post("/api/stream-itinerary", async (req, res) => {
  const { source, destination, days, groupType, groupSize, metaData } = req.body;

  if (!source?.trim() || !destination?.trim()) {
    return res.status(400).json({ error: "Source and destination are required." });
  }
  if (!hasGemini()) {
    return res.status(503).json({ error: "Gemini API key is missing — add GEMINI_API_KEY to .env", geminiError: "GEMINI_API_KEY is not configured on the server" });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const places = metaData?.placesToVisit?.map((p) => p.name).join(", ") || "";

    let preferenceInstruction = "";
    if (groupType === "solo") {
      preferenceInstruction = "Focus on solo-traveler safety, meeting other travelers at social hubs like backpacker cafes or walking tours, self-guided walking routes, and budget-friendly navigation.";
    } else if (groupType === "couple") {
      preferenceInstruction = "Focus on romantic sights, sunset viewing, private experiences, scenic cafes, couples' activities, and relaxed travel pacing.";
    } else if (groupType === "family") {
      preferenceInstruction = "Focus on group-friendly activities, comfortable travel options, family restaurants, places suitable for kids/seniors, and balanced, easy pacing.";
    }

    const prompt = `Write a ${days}-day travel itinerary from ${source} to ${destination} for ${groupSize} travelers (${groupType}).
${places ? `Include these places: ${places}.` : ""}
${preferenceInstruction} Tailor the tone, pace, and recommendations of the itinerary to fit this group.
Use Markdown with # headings. Cover: how to get there, day-by-day plan, and 3 practical tips.`;

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(text);
    }
    res.end();
  } catch (err) {
    console.error("/api/stream-itinerary:", err);
    res.write("ERROR: " + geminiError(err));
    res.end();
  }
});

// Step 3: Get trains — RailRadar first, then Gemini simulation fallback
app.get("/api/trains", async (req, res) => {
  const { from, to, distance } = req.query;
  if (!from || !to) return res.status(400).json({ error: "'from' and 'to' station codes required." });

  const distanceKm = parseInt(distance) || 800;
  let railRadarErr = null;

  // 1. Try RailRadar
  if (hasRailRadar()) {
    try {
      const response = await fetch(
        `https://api.railradar.in/v1/trains/between/${from}/${to}`,
        {
          headers: {
            "Authorization": `Bearer ${RAILRADAR_API_KEY}`
          }
        }
      );
      const body = await response.json().catch(() => null);

      if (response.ok && body?.success && body?.data?.trains?.length > 0) {
        const trains = body.data.trains.map((t) => ({
          train_number: t.number,
          train_name: t.name,
          from_station_name: body.data.fromStation?.name || from,
          to_station_name: body.data.toStation?.name || to,
          duration: t.journeySegment?.travelTime || "N/A",
          depart_time: t.journeySegment?.departureTime || "N/A",
          arrival_time: t.journeySegment?.arrivalTime || "N/A",
          run_days: Array.isArray(t.runDays) ? t.runDays.map(d => d.toUpperCase()).join(", ") : "Daily",
          classes: t.classes || ["SL", "3A", "2A"],
        }));
        return res.json({ source: "railradar", trains, trainApiError: null, geminiError: null });
      }
      railRadarErr = railRadarError(response, null, body);
    } catch (err) {
      railRadarErr = railRadarError(null, err);
    }
  } else {
    railRadarErr = "RailRadar key not configured in .env";
  }

  // 2. Fallback to Gemini AI simulation
  if (!hasGemini()) {
    return res.status(503).json({
      error: "No train data available.",
      source: "none",
      trainApiError: railRadarErr,
      geminiError: "GEMINI_API_KEY missing — cannot simulate trains.",
    });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });
    const result = await model.generateContent(
      `Return JSON array of 4 realistic trains between station ${from} and ${to}.
Format: [{ "train_number", "train_name", "from_station_name", "to_station_name", "duration", "depart_time", "arrival_time", "run_days", "classes": ["SL","3A","2A"] }]`
    );
    const trains = parseJson(result.response.text());
    res.json({ source: "gemini-simulated", trains, trainApiError: railRadarErr, geminiError: null });
  } catch (err) {
    const geminiErr = geminiError(err);
    res.status(502).json({
      error: "Could not load trains — both RailRadar and Gemini failed",
      source: "none",
      trainApiError: railRadarErr,
      geminiError: geminiErr,
    });
  }
});

// Get fare for one train class — Estimated using local logic since RailRadar doesn't support fares
app.get("/api/fare", (req, res) => {
  const { classCode, distance } = req.query;
  if (!classCode) {
    return res.status(400).json({ error: "classCode required." });
  }

  const distanceKm = parseInt(distance) || 800;
  res.json({
    source: "estimated",
    fare: estimateFare(classCode, distanceKm),
    trainApiError: null,
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`TripCraft server running on http://localhost:${PORT}`);
});
