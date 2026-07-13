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
const STREAM_ERROR_PREFIX = "__TRIPCRAFT_ERROR__:";

app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.use(express.static(path.join(__dirname, "dist")));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not defined in the environment variables!");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "dummy_key");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const sendError = (res, status, message, extra = {}) => {
  res.status(status).json({ error: message, ...extra });
};

const formatGeminiError = (error) => {
  const msg = error?.message || String(error);
  if (msg.includes("fetch failed") || msg.includes("UND_ERR_CONNECT_TIMEOUT")) {
    return "Gemini network error: cannot reach Google API. Check your internet connection or firewall.";
  }
  if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID")) {
    return "Gemini API key is invalid. Get a new key from https://aistudio.google.com/apikey";
  }
  if (msg.includes("429") || msg.includes("quota") || msg.includes("Quota")) {
    return "Gemini API quota exceeded. Wait a few minutes or enable billing at https://ai.google.dev";
  }
  if (msg.includes("not found") || msg.includes("404")) {
    return `Gemini model "${GEMINI_MODEL}" is not available. Set GEMINI_MODEL in .env (try gemini-2.5-flash).`;
  }
  return "Gemini API error: " + msg;
};

const formatRapidApiError = (response, body, err) => {
  if (err) {
    if (err.message?.includes("fetch failed")) {
      return "RapidAPI network error: could not reach IRCTC API. Check your internet connection.";
    }
    return "RapidAPI request failed: " + err.message;
  }
  if (!response) {
    return "RapidAPI key is not configured.";
  }
  const status = response.status;
  const apiMessage = body?.message || body?.error || body?.status_message;
  if (status === 401 || status === 403) {
    return `RapidAPI authentication failed (${status}): invalid or expired RAPIDAPI_KEY. Check your RapidAPI subscription.`;
  }
  if (status === 429) {
    return "RapidAPI rate limit exceeded. Wait before retrying or upgrade your RapidAPI plan.";
  }
  if (status === 404) {
    return "RapidAPI endpoint not found. The IRCTC API subscription may have changed.";
  }
  if (!response.ok) {
    return `RapidAPI returned HTTP ${status}${apiMessage ? ": " + apiMessage : ""}`;
  }
  if (body && body.status === false) {
    return "RapidAPI returned no data: " + (apiMessage || "no trains or fares found for this route.");
  }
  if (body?.data && Array.isArray(body.data) && body.data.length === 0) {
    return `RapidAPI found no trains between these stations on ${body.dateOfJourney || "the selected date"}.`;
  }
  if (body?.data === null || body?.data === undefined) {
    return "RapidAPI returned an empty response for this query.";
  }
  return "RapidAPI returned no usable data for this request.";
};

const parseGeminiJson = (text) => {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
};

const validateTripInput = (body) => {
  const { source, destination, days, groupType, groupSize } = body;
  if (!source?.trim() || !destination?.trim()) {
    return "Source and destination are required.";
  }
  if (source.trim().length > 120 || destination.trim().length > 120) {
    return "Source and destination must be under 120 characters.";
  }
  const numDays = Number(days);
  if (!Number.isInteger(numDays) || numDays < 1 || numDays > 30) {
    return "Days must be an integer between 1 and 30.";
  }
  const allowedGroups = ["solo", "couple", "family"];
  if (groupType && !allowedGroups.includes(groupType)) {
    return "groupType must be solo, couple, or family.";
  }
  const size = Number(groupSize);
  if (!Number.isInteger(size) || size < 1 || size > 20) {
    return "groupSize must be an integer between 1 and 20.";
  }
  return null;
};

const estimateFare = (classCode, distanceKm) => {
  const dist = Number(distanceKm) || 800;
  let ratePerKm = 0.9;
  let basePrice = 120;
  switch (classCode) {
    case "1A": ratePerKm = 5.2; basePrice = 1200; break;
    case "2A": ratePerKm = 3.2; basePrice = 700; break;
    case "3A": ratePerKm = 2.2; basePrice = 500; break;
    case "CC": ratePerKm = 1.8; basePrice = 300; break;
    default: break;
  }
  return Math.round(basePrice + dist * ratePerKm);
};

const buildFareEstimates = (trains, distanceKm) => {
  const estimates = {};
  for (const train of trains || []) {
    for (const cls of train.classes || []) {
      const key = `${train.train_number}-${cls}`;
      estimates[key] = { fare: estimateFare(cls, distanceKm), source: "estimated" };
    }
  }
  return estimates;
};

const isGeminiConfigured = () => {
  return (
    GEMINI_API_KEY &&
    GEMINI_API_KEY !== "dummy_key" &&
    GEMINI_API_KEY !== "your_gemini_api_key_here" &&
    !GEMINI_API_KEY.startsWith("your_") &&
    GEMINI_API_KEY.trim() !== ""
  );
};

const isRapidApiConfigured = () => {
  const key = process.env.RAPIDAPI_KEY;
  return (
    key &&
    key !== "your_rapidapi_key_here" &&
    !key.startsWith("your_") &&
    key.trim() !== ""
  );
};

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    geminiConfigured: isGeminiConfigured(),
    rapidApiConfigured: isRapidApiConfigured(),
    geminiModel: GEMINI_MODEL,
  });
});

app.post("/api/trip-meta", async (req, res) => {
  const validationError = validateTripInput(req.body);
  if (validationError) {
    return sendError(res, 400, validationError);
  }

  if (!isGeminiConfigured()) {
    return sendError(res, 503, "Gemini API key is not configured. Add GEMINI_API_KEY to your server .env file.", {
      source: "gemini",
      geminiError: "GEMINI_API_KEY is missing or uses a placeholder value.",
    });
  }

  const { source, destination, days, groupType, groupSize } = req.body;

  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });

    const prompt = `You are a professional travel geographer and planner. Prepare structured metadata for a trip from "${source.trim()}" to "${destination.trim()}" for ${days} days, for a group of ${groupSize} person(s) (${groupType}).
CRITICAL FOR stationCode: Identify the best-connected major railway stations near the source and destination (e.g., if source is "Siliguri", use "NJP"; if destination is "Rishikesh", use "HW" or "DDN").
Return a JSON object matching this schema:
{
  "source": { "name": "Source City Name", "lat": number, "lng": number, "stationCode": "e.g. NDLS" },
  "destination": { "name": "Destination City Name", "lat": number, "lng": number, "stationCode": "e.g. MAO" },
  "distanceKm": number,
  "hotelAvgPriceINR": number,
  "famousFoods": [{ "name": "Food Name", "description": "Brief description" }],
  "placesToVisit": [{ "name": "Attraction", "description": "Short description", "lat": number, "lng": number }],
  "souvenirs": [{ "name": "Item Name", "description": "Why it is unique" }],
  "budget": { "transport": number, "lodging": number, "food": number, "shopping": number }
}
Return only valid JSON. Use accurate coordinates for Leaflet maps.`;

    const result = await model.generateContent(prompt);
    const parsedData = parseGeminiJson(result.response.text());
    res.json({ ...parsedData, source: "gemini", model: GEMINI_MODEL });
  } catch (error) {
    console.error("Error in /api/trip-meta:", error);
    const geminiError = formatGeminiError(error);
    const status = error instanceof SyntaxError ? 502 : 500;
    const message = error instanceof SyntaxError
      ? "Gemini returned invalid JSON. Please try again."
      : geminiError;
    sendError(res, status, message, { source: "gemini", geminiError: message });
  }
});

app.post("/api/stream-itinerary", async (req, res) => {
  const validationError = validateTripInput(req.body);
  if (validationError) {
    return sendError(res, 400, validationError);
  }

  if (!isGeminiConfigured()) {
    return sendError(res, 503, "Gemini API key is not configured.", {
      source: "gemini",
      geminiError: "GEMINI_API_KEY is missing or uses a placeholder value.",
    });
  }

  const { source, destination, days, groupType, groupSize, metaData } = req.body;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const placesHint = metaData?.placesToVisit?.length
      ? `Key places to include: ${metaData.placesToVisit.map((p) => p.name).join(", ")}.`
      : "";
    const foodHint = metaData?.famousFoods?.length
      ? `Local foods to mention: ${metaData.famousFoods.map((f) => f.name).join(", ")}.`
      : "";

    const prompt = `You are an expert travel coordinator. Write a detailed day-by-day travel itinerary from "${source.trim()}" to "${destination.trim()}".
Trip details: ${days} days, ${groupSize} traveler(s), group type: ${groupType}.
${placesHint}
${foodHint}

Structure the response in Markdown:
# ${days}-Day Trip: ${source} to ${destination}
## Getting There
Compare flight, train, and road options. Include connecting routes if no direct service exists.
## Day-by-Day Plan
Write one section per day (Day 1, Day 2, etc.) with morning/afternoon/evening activities, meals, and travel between locations.
## Practical Tips
3-5 brief tips for this specific trip (budget, weather, local transport, booking).

Use #, ##, ###, **bold**, and bullet lists. Be practical and specific to this route.`;

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) res.write(chunkText);
    }
    res.end();
  } catch (error) {
    console.error("Error in /api/stream-itinerary:", error);
    const geminiError = formatGeminiError(error);
    res.write(STREAM_ERROR_PREFIX + geminiError);
    res.end();
  }
});

app.get("/api/trains", async (req, res) => {
  const { from, to, date, distance } = req.query;

  if (!from || !to) {
    return sendError(res, 400, "Query params 'from' and 'to' station codes are required.");
  }

  const travelDate = date || new Date().toISOString().split("T")[0];
  const distanceKm = parseInt(distance) || 800;
  let rapidApiAttempted = false;
  let rapidApiError = null;

  if (isRapidApiConfigured()) {
    rapidApiAttempted = true;
    try {
      console.log(`Fetching live trains from RapidAPI: ${from} -> ${to} on ${travelDate}`);
      const response = await fetch(
        `https://irctc1.p.rapidapi.com/api/v3/trainBetweenStations?fromStationCode=${from}&toStationCode=${to}&dateOfJourney=${travelDate}`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": process.env.RAPIDAPI_KEY,
            "x-rapidapi-host": "irctc1.p.rapidapi.com",
          },
        }
      );

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.ok && body?.status && body?.data?.length > 0) {
        const normalized = body.data.map((t) => ({
          train_number: t.train_number,
          train_name: t.train_name,
          from_station_name: t.from_station_name,
          to_station_name: t.to_station_name,
          duration: t.duration,
          depart_time: t.from_std || t.depart_time,
          arrival_time: t.to_std || t.arrival_time,
          run_days: Array.isArray(t.run_days) ? t.run_days.join(", ") : t.run_days,
          classes: t.class_type || t.classes || [],
        }));
        return res.json({
          source: "rapidapi",
          trains: normalized,
          rapidApiAttempted: true,
          rapidApiError: null,
          geminiAttempted: false,
          geminiError: null,
          fareEstimates: buildFareEstimates(normalized, distanceKm),
          travelDate,
        });
      }

      rapidApiError = formatRapidApiError(response, body, null);
      console.warn("RapidAPI trains failed:", rapidApiError);
    } catch (err) {
      rapidApiError = formatRapidApiError(null, null, err);
      console.error("RapidAPI trains exception:", rapidApiError);
    }
  } else {
    rapidApiError = "RapidAPI key is not configured. Add RAPIDAPI_KEY to your server .env file.";
  }

  if (!isGeminiConfigured()) {
    return sendError(res, 503, "Train lookup failed: RapidAPI unavailable and Gemini is not configured.", {
      source: "none",
      rapidApiAttempted,
      rapidApiError,
      geminiAttempted: false,
      geminiError: "GEMINI_API_KEY is missing or uses a placeholder value.",
    });
  }

  let geminiAttempted = true;
  try {
    console.log(`Falling back to Gemini train simulation: ${from} -> ${to}`);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });

    const prompt = `Return a JSON array of 4 realistic Indian Railways trains between station code "${from}" and "${to}".
If no direct trains exist, include connecting trains via major junctions.
Schema:
[{ "train_number": "string", "train_name": "string", "from_station_name": "string", "to_station_name": "string", "duration": "string", "depart_time": "string", "arrival_time": "string", "run_days": "string", "classes": ["SL","3A","2A","1A"] }]
Return only valid JSON.`;

    const result = await model.generateContent(prompt);
    const trains = parseGeminiJson(result.response.text());
    if (!Array.isArray(trains)) {
      throw new Error("Gemini returned non-array train data.");
    }

    return res.json({
      source: "gemini-simulated",
      trains,
      rapidApiAttempted,
      rapidApiError,
      geminiAttempted: true,
      geminiError: null,
      fareEstimates: buildFareEstimates(trains, distanceKm),
      travelDate,
    });
  } catch (error) {
    console.error("Gemini train simulation failed:", error);
    const geminiError = error instanceof SyntaxError
      ? "Gemini returned invalid JSON for train simulation."
      : formatGeminiError(error);
    return sendError(res, 502, "Train lookup failed on both RapidAPI and Gemini.", {
      source: "none",
      rapidApiAttempted,
      rapidApiError,
      geminiAttempted,
      geminiError,
    });
  }
});

app.get("/api/fare", async (req, res) => {
  const { trainNo, from, to, classCode, distance } = req.query;

  if (!trainNo || !from || !to || !classCode) {
    return sendError(res, 400, "Query params trainNo, from, to, and classCode are required.");
  }

  const distanceKm = parseInt(distance) || 800;
  let rapidApiAttempted = false;
  let rapidApiError = null;

  if (isRapidApiConfigured()) {
    rapidApiAttempted = true;
    try {
      console.log(`Fetching live fare from RapidAPI: train ${trainNo}, class ${classCode}`);
      const response = await fetch(
        `https://irctc1.p.rapidapi.com/api/v2/getFare?trainNo=${trainNo}&fromStationCode=${from}&toStationCode=${to}&classCode=${classCode}&quota=GN`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": process.env.RAPIDAPI_KEY,
            "x-rapidapi-host": "irctc1.p.rapidapi.com",
          },
        }
      );

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.ok && body?.status && body?.data) {
        return res.json({
          source: "rapidapi",
          fare: body.data.fare || body.data.baseFare || estimateFare(classCode, distanceKm),
          className: body.data.className || classCode,
          rapidApiAttempted: true,
          rapidApiError: null,
        });
      }

      rapidApiError = formatRapidApiError(response, body, null);
      console.warn("RapidAPI fare failed:", rapidApiError);
    } catch (err) {
      rapidApiError = formatRapidApiError(null, null, err);
      console.error("RapidAPI fare exception:", rapidApiError);
    }
  } else {
    rapidApiError = "RapidAPI key is not configured. Using distance-based fare estimate.";
  }

  res.json({
    source: "estimated",
    fare: estimateFare(classCode, distanceKm),
    className: classCode,
    rapidApiAttempted,
    rapidApiError,
  });
});

app.get(/^(?!\/api|\/health).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`TripCraft server is running on port ${PORT}`);
});
