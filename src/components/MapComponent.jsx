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
  iconUrl: "https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers/img/marker-icon-2x-violet.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const destIcon = new L.Icon({
  iconUrl: "https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers/img/marker-icon-2x-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const placeIcon = new L.Icon({
  iconUrl: "https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers/img/marker-icon-2x-cyan.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [22, 36],
  iconAnchor: [11, 36],
  popupAnchor: [1, -34],
  shadowSize: [36, 36]
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
    const map = L.map(mapContainerRef.current).setView([destLat, destLng], 11);
    mapInstanceRef.current = map;

    // Load CartoDB Voyager tile layer — more street/label detail than Dark Matter
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
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

    // Add Markers for Places to Visit
    places.forEach((place) => {
      if (place.lat && place.lng) {
        L.marker([place.lat, place.lng], { icon: placeIcon })
          .addTo(map)
          .bindPopup(`<b>${place.name}</b><br/>${place.description || ""}<br/><i>Stay: ${place.duration || "N/A"} | Entry: ${place.ticketPrice || "Free"}</i>`);
        markers.push([place.lat, place.lng]);
      }
    });

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

  return <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />;
}