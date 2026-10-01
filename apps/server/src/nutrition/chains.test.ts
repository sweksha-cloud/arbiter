import { describe, expect, it } from 'vitest';

import { CHAINS, matchChain, normalizeName } from './chains.js';

describe('matchChain', () => {
  it('matches a place by the start of its name, ignoring punctuation and case', () => {
    expect(matchChain('Chipotle Mexican Grill')?.name).toBe('Chipotle');
    expect(matchChain("MCDONALD'S")?.name).toBe("McDonald's");
    expect(matchChain('McDonalds')?.name).toBe("McDonald's");
    expect(matchChain('Noodles and Company')?.name).toBe('Noodles & Company');
    expect(matchChain('Panera Bread - Downtown')?.name).toBe('Panera Bread');
    expect(matchChain("Dunkin' Donuts")?.name).toBe("Dunkin'");
  });

  it('does not match a chain name in the middle of another name, or a longer word', () => {
    expect(matchChain('Not Subway Deli')).toBeUndefined();
    expect(matchChain('Sonicville Diner')).toBeUndefined();
    expect(matchChain("Nonna's Kitchen")).toBeUndefined();
  });

  it('has no duplicate names, so each chain is one search', () => {
    const names = CHAINS.map((c) => normalizeName(c.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
