// Google Maps helpers. The browser key must be restricted in Google Cloud Console to your
// domain (HTTP referrer) and to the Maps JavaScript + Places APIs. Without a key the app
// falls back to typed addresses, browser geolocation and plain Google Maps links.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
let loader = null;

export const mapsEnabled = Boolean(KEY);

export function loadGoogleMaps() {
  if (!KEY) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&libraries=places&loading=async&callback=__chafadiaMapsReady`;
      script.async = true;
      window.__chafadiaMapsReady = () => resolve(window.google);
      script.onerror = () => reject(new Error("Google Maps failed to load"));
      document.head.appendChild(script);
    });
  }
  return loader;
}

/** Deep link that opens Google Maps directions to a point (works without an API key). */
export function directionsUrl({ lat, lng }, origin) {
  const params = new URLSearchParams({ api: "1", destination: `${lat},${lng}`, travelmode: "driving" });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Embeddable map (no key needed) showing one location. */
export const embedUrl = ({ lat, lng }) => `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is not available on this device"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }),
      () => reject(new Error("Location permission was denied")),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}
