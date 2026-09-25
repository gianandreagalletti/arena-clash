// Shape reference for one player's per-tick input. The sim imports its own
// NEUTRAL_INPUT constant (src/sim/step.js) — this file exists so the input
// layer has a single documented shape to build frames against.
//
// { moveX, moveY, aimX, aimY, fire, slash, shield, ult }
// moveX/moveY/aimX/aimY: floats in [-1, 1]. fire/slash/shield/ult: booleans.
// (fire = Shoot. `ult` triggers the character's unique ability: Berserker
// nova, Summoner dog summon. Sniper has none — its identity is statistical.)

export function createEmptyFrame() {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slash: false, shield: false, ult: false };
}
