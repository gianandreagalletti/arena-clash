// Maps keyboard + mouse state to an InputFrame.
// WASD: move · Mouse: aim toward the cursor · Left click (hold): Shoot ·
// E: Slash · Q: Shield · R: reserved (future ultimate).
//
// Diagonal move normalization is handled centrally in sim/systems/movement.js
// (the sim is the single authority on movement math), so this layer just
// passes raw -1/0/1 axis values through.
//
// This module deliberately knows NOTHING about pixels, canvas size or camera
// state: it receives an aim point already converted to world tiles by
// render/coords.js screenToWorld(). Doing the screen->world math here is what
// caused the aim offset after the art pass added a 1-tile world margin that
// input/ never learned about.

/**
 * `keys`: { w, a, s, d, q, e, r } booleans.
 * `aimWorld`: { x, y } in TILES — where the crosshair is, in world space.
 * `playerWorld`: { x, y } in tiles — the player's current *sim* position (not
 * the sprite position: the sprite's anchor and idle bob are visual only).
 * `mouseDown`: boolean, left mouse button held.
 */
export function readKeyboardMouseFrame(keys, aimWorld, playerWorld, mouseDown) {
  const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const moveY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);

  const dx = aimWorld.x - playerWorld.x;
  const dy = aimWorld.y - playerWorld.y;
  const mag = Math.hypot(dx, dy);
  const aimX = mag > 0 ? dx / mag : 0;
  const aimY = mag > 0 ? dy / mag : 1;

  return {
    moveX,
    moveY,
    aimX,
    aimY,
    fire: !!mouseDown,
    slash: !!keys.e,
    shield: !!keys.q,
  };
}
