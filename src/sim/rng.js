// Seeded, deterministic RNG (mulberry32). Pure: never mutates its input, always
// returns { value, rng } so callers thread the new state through explicitly.
// Not used by any Week 1 gameplay system yet, but the sim keeps it in state so
// future systems (crits, loot, etc.) stay deterministic per architecture rule 4.

export function createRng(seed) {
  return { state: seed >>> 0 };
}

export function nextRandom(rng) {
  let a = (rng.state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { state: a } };
}
