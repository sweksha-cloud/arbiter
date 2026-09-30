import { describe, expect, it } from 'vitest';

import { EmailSchema, LoginRequestSchema, PasswordSchema, SignupRequestSchema } from './auth.js';

describe('auth schemas', () => {
  it('normalizes emails so one address is one account', () => {
    expect(EmailSchema.parse('  Sam@Example.COM ')).toBe('sam@example.com');
  });

  it('rejects things that are not email addresses', () => {
    expect(EmailSchema.safeParse('sam').success).toBe(false);
    expect(EmailSchema.safeParse('sam@').success).toBe(false);
  });

  it('asks for length, not symbols', () => {
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('correct horse battery staple').success).toBe(true);
    expect(PasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('lets signup skip the name when this device already has a guest', () => {
    expect(SignupRequestSchema.safeParse({ email: 'a@b.co', password: 'longenough' }).success).toBe(true);
  });

  it('never reveals the password rules on login', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});
