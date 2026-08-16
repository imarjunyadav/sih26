import { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MODE_COLORS = {
  LOCAL_TRAIN: '#2563eb',
  METRO:       '#7c3aed',
  BUS:         '#ea580c',
  WALK:        '#9ca3af',
  CAR:         '#9ca3af',
  BIKE:        '#059669',
};

function decodePolyline(encoded) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

export default function JourneyMap({ journey }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: false })
      .addAttribution('© <a href="https://openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/">CARTO</a>')
      .addTo(map);

    const bounds = L.latLngBounds([]);

    for (const leg of journey.legs) {
      const color = MODE_COLORS[leg.mode] ?? '#93a0c2';
      const isWalk = leg.mode === 'WALK';

      if (leg.polyline) {
        const coords = decodePolyline(leg.polyline);
        if (coords.length > 0) {
          L.polyline(coords, {
            color,
            weight: isWalk ? 3 : 4,
            opacity: 0.85,
            dashArray: isWalk ? '6, 8' : null,
          }).addTo(map);
          coords.forEach(c => bounds.extend(c));
        }
      } else if (leg.from?.lat != null && leg.to?.lat != null) {
        const coords = [[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]];
        L.polyline(coords, {
          color,
          weight: 3,
          opacity: 0.7,
          dashArray: '8, 10',
        }).addTo(map);
        coords.forEach(c => bounds.extend(c));
      }
    }

    const first = journey.legs[0];
    if (first?.from?.lat != null) {
      L.circleMarker([first.from.lat, first.from.lng], {
        radius: 7, color: '#fff', weight: 2,
        fillColor: '#059669', fillOpacity: 1,
      }).addTo(map);
    }

    const last = journey.legs[journey.legs.length - 1];
    if (last?.to?.lat != null) {
      L.circleMarker([last.to.lat, last.to.lng], {
        radius: 7, color: '#fff', weight: 2,
        fillColor: '#dc2626', fillOpacity: 1,
      }).addTo(map);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    let watchId = null;
    let gpsMarker = null;

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const ll = [pos.coords.latitude, pos.coords.longitude];
          if (!gpsMarker) {
            gpsMarker = L.marker(ll, {
              icon: L.divIcon({ className: 'gps-dot', iconSize: [16, 16], iconAnchor: [8, 8] }),
              interactive: false,
            }).addTo(map);
          } else {
            gpsMarker.setLatLng(ll);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000 },
      );
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      map.remove();
    };
  }, [journey]);

  return <div ref={containerRef} className="journey-map" />;
}
