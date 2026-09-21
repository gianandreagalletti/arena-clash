// Maps keyboard + mouse state to an InputFrame.
// WASD: move · Mouse: aim toward cursor (relative to the player's screen
// position) · Left click (hold): Shoot · E: Slash · Q: Shield ·
// R: reserved (future ultimate).
//
// Diagonal move normalization is handled centrally in sim/systems/movement.js
// (the sim is the single authority on movement math), so this layer just
// passes raw -1/0/1 axis values through.

import { TILE_SIZE_PX } from '../sim/config/balance.js';

/**
 * `keys`: { w, a, s, d, q, e, r } booleans.
 * `pointerScreen`: { x, y } in canvas pixels.
 * `playerWorld`: { x, y } in tiles (the player's current sim position) — used
 * to compute mouse-relative aim, since the arena uses a fixed, non-scrolling camera.
 * `mouseDown`: boolean, left mouse button held.
 */
export function readKeyboardMouseFrame(keys, pointerScreen, playerWorld, mouseDown) {
  const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const moveY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);

  const playerScreenX = playerWorld.x * TILE_SIZE_PX;
  const playerScreenY = playerWorld.y * TILE_SIZE_PX;
  const dx = pointerScreen.x - playerScreenX;
  const dy = pointerScreen.y - playerScreenY;
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
