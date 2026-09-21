// Static "Courtyard" arena layout: spawn points, cover blocks, center platform.
// Pure data + geometry helpers. No Phaser/DOM.

import { ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES } from './config/balance.js';

const CENTER_X = ARENA_WIDTH_TILES / 2; // 12
const CENTER_Y = ARENA_HEIGHT_TILES / 2; // 8

// 3 spawn points at the vertices of an equilateral triangle, equidistant from center.
const SPAWN_RADIUS_TILES = 6;
export const SPAWN_POINTS = [-90, 30, 150].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return {
    x: CENTER_X + Math.cos(rad) * SPAWN_RADIUS_TILES,
    y: CENTER_Y + Math.sin(rad) * SPAWN_RADIUS_TILES,
    // face back toward the center by default
    defaultAimX: -Math.cos(rad),
    defaultAimY: -Math.sin(rad),
  };
});

// 6 fixed, indestructible cover blocks, each 2x1 tiles, arranged in a ring with
// 120-degree rotational symmetry (placed every 60 degrees, so 120-degree symmetry
// holds trivially). All blocks are axis-aligned 2x1 rectangles for simplicity —
// see README for the note on this simplification vs. a "true" rotated block.
const COVER_RING_RADIUS_TILES = 5;
const COVER_BLOCK_W = 2;
const COVER_BLOCK_H = 1;
export const COVER_BLOCKS = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const cx = CENTER_X + Math.cos(rad) * COVER_RING_RADIUS_TILES;
  const cy = CENTER_Y + Math.sin(rad) * COVER_RING_RADIUS_TILES;
  return {
    x: cx - COVER_BLOCK_W / 2,
    y: cy - COVER_BLOCK_H / 2,
    w: COVER_BLOCK_W,
    h: COVER_BLOCK_H,
  };
});

// Visual-only this week (pickups spawn here in a later week).
export const CENTER_PLATFORM = {
  x: CENTER_X - 1.5,
  y: CENTER_Y - 1.5,
  w: 3,
  h: 3,
};

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Closest point on an AABB to a given point.
export function closestPointOnRect(px, py, rect) {
  return {
    x: clamp(px, rect.x, rect.x + rect.w),
    y: clamp(py, rect.y, rect.y + rect.h),
  };
}

// True if a circle overlaps an AABB.
export function circleIntersectsRect(cx, cy, radius, rect) {
  const closest = closestPointOnRect(cx, cy, rect);
  const dx = cx - closest.x;
  const dy = cy - closest.y;
  return dx * dx + dy * dy < radius * radius;
}

// Pushes a circle fully outside an AABB, returning the corrected center.
export function pushCircleOutOfRect(cx, cy, radius, rect) {
  const closest = closestPointOnRect(cx, cy, rect);
  let dx = cx - closest.x;
  let dy = cy - closest.y;
  const distSq = dx * dx + dy * dy;

  if (distSq > 0 && distSq < radius * radius) {
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    return { x: closest.x + nx * radius, y: closest.y + ny * radius };
  }

  if (distSq === 0) {
    // Center landed inside the rect: push out along the shortest escape axis.
    const distLeft = cx - rect.x;
    const distRight = rect.x + rect.w - cx;
    const distTop = cy - rect.y;
    const distBottom = rect.y + rect.h - cy;
    const min = Math.min(distLeft, distRight, distTop, distBottom);
    if (min === distLeft) return { x: rect.x - radius, y: cy };
    if (min === distRight) return { x: rect.x + rect.w + radius, y: cy };
    if (min === distTop) return { x: cx, y: rect.y - radius };
    return { x: cx, y: rect.y + rect.h + radius };
  }

  return { x: cx, y: cy };
}
