// Player movement + collision against cover blocks and arena edges.

import { TICK_RATE, PLAYER_RADIUS_TILES, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES } from '../config/balance.js';
import { COVER_BLOCKS, clamp, pushCircleOutOfRect } from '../arena.js';

/**
 * Moves `player` in place according to `input.moveX/moveY` and the character's
 * speed, then resolves collisions against cover blocks and arena bounds.
 * Diagonal input is normalized here (authoritative), so input devices don't
 * need to pre-normalize.
 */
export function applyMovement(player, input, speedTilesPerSec) {
  const mx = input.moveX || 0;
  const my = input.moveY || 0;
  const mag = Math.hypot(mx, my);

  let nx = mx;
  let ny = my;
  if (mag > 1) {
    nx = mx / mag;
    ny = my / mag;
  }

  const distPerTick = speedTilesPerSec / TICK_RATE;
  let x = player.x + nx * distPerTick;
  let y = player.y + ny * distPerTick;

  x = clamp(x, PLAYER_RADIUS_TILES, ARENA_WIDTH_TILES - PLAYER_RADIUS_TILES);
  y = clamp(y, PLAYER_RADIUS_TILES, ARENA_HEIGHT_TILES - PLAYER_RADIUS_TILES);

  for (const block of COVER_BLOCKS) {
    const pushed = pushCircleOutOfRect(x, y, PLAYER_RADIUS_TILES, block);
    x = pushed.x;
    y = pushed.y;
  }

  player.x = x;
  player.y = y;
}
