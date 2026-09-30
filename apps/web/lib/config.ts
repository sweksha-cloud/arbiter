export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

/** Used when the browser can't share a location (denied, or not on HTTPS). */
export const FALLBACK_CENTER = { lat: 37.3352, lng: -121.8811 };
