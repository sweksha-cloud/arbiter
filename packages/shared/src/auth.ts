import { z } from 'zod';

import { DisplayNameSchema, GuestSchema } from './api.js';

// Accounts: an email and password attached to a guest, so the same person
// (their preferences and past sessions) can log in on any device.

/** Lowercased and trimmed, so "Sam@X.com " and "sam@x.com" are one account. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

/**
 * Length is what makes a password strong; composition rules ("one symbol")
 * mostly produce "Password1!" (NIST SP 800-63B). 128 keeps hashing cheap.
 */
export const PasswordSchema = z
  .string()
  .min(8, { message: 'Use at least 8 characters' })
  .max(128, { message: 'Use at most 128 characters' });

export const SignupRequestSchema = z.object({
  /** Needed only when this device has no guest yet; otherwise the guest's name is kept. */
  displayName: DisplayNameSchema.optional(),
  email: EmailSchema,
  password: PasswordSchema
});

// Login doesn't enforce the password rules: a wrong password should get
// "wrong email or password", never a hint about the rules.
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  /** The session this device's guest is in, so they stay in it as the account (TRADEOFFS.md 4h). */
  activeSessionId: z.string().trim().min(1).max(20).optional()
});

export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema });

export const ResetPasswordRequestSchema = z.object({ token: z.string().min(1).max(200), password: PasswordSchema });

export const VerifyEmailRequestSchema = z.object({ token: z.string().min(1).max(200) });

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordSchema
});

/**
 * Who is signed in on this device. `email` is null for a guest without an
 * account; `emailVerified` says whether they've opened the link emailed to it.
 */
export const MeResponseSchema = z.object({ guest: GuestSchema, email: z.string().nullable(), emailVerified: z.boolean() });
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Returned by signup, login and password reset: a fresh token for this device. */
export const AuthResponseSchema = MeResponseSchema.extend({ token: z.string() });
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ---- Past sessions (logged-in only; TRADEOFFS.md 4b) ----

export const PastPlaceSchema = z.object({
  placeId: z.string(),
  rank: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  /** A Google Maps link, or null for sample places. Names aren't stored (Google's terms). */
  mapsUrl: z.string().nullable(),
  /** Everyone liked it: the group's match. */
  matched: z.boolean()
});

export const PastSessionSchema = z.object({
  sessionId: z.string(),
  hostId: z.string(),
  placesSource: z.enum(['sample', 'google']),
  status: z.enum(['open', 'ended']),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  members: z.array(GuestSchema),
  places: z.array(PastPlaceSchema)
});
export type PastSession = z.infer<typeof PastSessionSchema>;

export const PastSessionsResponseSchema = z.object({ sessions: z.array(PastSessionSchema) });
