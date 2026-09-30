import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** The only origin allowed to call the API (the Next.js app). */
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  /** Real places from Google when set; invented sample places when not. */
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  /**
   * Behind a reverse proxy (Caddy in production), trust its X-Forwarded-For so
   * rate limits see each visitor's IP rather than the proxy's.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * E2E only: write emails to this folder instead of sending them, so tests
   * can follow reset links.
   */
  MAIL_OUTBOX_DIR: z.string().min(1).optional(),
  /** 'off' only for the E2E suite. */
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
