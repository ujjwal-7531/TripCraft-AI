import React, { useState, useEffect, useRef } from "react";
import { 
  Compass, 
  MapPin, 
  Train, 
  Utensils, 
  Gift, 
  DollarSign, 
  Calendar, 
  Users, 
  Settings, 
  AlertCircle, 
  ArrowRight, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  X,
  CreditCard,
  Info
} from "lucide-react";
import MapComponent from "./components/MapComponent";

export default function App() {
  // Input states
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(3);
  const [groupType, setGroupType] = useState("couple"); // solo, couple, family
  const [groupSize, setGroupSize] = useState(2);

  // App health/setup status
  const [healthStatus, setHealthStatus] = useState({
    geminiConfigured: false,
    rapidApiConfigured: false,
  });

  // UI state
  const [activeTab, setActiveTab] = useState("itinerary");
  const [showSettings, setShowSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Result states
  const [metaData, setMetaData] = useState(null);
  const [itineraryText, setItineraryText] = useState("");
  const [trainsData, setTrainsData] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingStream, setLoadingStream] = useState(false);
  const [loadingTrains, setLoadingTrains] = useState(false);
  const [fares, setFares] = useState({});
  const [error, setError] = useState(null);
  const [trainsInfo, setTrainsInfo] = useState({
    source: null,
    rapidApiError: null,
    geminiError: null,
    rapidApiAttempted: false,
    geminiAttempted: false,
  });

  const streamEndRef = useRef(null);
  const STREAM_ERROR_PREFIX = "__TRIPCRAFT_ERROR__:";

  // Set group size automatically based on group type selection
  useEffect(() => {
    if (groupType === "solo") setGroupSize(1);
    else if (groupType === "couple") setGroupSize(2);
    else if (groupType === "family") setGroupSize(4);
  }, [groupType]);

  // Fetch backend configuration status on load
  useEffect(() => {
    fetch("/health")
      .then((res) => res.json())
      .then((data) => {
        setHealthStatus({
          geminiConfigured: data.geminiConfigured,
          rapidApiConfigured: data.rapidApiConfigured,
        });
      })
      .catch((err) => console.error("Error fetching server health:", err));
  }, [isSubmitting]);

  // Auto-scroll the itinerary stream to the bottom during generation
  useEffect(() => {
    if (streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [itineraryText]);

  // Form submission handler
  const handleGeneratePlan = async (e) => {
    e.preventDefault();
    if (!source || !destination) return;

    setIsSubmitting(true);
    setLoadingMeta(true);
    setLoadingStream(true);
    setLoadingTrains(true);
    setMetaData(null);
    setItineraryText("");
    setTrainsData(null);
    setFares({});
    setError(null);
    setTrainsInfo({ source: null, rapidApiError: null, geminiError: null, rapidApiAttempted: false, geminiAttempted: false });
    setActiveTab("itinerary");

    const payload = { source, destination, days, groupType, groupSize };

    try {
      // 1. Fetch structured Trip Metadata
      const metaResponse = await fetch("/api/trip-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!metaResponse.ok) {
        let errorMsg = "Failed to load trip metadata";
        try {
          const errorData = await metaResponse.json();
          if (errorData && errorData.error) {
            errorMsg = errorData.error;
          } else if (errorData?.geminiError) {
            errorMsg = errorData.geminiError;
          }
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const meta = await metaResponse.json();
      setMetaData(meta);
      setLoadingMeta(false);

      // 2. Fetch trains and stream itinerary in parallel
      const streamPromise = (async () => {
        try {
          const streamResponse = await fetch("/api/stream-itinerary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, metaData: meta }),
          });

          if (!streamResponse.ok) {
            let errorMsg = "Failed to stream itinerary";
            try {
              const errData = await streamResponse.json();
              errorMsg = errData.error || errData.geminiError || errorMsg;
            } catch (_) {
              try { errorMsg = await streamResponse.text(); } catch (_) {}
            }
            throw new Error(errorMsg);
          }

          const reader = streamResponse.body.getReader();
          const decoder = new TextDecoder();
          let done = false;
          let streamBuffer = "";

          while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
              const chunk = decoder.decode(value, { stream: !done });
              streamBuffer += chunk;
              if (streamBuffer.startsWith(STREAM_ERROR_PREFIX)) {
                throw new Error(streamBuffer.slice(STREAM_ERROR_PREFIX.length));
              }
              setItineraryText((prev) => prev + chunk);
            }
          }
        } finally {
          setLoadingStream(false);
        }
      })();

      const trainsPromise = meta.source?.stationCode && meta.destination?.stationCode
        ? fetchTrains(meta.source.stationCode, meta.destination.stationCode, meta.distanceKm)
        : (setTrainsData([]), setLoadingTrains(false), Promise.resolve());

      await Promise.all([streamPromise, trainsPromise]);
    } catch (error) {
      console.error("Error generating trip plan:", error);
      setError(error.message || "Something went wrong while generating the plan.");
      setLoadingMeta(false);
      setLoadingStream(false);
      setLoadingTrains(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fetch trains from the backend
  const fetchTrains = async (fromCode, toCode, distance) => {
    try {
      const response = await fetch(`/api/trains?from=${fromCode}&to=${toCode}&distance=${distance || 800}`);
      const data = await response.json();

      if (!response.ok) {
        setTrainsData([]);
        setTrainsInfo({
          source: data.source || "none",
          rapidApiError: data.rapidApiError || null,
          geminiError: data.geminiError || data.error || null,
          rapidApiAttempted: data.rapidApiAttempted ?? true,
          geminiAttempted: data.geminiAttempted ?? true,
        });
        if (data.error) setError(data.error);
        return;
      }

      setTrainsData(data.trains || []);
      setTrainsInfo({
        source: data.source,
        rapidApiError: data.rapidApiError || null,
        geminiError: data.geminiError || null,
        rapidApiAttempted: data.rapidApiAttempted ?? false,
        geminiAttempted: data.geminiAttempted ?? false,
      });
      setFares(data.fareEstimates || {});
    } catch (err) {
      console.error("Error fetching trains:", err);
      setTrainsData([]);
      setTrainsInfo({
        source: "none",
        rapidApiError: "Network error while contacting the trains API.",
        geminiError: null,
        rapidApiAttempted: true,
        geminiAttempted: false,
      });
    } finally {
      setLoadingTrains(false);
    }
  };

  // Fetch official live fare on demand for a single class
  const handleFetchLiveFare = async (trainNo, classCode) => {
    if (!metaData) return;
    const key = `${trainNo}-${classCode}`;

    setFares((prev) => ({
      ...prev,
      [key]: { ...prev[key], loading: true }
    }));

    try {
      const from = metaData.source.stationCode;
      const to = metaData.destination.stationCode;
      const dist = metaData.distanceKm;

      const response = await fetch(`/api/fare?trainNo=${trainNo}&from=${from}&to=${to}&classCode=${classCode}&distance=${dist}`);
      const data = await response.json();

      if (response.ok) {
        setFares((prev) => ({
          ...prev,
          [key]: {
            fare: data.fare,
            loading: false,
            source: data.source,
            rapidApiError: data.rapidApiError || null,
          },
        }));
      } else {
        throw new Error(data.error || data.rapidApiError || "Fare check failed");
      }
    } catch (err) {
      console.error("Error fetching live fare:", err);
      setFares((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: false, error: true }
      }));
    }
  };

  // Quick helper to render custom markdown text progressively
  const renderItineraryMarkdown = (text) => {
    if (!text) return null;
    const escaped = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = escaped.split("\n");

    const textStyle = "text-sm text-slate-300 mb-3 leading-relaxed [&_strong]:text-cyan-400 [&_strong]:font-semibold [&_code]:bg-slate-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_code]:text-cyan-300";

    return lines.map((line, idx) => {
      if (line.startsWith("# ")) {
        return <h1 className="text-lg font-bold text-cyan-400 mt-2 mb-3 border-b border-slate-800/80 pb-2" key={idx}>{line.slice(2)}</h1>;
      }
      if (line.startsWith("## ")) {
        return <h2 className="text-base font-bold text-cyan-500 mt-4 mb-2.5" key={idx}>{line.slice(3)}</h2>;
      }
      if (line.startsWith("### ")) {
        return <h3 className="text-sm font-bold text-slate-200 mt-3 mb-2" key={idx}>{line.slice(4)}</h3>;
      }
      if (line.startsWith("* ") || line.startsWith("- ")) {
        return <li className={`list-disc ml-5 ${textStyle}`} key={idx} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line.slice(2)) }} />;
      }
      if (/^\d+\.\s/.test(line)) {
        const content = line.replace(/^\d+\.\s/, "");
        return <li className={`list-decimal ml-5 ${textStyle}`} key={idx} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(content) }} />;
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-2" />;
      }
      return <p className={textStyle} key={idx} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line) }} />;
    });
  };

  const parseInlineMarkdown = (text) => {
    let formatted = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");
    formatted = formatted.replace(/`/g, "");
    return formatted;
  };

  const getBudgetTotal = (budget) => {
    if (!budget || typeof budget !== "object") return 0;
    return Object.values(budget).reduce((sum, val) => sum + (Number(val) || 0), 0);
  };

  const renderApiStatusBanner = (rapidApiError, geminiError, source) => {
    if (!rapidApiError && !geminiError) return null;
    return (
      <div className="mb-4 flex flex-col gap-2">
        {rapidApiError && (
          <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg flex gap-2.5 items-start">
            <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-400 leading-normal">
              <strong className="text-amber-400">RapidAPI:</strong> {rapidApiError}
            </div>
          </div>
        )}
        {geminiError && (
          <div className="p-3 bg-rose-950/20 border border-rose-900/30 rounded-lg flex gap-2.5 items-start">
            <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-400 leading-normal">
              <strong className="text-rose-400">Gemini:</strong> {geminiError}
            </div>
          </div>
        )}
        {source === "gemini-simulated" && rapidApiError && !geminiError && (
          <div className="p-3 bg-cyan-950/20 border border-cyan-900/30 rounded-lg flex gap-2.5 items-start">
            <Info size={16} className="text-cyan-500 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-400 leading-normal">
              Showing <strong className="text-cyan-400">{source === "rapidapi" ? "live IRCTC" : "AI-simulated"}</strong> train data.
            </div>
          </div>
        )}
      </div>
    );
  };

  // Export current plan as a PDF by printing
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 max-w-[1440px] mx-auto p-6 min-h-screen text-slate-200 font-sans bg-slate-950">
      {/* Header */}
      <header className="col-span-full flex justify-between items-center p-4 px-6 mb-2 bg-slate-900 border border-slate-800 rounded-xl print:hidden">
        <div className="flex items-center gap-3">
          <Compass className="text-slate-400" size={32} />
          <div>
            <h1 className="text-xl font-bold text-slate-100">TripCraft</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">AI Agent Travel Planner</p>
          </div>
        </div>
        <button 
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg text-sm transition-colors" 
          onClick={() => setShowSettings(true)}
        >
          <Settings size={16} />
          Settings
        </button>
      </header>

      {/* Sidebar Inputs */}
      <aside className="p-6 bg-slate-900 border border-slate-800 rounded-xl h-fit lg:sticky lg:top-6 print:hidden">
        <h2 className="text-base font-bold text-white mb-5">Plan Your Voyage</h2>
        <form onSubmit={handleGeneratePlan}>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Source Station/City</label>
            <div className="relative flex items-center">
              <MapPin className="absolute left-3 text-slate-500 pointer-events-none" size={18} />
              <input 
                type="text" 
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none transition-colors" 
                placeholder="e.g. Mumbai, Maharashtra" 
                value={source}
                onChange={(e) => setSource(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Destination Station/City</label>
            <div className="relative flex items-center">
              <Compass className="absolute left-3 text-slate-500 pointer-events-none" size={18} />
              <input 
                type="text" 
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none transition-colors" 
                placeholder="e.g. Madgaon, Goa" 
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Days of Stay</label>
              <div className="relative flex items-center">
                <Calendar className="absolute left-3 text-slate-500 pointer-events-none" size={18} />
                <input 
                  type="number" 
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none transition-colors" 
                  min={1} 
                  max={30}
                  value={days}
                  onChange={(e) => setDays(parseInt(e.target.value) || 1)}
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Travel Group</label>
              <div className="relative flex items-center">
                <Users className="absolute left-3 text-slate-500 pointer-events-none" size={18} />
                <select 
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none transition-colors appearance-none" 
                  value={groupType}
                  onChange={(e) => setGroupType(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option className="bg-slate-950" value="solo">Solo (1)</option>
                  <option className="bg-slate-950" value="couple">Couple (2)</option>
                  <option className="bg-slate-950" value="family">Family (4+)</option>
                </select>
              </div>
            </div>
          </div>

          {groupType === "family" && (
            <div className="mb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Number of Persons</label>
              <input 
                type="number" 
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none transition-colors" 
                min={4} 
                max={20}
                value={groupSize}
                onChange={(e) => setGroupSize(parseInt(e.target.value) || 4)}
                required
                disabled={isSubmitting}
              />
            </div>
          )}

          <button 
            type="submit" 
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg flex justify-center items-center gap-2 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isSubmitting || !source || !destination}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="animate-spin" size={16} />
                Finding Route...
              </>
            ) : (
              <>
                <Compass size={16} />
                Find Route & Plans
              </>
            )}
          </button>
        </form>

        <div className="mt-5 flex flex-col gap-2">
          {!healthStatus.geminiConfigured && (
            <div className="p-3 bg-red-950/10 border border-red-900/20 rounded-lg flex gap-2.5 items-start">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-400 leading-normal">
                <strong>No Gemini Key:</strong> AI features are disabled. Add <code>GEMINI_API_KEY</code> in server <code>.env</code>.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="flex flex-col gap-5 min-h-[500px]">
        {error && (
          <div className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-xl flex gap-3 items-start print:hidden">
            <AlertCircle size={20} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-400 mb-1">Something went wrong</p>
              <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-slate-500 hover:text-white p-1">
              <X size={16} />
            </button>
          </div>
        )}
        {/* If no metaData and not loading, show welcome screen */}
        {!metaData && !isSubmitting && (
          <div className="flex flex-col items-center justify-center text-center p-12 bg-slate-900 border border-slate-800 rounded-xl h-full">
            <Compass className="text-5xl text-slate-500 mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">Your AI Adventure Begins Here</h2>
            <p className="text-slate-400 max-w-sm text-xs leading-relaxed">
              Input your travel details in the sidebar to find the best route. We will search for railway connections, calculate travel options, organize budgets, discover signature local foods, and find authentic souvenirs.
            </p>
          </div>
        )}

        {/* Loading Indicators */}
        {isSubmitting && (loadingMeta) && (
          <div className="flex flex-col items-center justify-center text-center p-12 bg-slate-900 border border-slate-800 rounded-xl">
            <div className="w-10 h-10 border-2 border-slate-800 border-t-cyan-500 rounded-full animate-spin mb-4" />
            <p className="text-base font-bold text-white mb-1">Consulting local experts...</p>
            <p className="text-xs text-slate-400">Geocoding stations, mapping points of interest, and estimating budgets.</p>
          </div>
        )}

        {/* Results View */}
        {metaData && (
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
            {/* Title / Action Header */}
            <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2 flex-wrap text-white">
                  {metaData.source.name} <ArrowRight className="inline align-middle text-slate-400" size={18} /> {metaData.destination.name}
                </h2>
                <p className="text-slate-400 text-xs mt-1">
                  {days} Days trip &bull; {groupSize} Travelers ({groupType}) &bull; {metaData.distanceKm} km distance
                </p>
              </div>
              <button 
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-colors print:hidden" 
                onClick={handlePrint}
              >
                <Download size={14} />
                Export PDF
              </button>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b border-slate-800/80 overflow-x-auto gap-2 pb-1 print:hidden">
              <button 
                className={`flex items-center gap-2 px-3 py-2.5 font-medium text-xs border-b-2 transition-colors whitespace-nowrap ${activeTab === "itinerary" ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400 hover:text-slate-300"}`}
                onClick={() => setActiveTab("itinerary")}
              >
                <Compass size={14} /> Route & Map
              </button>
              <button 
                className={`flex items-center gap-2 px-3 py-2.5 font-medium text-xs border-b-2 transition-colors whitespace-nowrap ${activeTab === "trains" ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400 hover:text-slate-300"}`}
                onClick={() => setActiveTab("trains")}
              >
                <Train size={14} /> Trains Info
              </button>
              <button 
                className={`flex items-center gap-2 px-3 py-2.5 font-medium text-xs border-b-2 transition-colors whitespace-nowrap ${activeTab === "food" ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400 hover:text-slate-300"}`}
                onClick={() => setActiveTab("food")}
              >
                <Utensils size={14} /> Local Delights
              </button>
              <button 
                className={`flex items-center gap-2 px-3 py-2.5 font-medium text-xs border-b-2 transition-colors whitespace-nowrap ${activeTab === "attractions" ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400 hover:text-slate-300"}`}
                onClick={() => setActiveTab("attractions")}
              >
                <Compass size={14} /> Places & Souvenirs
              </button>
              <button 
                className={`flex items-center gap-2 px-3 py-2.5 font-medium text-xs border-b-2 transition-colors whitespace-nowrap ${activeTab === "budget" ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-400 hover:text-slate-300"}`}
                onClick={() => setActiveTab("budget")}
              >
                <DollarSign size={14} /> Budget Plan
              </button>
            </div>

            {/* Tab Contents */}
            <div className="py-4">
              {/* Itinerary & Map */}
              {activeTab === "itinerary" && (
                <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6 mt-1">
                  <div className="p-5 bg-slate-950 border border-slate-800/80 rounded-lg min-h-[400px] max-h-[700px] overflow-y-auto leading-relaxed">
                    <div className="font-sans">
                      {renderItineraryMarkdown(itineraryText)}
                      {loadingStream && (
                        <p className="text-cyan-500 mt-4 font-semibold text-xs animate-pulse">
                          AI Agent is writing details...
                        </p>
                      )}
                      <div ref={streamEndRef} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Interactive Map</h3>
                    <div className="h-[450px] w-full rounded-lg overflow-hidden border border-slate-800">
                      <MapComponent 
                        source={metaData.source} 
                        destination={metaData.destination} 
                        places={metaData.placesToVisit} 
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 flex gap-4 items-center">
                      <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> Source</div>
                      <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Destination</div>
                      <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Sights</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Trains */}
              {activeTab === "trains" && (
                <div className="mt-1">
                  <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
                    <h3 className="text-sm font-bold text-white">Railway Connections</h3>
                    <div className="flex gap-2 flex-wrap">
                      <span className="bg-slate-950 text-slate-400 border border-slate-800 px-2.5 py-1 rounded text-xs">From: {metaData.source.stationCode || "Source"}</span>
                      <span className="bg-slate-950 text-slate-400 border border-slate-800 px-2.5 py-1 rounded text-xs">To: {metaData.destination.stationCode || "Dest"}</span>
                      {trainsInfo.source && (
                        <span className={`px-2.5 py-1 rounded text-xs border ${trainsInfo.source === "rapidapi" ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/40" : trainsInfo.source === "gemini-simulated" ? "bg-violet-950/30 text-violet-400 border-violet-900/40" : "bg-slate-950 text-slate-400 border-slate-800"}`}>
                          {trainsInfo.source === "rapidapi" ? "Live IRCTC" : trainsInfo.source === "gemini-simulated" ? "AI Simulated" : "Unavailable"}
                        </span>
                      )}
                    </div>
                  </div>

                  {renderApiStatusBanner(trainsInfo.rapidApiError, trainsInfo.geminiError, trainsInfo.source)}

                  {loadingTrains ? (
                    <div className="flex flex-col items-center justify-center text-center p-12 bg-slate-950 border border-slate-800 rounded-xl">
                      <RefreshCw className="animate-spin text-slate-500 mb-3" size={24} />
                      <p className="text-xs text-slate-400">Searching rail connections via IRCTC...</p>
                    </div>
                  ) : trainsData && trainsData.length > 0 ? (
                    trainsData.map((train, idx) => (
                      <div className="p-4 mb-3 flex flex-col gap-3.5 bg-slate-950 border border-slate-800 rounded-lg" key={idx}>
                        <div className="flex justify-between items-center flex-wrap gap-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-slate-100">{train.train_name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">Train #{train.train_number}</span>
                          </div>

                          <div className="flex items-center gap-4 flex-grow justify-center max-w-[450px] mx-auto w-full">
                            <div className="flex flex-col items-center">
                              <span className="text-base font-bold text-white tracking-tight">{train.depart_time}</span>
                              <span className="text-[9px] text-slate-500 font-semibold uppercase">{metaData.source.stationCode}</span>
                            </div>
                            <div className="flex flex-col items-center relative flex-grow">
                              <span className="text-[9px] text-slate-500 font-medium mb-1">{train.duration}</span>
                              <div className="h-[2px] bg-slate-800 w-full relative before:content-[''] before:absolute before:w-1.5 before:h-1.5 before:rounded-full before:bg-slate-700 before:top-[-2px] before:left-0 after:content-[''] after:absolute after:w-1.5 after:h-1.5 after:rounded-full after:bg-slate-700 after:top-[-2px] after:right-0"></div>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-base font-bold text-white tracking-tight">{train.arrival_time}</span>
                              <span className="text-[9px] text-slate-500 font-semibold uppercase">{metaData.destination.stationCode}</span>
                            </div>
                          </div>

                          <div className="text-right flex flex-col">
                            <span className="text-xs text-slate-300">{train.run_days}</span>
                            <span className="text-[9px] text-slate-500 font-semibold uppercase">Runs On</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 border-t border-slate-800/80 pt-3">
                          {(train.classes || []).map((cls) => {
                            const key = `${train.train_number}-${cls}`;
                            const fareInfo = fares[key];
                            return (
                              <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-1.5 px-2.5 gap-2 text-[11px]" key={cls}>
                                <span className="bg-slate-800 text-slate-300 p-0.5 px-1.5 rounded font-bold">{cls}</span>
                                {fareInfo?.loading ? (
                                  <RefreshCw className="animate-spin text-slate-400" size={12} />
                                ) : fareInfo?.source === "rapidapi" ? (
                                  <span className="font-semibold text-emerald-400 flex items-center gap-1">
                                    ₹{fareInfo.fare} <CheckCircle2 size={10} />
                                  </span>
                                ) : fareInfo?.source === "estimated" ? (
                                  <>
                                    <span className="font-semibold text-slate-300">₹{fareInfo?.fare || "N/A"}</span>
                                    {fareInfo?.rapidApiError && (
                                      <span className="text-[8px] text-amber-500" title={fareInfo.rapidApiError}>⚠</span>
                                    )}
                                    <button 
                                      className="flex items-center gap-0.5 text-[9px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                                      onClick={() => handleFetchLiveFare(train.train_number, cls)}
                                      title="Fetch live fare"
                                    >
                                      <RefreshCw size={8} /> Live
                                    </button>
                                  </>
                                ) : (
                                  <span className="font-semibold text-slate-300">₹{fareInfo?.fare || "N/A"}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-12 bg-slate-950 border border-slate-800 rounded-lg">
                      <AlertCircle size={36} className="text-slate-500 mb-3" />
                      <h3 className="text-sm font-bold text-white">No direct trains found</h3>
                      <p className="text-slate-400 text-xs mt-1 max-w-xs">
                        We couldn't locate direct trains between {metaData.source.stationCode} and {metaData.destination.stationCode}. Try alternative routes.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Local Delights */}
              {activeTab === "food" && (
                <div className="mt-1">
                  <h3 className="text-sm font-bold text-white mb-4">Signature Culinary Highlights</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {metaData.famousFoods && metaData.famousFoods.map((food, idx) => (
                      <div className="p-4 flex flex-col gap-2 bg-slate-950 border border-slate-800 rounded-lg" key={idx}>
                        <div className="flex justify-between items-center gap-3">
                          <h4 className="text-sm font-semibold text-slate-200">{food.name}</h4>
                          <Utensils className="text-slate-500" size={16} />
                        </div>
                        <p className="text-xs leading-relaxed text-slate-400">{food.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Places & Souvenirs */}
              {activeTab === "attractions" && (
                <div className="flex flex-col gap-6 mt-1">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3">Sightseeing Attractions</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {metaData.placesToVisit && metaData.placesToVisit.map((place, idx) => (
                        <div className="p-4 flex flex-col gap-2 bg-slate-950 border border-slate-800 rounded-lg" key={idx}>
                          <div className="flex justify-between items-center gap-3">
                            <h4 className="text-sm font-semibold text-slate-200">{place.name}</h4>
                            <MapPin className="text-slate-500" size={16} />
                          </div>
                          <p className="text-xs leading-relaxed text-slate-400">{place.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-white mb-3">Authentic Local Souvenirs</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {metaData.souvenirs && metaData.souvenirs.map((item, idx) => (
                        <div className="p-4 flex flex-col gap-2 bg-slate-950 border border-slate-800 rounded-lg" key={idx}>
                          <div className="flex justify-between items-center gap-3">
                            <h4 className="text-sm font-semibold text-slate-200">{item.name}</h4>
                            <Gift className="text-slate-500" size={16} />
                          </div>
                          <p className="text-xs leading-relaxed text-slate-400">{item.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Budget */}
              {activeTab === "budget" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-1">
                  <div className="p-6 flex flex-col justify-center items-center text-center bg-slate-950 border border-slate-800 rounded-lg">
                    <DollarSign className="text-slate-400" size={32} />
                    <h3 className="text-xs font-bold text-slate-400 mt-2">Estimated Total Trip Budget</h3>
                    <p className="text-slate-500 text-[10px] mt-0.5">Computed for {groupSize} person(s), staying {days} days</p>
                    <span className="text-3xl font-extrabold text-white my-3 tracking-tight">
                      ₹{getBudgetTotal(metaData.budget).toLocaleString("en-IN")}
                    </span>
                    <p className="text-[10px] text-slate-500 max-w-[240px]">
                      *Includes transport, lodging, food, and shopping.
                    </p>
                  </div>

                  <div className="p-5 flex flex-col gap-3 bg-slate-950 border border-slate-800 rounded-lg">
                    <h3 className="text-xs font-bold text-white mb-1">Budget Allocation</h3>
                    {metaData.budget ? (() => {
                      const total = getBudgetTotal(metaData.budget);
                      return Object.entries(metaData.budget).map(([key, value]) => {
                        const numVal = Number(value) || 0;
                        const pct = total > 0 ? Math.round((numVal / total) * 100) : 0;
                        return (
                          <div className="flex flex-col gap-1.5" key={key}>
                            <div className="flex justify-between text-[11px]">
                              <span className="font-medium text-slate-400 flex items-center gap-1.5 capitalize">
                                {key === "lodging" && <CreditCard size={12} className="text-slate-500" />}
                                {key === "transport" && <Train size={12} className="text-slate-500" />}
                                {key === "food" && <Utensils size={12} className="text-slate-500" />}
                                {key === "shopping" && <Gift size={12} className="text-slate-500" />}
                                {key}
                              </span>
                              <span className="font-semibold text-cyan-500">₹{numVal.toLocaleString("en-IN")} ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-cyan-600 transition-all duration-1000" style={{ width: `${pct}%` }}></div>
                            </div>
                          </div>
                        );
                      });
                    })() : (
                      <p className="text-xs text-slate-500">Budget data unavailable for this trip.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex justify-center items-center p-4">
          <div className="w-full max-w-sm p-5 bg-slate-900 border border-slate-800 rounded-xl flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">System Settings</h3>
              <button className="bg-transparent border-none text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">API Credential Status</h4>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs p-2 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="text-slate-300">Gemini API Integration</span>
                    <span className={`font-semibold ${healthStatus.geminiConfigured ? "text-emerald-500" : "text-rose-500"}`}>
                      {healthStatus.geminiConfigured ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs p-2 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="text-slate-300">RapidAPI IRCTC Integration</span>
                    <span className={`font-semibold ${healthStatus.rapidApiConfigured ? "text-emerald-500" : "text-violet-400"}`}>
                      {healthStatus.rapidApiConfigured ? "Connected" : "Simulated"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 leading-normal">
                <p className="font-semibold text-slate-300 mb-1">How to configure keys:</p>
                <p>Sensitive keys must be configured on the server side in the <code>.env</code> file for security:</p>
                <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 text-[10px] mt-1.5 text-cyan-400 font-mono overflow-x-auto">
                  GEMINI_API_KEY=your_key_here{"\n"}
                  RAPIDAPI_KEY=your_rapidapi_key_here
                </pre>
              </div>
            </div>

            <button className="bg-slate-850 hover:bg-slate-800 border border-slate-800 text-white py-2 rounded-lg font-semibold text-xs transition-colors" onClick={() => setShowSettings(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
