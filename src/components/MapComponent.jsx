import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default Leaflet icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom colored markers for better visual hierarchy
const sourceIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const destIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});



export default function MapComponent({ source, destination, places = [] }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Clean up existing map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Set fallback focus coordinates (center of India) if coordinates are invalid
    const destLat = destination?.lat || 20.5937;
    const destLng = destination?.lng || 78.9629;
    const sourceLat = source?.lat || 28.6139;
    const sourceLng = source?.lng || 77.2090;

    // Initialize Map
    const map = L.map(mapContainerRef.current).setView([destLat, destLng], 8);
    mapInstanceRef.current = map;

    // Load CartoDB Dark Matter tile layer for premium dark aesthetic
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    const markers = [];

    // Add Source Marker
    if (source && source.lat && source.lng) {
      const sourceMarker = L.marker([source.lat, source.lng], { icon: sourceIcon })
        .addTo(map)
        .bindPopup(`<b>Source Station:</b> ${source.name} (${source.stationCode || "N/A"})`);
      markers.push([source.lat, source.lng]);
    }

    // Add Destination Marker
    if (destination && destination.lat && destination.lng) {
      const destMarker = L.marker([destination.lat, destination.lng], { icon: destIcon })
        .addTo(map)
        .bindPopup(`<b>Destination Station:</b> ${destination.name} (${destination.stationCode || "N/A"})`);
      markers.push([destination.lat, destination.lng]);
    }



    // Draw route line between Source and Destination
    if (source && source.lat && source.lng && destination && destination.lat && destination.lng) {
      const pathLine = L.polyline(
        [[source.lat, source.lng], [destination.lat, destination.lng]],
        {
          color: "#8b5cf6",
          weight: 3,
          dashArray: "6, 8",
          opacity: 0.8
        }
      ).addTo(map);
    }

    // Fit map bounds to contain all markers with some padding
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers);
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [source, destination, places]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {/* Map Legend Overlay */}
      <div className="absolute bottom-3 left-3 z-[1000] p-2.5 bg-slate-900/95 border border-slate-800 rounded-lg text-[10px] space-y-1.5 backdrop-blur-sm pointer-events-none shadow-lg">
        <p className="font-bold text-white border-b border-slate-800 pb-1 mb-1">Map Legend</p>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block border border-purple-400" />
          <span className="text-slate-300 font-medium">Start / Source</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block border border-red-400" />
          <span className="text-slate-300 font-medium">Destination</span>
        </div>

      </div>
    </div>
  );
}
