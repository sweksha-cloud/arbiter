import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectWithRetry, createDb, createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PostgresSessionHistory } from './history/postgres-session-history.js';
import { PostgresGuestStore } from './identity/postgres-guest-store.js';
import { GooglePlacesProvider } from './places/google-places-provider.js';
import { DEFAULT_RATE_LIMITS, NO_RATE_LIMITS } from './rate-limits.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
const { http } = await buildApp({
  webOrigin: config.WEB_ORIGIN,
  logLevel: config.LOG_LEVEL,
  trustProxy: config.TRUST_PROXY,
  rateLimits: config.RATE_LIMITS === 'on' ? DEFAULT_RATE_LIMITS : NO_RATE_LIMITS,
  guests: new PostgresGuestStore(db),
  history: new PostgresSessionHistory(db),
  ...(config.GOOGLE_PLACES_API_KEY
    ? { places: new GooglePlacesProvider({ apiKey: config.GOOGLE_PLACES_API_KEY }), placesSource: 'google' as const }
    : {})
});
http.log.info(
  { placesSource: config.GOOGLE_PLACES_API_KEY ? 'google' : 'sample' },
  config.GOOGLE_PLACES_API_KEY ? 'Using Google Places' : 'No GOOGLE_PLACES_API_KEY: using sample places'
);
http.addHook('onClose', async () => {
  await pool.end();
});

await connectWithRetry(pool, {
  onRetry: (error, attempt) => http.log.warn({ err: error, attempt }, 'Database connection failed, retrying')
});
await runMigrations(db);

await http.listen({ host: config.HOST, port: config.PORT });

// Docker sends SIGTERM on stop and deploys; close connections cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    http.log.info({ signal }, 'Shutting down');
    http.close().then(
      () => process.exit(0),
      (error: unknown) => {
        http.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    );
  });
}
