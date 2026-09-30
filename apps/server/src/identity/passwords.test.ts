import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, hashPassword, needsRehash, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapler', stored)).toBe(false);
  });

  it('salts every hash, so equal passwords look different', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('records its settings and never contains the password', async () => {
    const stored = await hashPassword('hunter2hunter2');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('hunter2');
  });

  it('treats differently composed but identical-looking text as the same password', async () => {
    // "é" typed as one character vs "e" + combining accent (common across keyboards).
    const stored = await hashPassword('café au lait');
    expect(await verifyPassword('café au lait', stored)).toBe(true);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('flags hashes made with weaker settings for an upgrade', async () => {
    const weak = await hashPassword('password123', { N: 2 ** 10, r: 8, p: 1 });
    expect(needsRehash(weak)).toBe(true);
    expect(await verifyPassword('password123', weak)).toBe(true);
    expect(needsRehash(await hashPassword('password123', DEFAULT_PARAMS))).toBe(false);
  });
});
