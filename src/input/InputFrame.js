// Shape reference for one player's per-tick input. The sim imports its own
// NEUTRAL_INPUT constant (src/sim/step.js) — this file exists so the input
// layer has a single documented shape to build frames against.
//
// { moveX, moveY, aimX, aimY, fire, slash, shield }
// moveX/moveY/aimX/aimY: floats in [-1, 1]. fire/slash/shield: booleans.
// (fire = Shoot. There is no `ult` button yet; ult charge is tracked in sim state.)

export function createEmptyFrame() {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slash: false, shield: false };
}
