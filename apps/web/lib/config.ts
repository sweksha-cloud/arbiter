export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

/**
 * Whether the server can actually send email (reset links, confirmations).
 * Set NEXT_PUBLIC_EMAIL_ENABLED=false in production until an email provider is
 * set up, so the site never offers a link that leads nowhere.
 */
/**
 * Where people send privacy and account requests (shown on /privacy and
 * /terms). Set NEXT_PUBLIC_CONTACT_EMAIL before launch.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export const EMAIL_ENABLED = process.env.NEXT_PUBLIC_EMAIL_ENABLED !== 'false';
