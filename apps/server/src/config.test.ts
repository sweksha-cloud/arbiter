import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const required = { WEB_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgres://localhost/arbiter' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(required)).toMatchObject({ HOST: '0.0.0.0', PORT: 4000, NODE_ENV: 'development' });
  });

  it('parses PORT as a number', () => {
    expect(loadConfig({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('names every missing or invalid variable', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*WEB_ORIGIN/);
  });
});
