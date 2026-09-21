// Shape reference for one player's per-tick input. The sim imports its own
// NEUTRAL_INPUT constant (src/sim/step.js) — this file exists so the input
// layer has a single documented shape to build frames against.
//
// { moveX, moveY, aimX, aimY, fire, ab1, ab2, ult }
// moveX/moveY/aimX/aimY: floats in [-1, 1]. fire/ab1/ab2/ult: booleans.

export function createEmptyFrame() {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, ab1: false, ab2: false, ult: false };
}
