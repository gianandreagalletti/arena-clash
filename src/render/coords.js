// World-to-screen coordinate mapping, shared by every renderer.
//
// The wall ring (see arenaRenderer.js) is drawn OUTSIDE the 24x16 playable
// area, so the on-screen canvas needs a 1-tile margin on every side beyond
// what the sim's arena bounds cover. Collision/arena bounds in sim/ are
// untouched — this only affects where things land on screen.

import { ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES, TILE_SIZE_PX } from '../sim/config/balance.js';

export const WORLD_MARGIN_TILES = 1;

export const CANVAS_WIDTH_PX = (ARENA_WIDTH_TILES + WORLD_MARGIN_TILES * 2) * TILE_SIZE_PX;
export const CANVAS_HEIGHT_PX = (ARENA_HEIGHT_TILES + WORLD_MARGIN_TILES * 2) * TILE_SIZE_PX;

export function worldToScreenX(tileX) {
  return (tileX + WORLD_MARGIN_TILES) * TILE_SIZE_PX;
}

export function worldToScreenY(tileY) {
  return (tileY + WORLD_MARGIN_TILES) * TILE_SIZE_PX;
}

/**
 * The single screen -> world conversion, and the exact inverse of
 * worldToScreenX/Y above. Everything that needs a world point from the mouse
 * goes through here — no hand-written offsets anywhere else.
 *
 * Takes a Phaser Pointer and reads `worldX`/`worldY`, NOT `x`/`y`: Phaser has
 * already folded in the canvas offset in the page, FIT letterbox scaling,
 * devicePixelRatio and the camera transform (scroll, zoom, shake) by the time
 * it sets those. The only thing left for us is px -> tiles and the
 * WORLD_MARGIN_TILES origin shift, which is precisely what the 1-tile wall
 * ring moved and what the input layer used to miss.
 */
export function screenToWorld(pointer) {
  return {
    x: pointer.worldX / TILE_SIZE_PX - WORLD_MARGIN_TILES,
    y: pointer.worldY / TILE_SIZE_PX - WORLD_MARGIN_TILES,
  };
}
