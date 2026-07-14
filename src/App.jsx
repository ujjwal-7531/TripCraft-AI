import React, { useState, useEffect, useRef } from "react";
import {
  Compass, MapPin, Train, Utensils, Gift, DollarSign,
  Calendar, Users, AlertCircle, ArrowRight,
  Download, RefreshCw, X,
} from "lucide-react";
import MapComponent from "./components/MapComponent";

const parseInlineMarkdown = (text) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const parseMarkdownToJSX = (text) => {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, idx) => {
    if (line.startsWith("# ")) {
      return (
        <h3 key={idx} className="text-base font-bold text-white mt-4 mb-2 first:mt-0">
          {parseInlineMarkdown(line.slice(2))}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h4 key={idx} className="text-sm font-bold text-white mt-3 mb-1">
          {parseInlineMarkdown(line.slice(3))}
        </h4>
      );
    }
    if (line.startsWith("### ")) {
      return (
        <h5 key={idx} className="text-xs font-bold text-slate-200 mt-2 mb-1">
          {parseInlineMarkdown(line.slice(4))}
        </h5>
      );
    }
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      const content = line.trim().slice(2);
      return (
        <li key={idx} className="ml-4 list-disc text-sm text-slate-300 leading-relaxed mb-1">
          {parseInlineMarkdown(content)}
        </li>
      );
    }
    if (!line.trim()) {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-sm text-slate-300 leading-relaxed mb-2">
        {parseInlineMarkdown(line)}
      </p>
    );
  });
};

export default function App() {
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(3);
  const [groupType, setGroupType] = useState("couple");
  const [groupSize, setGroupSize] = useState(2);

  const [activeTab, setActiveTab] = useState("itinerary");
  const [loading, setLoading] = useState(false);
  const [tripError, setTripError] = useState(null);
  const [itineraryError, setItineraryError] = useState(null);

  const [health, setHealth] = useState({ geminiConfigured: false, liveTrainsConfigured: false });
  const [metaData, setMetaData] = useState(null);
  const [itineraryText, setItineraryText] = useState("");
  const [trainsData, setTrainsData] = useState([]);
  const [trainsSource, setTrainsSource] = useState(null);
  const [trainApiError, setTrainApiError] = useState(null);
  const [geminiTrainsError, setGeminiTrainsError] = useState(null);
  const [fares, setFares] = useState({});

  const streamEndRef = useRef(null);

  useEffect(() => {
    if (groupType === "solo") setGroupSize(1);
    else if (groupType === "couple") setGroupSize(2);
    else if (groupType === "family") setGroupSize(3);
  }, [groupType]);

  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [itineraryText]);

  const ErrorBox = ({ label, message, color = "rose" }) => (
    <div className={`p-3 rounded-lg border flex gap-2 items-start ${
      color === "amber" ? "bg-amber-950/20 border-amber-900/40" :
      color === "violet" ? "bg-violet-950/20 border-violet-900/40" :
      "bg-rose-950/30 border-rose-900/40"
    }`}>
      <AlertCircle size={16} className={`shrink-0 mt-0.5 ${
        color === "amber" ? "text-amber-500" : color === "violet" ? "text-violet-400" : "text-rose-500"
      }`} />
      <div className="text-xs leading-relaxed">
        {label && <span className={`font-semibold ${color === "amber" ? "text-amber-400" : color === "violet" ? "text-violet-400" : "text-rose-400"}`}>{label}: </span>}
        <span className="text-slate-300">{message}</span>
      </div>
    </div>
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!source || !destination) return;

    setLoading(true);
    setTripError(null);
    setItineraryError(null);
    setMetaData(null);
    setItineraryText("");
    setTrainsData([]);
    setTrainsSource(null);
    setTrainApiError(null);
    setGeminiTrainsError(null);
    setFares({});
    setActiveTab("itinerary");

    const payload = { source, destination, days, groupType, groupSize };

    try {
      const metaRes = await fetch("/api/trip-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) {
        const msg = meta.geminiError || meta.error || "Failed to load trip data";
        throw new Error(meta.source === "gemini" ? msg : msg);
      }
      setMetaData(meta);

      await Promise.all([
        loadTrains(meta),
        loadItinerary({ ...payload, metaData: meta }),
      ]);
    } catch (err) {
      setTripError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadItinerary = async (payload) => {
    try {
      const res = await fetch("/api/stream-itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.geminiError || err.error || "Itinerary generation failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
        if (text.startsWith("ERROR: ")) throw new Error(text.slice(7));
        setItineraryText(text);
      }
    } catch (err) {
      setItineraryError(err.message);
    }
  };

  const loadTrains = async (meta) => {
    const from = meta.source?.stationCode;
    const to = meta.destination?.stationCode;
    if (!from || !to) return;

    try {
      const res = await fetch(`/api/trains?from=${from}&to=${to}&distance=${meta.distanceKm || 800}`);
      const data = await res.json();

      setTrainsSource(data.source);
      setTrainApiError(data.trainApiError || null);
      setGeminiTrainsError(data.geminiError || null);

      if (!res.ok) return;

      setTrainsData(data.trains || []);
      const estimates = {};
      (data.trains || []).forEach((train) => {
        (train.classes || []).forEach((cls) => {
          estimates[`${train.train_number}-${cls}`] = { fare: "—", source: "estimated" };
        });
      });
      setFares(estimates);
    } catch {
      setTrainApiError("Network error — could not reach the server for train data");
    }
  };

  const fetchLiveFare = async (trainNo, classCode) => {
    const key = `${trainNo}-${classCode}`;
    setFares((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, fareError: null } }));

    try {
      const res = await fetch(
        `/api/fare?trainNo=${trainNo}&from=${metaData.source.stationCode}&to=${metaData.destination.stationCode}&classCode=${classCode}&distance=${metaData.distanceKm}`
      );
      const data = await res.json();

      if (!res.ok) {
        setFares((prev) => ({
          ...prev,
          [key]: { ...prev[key], loading: false, fareError: data.error || "Fare lookup failed" },
        }));
        return;
      }

      setFares((prev) => ({
        ...prev,
        [key]: {
          fare: data.fare,
          source: data.source,
          loading: false,
          trainApiError: data.trainApiError || null,
          fareError: data.trainApiError || null,
        },
      }));
    } catch {
      setFares((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: false, fareError: "Network error — could not fetch fare" },
      }));
    }
  };



  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] grid-rows-[auto_1fr] gap-6 max-w-[1440px] mx-auto p-6 min-h-screen text-slate-200 bg-slate-950">
      <header className="col-span-full flex justify-between items-center py-3 px-5 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-3">
          <Compass className="text-slate-400" size={32} />
          <div>
            <h1 className="text-xl font-bold text-white">TripCraft</h1>
            <p className="text-[10px] text-slate-500 uppercase">AI Travel Planner</p>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="lg:sticky lg:top-6">
          <h2 className="text-base font-bold text-white mb-5">Plan Your Trip</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase text-slate-400">From</label>
              <input className="w-full mt-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm" placeholder="e.g. Mumbai" value={source} onChange={(e) => setSource(e.target.value)} required disabled={loading} />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase text-slate-400">To</label>
              <input className="w-full mt-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm" placeholder="e.g. Rishikesh" value={destination} onChange={(e) => setDestination(e.target.value)} required disabled={loading} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase text-slate-400">Days</label>
                <input type="number" min={1} max={30} className="w-full mt-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm" value={days} onChange={(e) => setDays(+e.target.value || 1)} disabled={loading} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase text-slate-400">Group</label>
                <select className="w-full mt-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm" value={groupType} onChange={(e) => setGroupType(e.target.value)} disabled={loading}>
                  <option value="solo">Solo (1)</option>
                  <option value="couple">Couple (2)</option>
                  <option value="family">Friends/Family (3+)</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={loading || !source || !destination} className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <><RefreshCw className="animate-spin" size={16} /> Planning...</> : <><Compass size={16} /> Find Route</>}
            </button>
          </form>
          {!health.geminiConfigured && (
            <p className="mt-4 text-[11px] text-red-400">Add GEMINI_API_KEY to server .env</p>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-col gap-4 h-full">
        {tripError && (
          <div className="rounded-xl overflow-hidden">
            <ErrorBox label="Gemini" message={tripError} />
          </div>
        )}

        {loading && !metaData && (
          <div className="p-12 bg-slate-900 border border-slate-800 rounded-xl text-center flex-1 flex flex-col justify-center items-center">
            <RefreshCw className="animate-spin text-cyan-500 mx-auto mb-3" size={32} />
            <p className="text-white font-semibold">Generating your trip...</p>
          </div>
        )}

        {!loading && !metaData && !tripError && (
          <div className="p-12 bg-slate-900 border border-slate-800 rounded-xl text-center flex-1 flex flex-col justify-center items-center">
            <Compass className="text-slate-500 mx-auto mb-3" size={48} />
            <p className="text-slate-400 text-sm">Enter your trip details to get started.</p>
          </div>
        )}

        {metaData && (
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {metaData.source?.name} <ArrowRight size={18} className="text-slate-500" /> {metaData.destination?.name}
              </h2>
              <button onClick={() => window.print()} className="text-xs px-3 py-1.5 border border-slate-800 rounded-lg text-slate-400 hover:text-white flex items-center gap-1">
                <Download size={14} /> Export
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-800 mb-4 overflow-x-auto">
              {[
                { id: "itinerary", label: "Overview", icon: Compass },
                { id: "trains", label: "Trains", icon: Train },
                { id: "food", label: "Food", icon: Utensils },
                { id: "attractions", label: "Places", icon: MapPin },
                { id: "souvenirs", label: "Souvenirs", icon: Gift },

              ].map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 ${activeTab === id ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400"}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {activeTab === "itinerary" && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {itineraryError && <div className="xl:col-span-2"><ErrorBox label="Gemini" message={itineraryError} /></div>}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg max-h-[600px] overflow-y-auto">
                  <div className="space-y-1">
                    {itineraryError ? (
                      <p className="text-sm text-rose-400">Overview could not be generated.</p>
                    ) : itineraryText ? (
                      parseMarkdownToJSX(itineraryText)
                    ) : (
                      <p className="text-sm text-slate-500 italic animate-pulse">Generating overview...</p>
                    )}
                  </div>
                  <div ref={streamEndRef} />
                </div>
                <div className="h-[400px] rounded-lg overflow-hidden border border-slate-800">
                  <MapComponent source={metaData.source} destination={metaData.destination} places={metaData.placesToVisit} />
                </div>
              </div>
            )}

            {activeTab === "trains" && (
              <div className="space-y-3">
                {trainsSource && trainsSource !== "none" && (
                  <p className="text-xs text-slate-400">
                    Data source:{" "}
                    <span className="text-emerald-400 font-semibold">
                      Live (RailRadar)
                    </span>
                  </p>
                )}
                {trainApiError && <ErrorBox label="RailRadar" message={trainApiError} color="amber" />}

                {trainsData.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">
                    {trainApiError ? "No train data available — see errors above." : "No trains found for this route."}
                  </p>
                ) : (
                  trainsData.map((train, i) => (
                    <div key={i} className="p-4 mb-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <p className="font-semibold text-white">{train.train_name} <span className="text-slate-500 text-xs">#{train.train_number}</span></p>
                      <p className="text-xs text-slate-400 mt-1">{train.depart_time} → {train.arrival_time} · {train.duration} · {train.run_days}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {(train.classes || []).map((cls) => {
                          const key = `${train.train_number}-${cls}`;
                          const f = fares[key];
                          return (
                            <div key={cls} className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 rounded px-2 py-1">
                              <span className="font-bold">{cls}</span>
                              {f?.loading ? <RefreshCw className="animate-spin" size={12} /> :
                               f?.fareError ? <span className="text-rose-400 text-[10px]" title={f.fareError}>Error</span> :
                               f?.fare && f.fare !== "—" ? <span className="text-emerald-400">₹{f.fare}</span> :
                               <button onClick={() => fetchLiveFare(train.train_number, cls)} className="text-cyan-400">Fetch</button>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "food" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(metaData.famousFoods || []).map((f, i) => (
                  <div key={i} className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                    <p className="font-semibold text-white">{f.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{f.description}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "attractions" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(metaData.placesToVisit || []).map((p, i) => (
                  <div key={i} className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                    <p className="font-semibold text-white">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{p.description}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "souvenirs" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(metaData.souvenirs || []).map((s, i) => (
                  <div key={i} className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                    <p className="font-semibold text-white">{s.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{s.description}</p>
                  </div>
                ))}
              </div>
            )}


          </div>
        )}
      </main>
    </div>
  );
}
