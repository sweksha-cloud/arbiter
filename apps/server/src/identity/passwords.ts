import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, memory-hard so GPUs can't
 * cheaply guess). Stored as `scrypt$N$r$p$salt$hash`, so the cost can be
 * raised later and old hashes still verify. See TRADEOFFS.md 4e.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~32 MB and ~50–100 ms per hash: slow for an attacker, fine for one login. */
export const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };

const KEY_LENGTH = 32;

function scrypt(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  // Node refuses to use more than 32 MB unless told; allow what N and r need.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) =>
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  );
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | undefined {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return undefined;
  return { params: { N: Number(N), r: Number(r), p: Number(p) }, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

/** Compares in constant time, so response timing reveals nothing about the hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await scrypt(password, parsed.salt, parsed.params);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** True if the hash used weaker settings than today's, so it should be redone at the next login. */
export function needsRehash(stored: string, params: ScryptParams = DEFAULT_PARAMS): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.params.N < params.N || parsed.params.r < params.r || parsed.params.p < params.p;
}

/**
 * A real hash of nothing in particular. Checking a password against it when
 * the email doesn't exist makes "no such account" take as long as "wrong
 * password", so timing can't reveal who has an account.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'), params);
  return dummyHash;
}
