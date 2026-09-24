// Deterministic (non-random) hash for picking environment decoration by tile
// coordinate, so the arena looks identical on every launch. Not sim/-adjacent
// randomness — this is purely a render-time "which decal goes here" choice.

/** Returns a stable pseudo-random float in [0, 1) for integer tile (x, y). */
export function hashTile(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
