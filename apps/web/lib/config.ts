export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

/**
 * Whether the server can actually send email (reset links, confirmations).
 * Set NEXT_PUBLIC_EMAIL_ENABLED=false in production until an email provider is
 * set up, so the site never offers a link that leads nowhere.
 */
export const EMAIL_ENABLED = process.env.NEXT_PUBLIC_EMAIL_ENABLED !== 'false';

/** Used when the browser can't share a location (denied, or not on HTTPS). */
export const FALLBACK_CENTER = { lat: 37.3352, lng: -121.8811 };
