import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const required = { WEB_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgres://localhost/arbiter' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(required)).toMatchObject({
      HOST: '0.0.0.0',
      PORT: 4000,
      NODE_ENV: 'development',
      TRUST_PROXY: false,
      RATE_LIMITS: 'on'
    });
  });

  it('reads TRUST_PROXY as a boolean and refuses anything but true or false', () => {
    expect(loadConfig({ ...required, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(() => loadConfig({ ...required, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('treats a missing Google key as "use sample places", not an error', () => {
    expect(loadConfig(required).GOOGLE_PLACES_API_KEY).toBeUndefined();
    expect(loadConfig({ ...required, GOOGLE_PLACES_API_KEY: 'k' }).GOOGLE_PLACES_API_KEY).toBe('k');
  });

  it('parses PORT as a number', () => {
    expect(loadConfig({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('names every missing or invalid variable', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*WEB_ORIGIN/);
  });
});
