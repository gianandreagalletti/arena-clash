// Boot-time texture generation: turns palette.js + sprites.js pixel grids
// into Phaser textures with stable keys/frame names (see the contract below),
// so real Aseprite spritesheets can later replace these under the same keys
// without touching any game code.
//
// Scaling approach: rather than authoring 16px-native canvases and applying a
// separate sprite scale of 2 everywhere sim positions are drawn, every
// generator here paints each authored "pixel" as a 2x2 block directly onto a
// canvas sized in real screen pixels (1 authored tile = TILE_SIZE_PX px,
// already 2x16). This is visually identical to "16px art, drawn at exactly
// 2x" but needs no separate scale factor threaded through GameScene — the
// brief's own "whichever touches less existing code" escape hatch.
// `pixelArt: true` in the Phaser game config keeps every 2x2 block crisp.
//
// Texture key contract:
//   player-{red|blue|green|ghost}   frames idle|walk-down|up|side-0|1
//   dog-{red|blue|green}            same frame names, colored by its owner
//   bite                            white chomp burst when a dog lands a bite
//   tile-floorA / tile-floorB / tile-crack
//   wall
//   cover
//   platform
//   torch-0 / torch-1 / torch-2
//   proj-{red|blue|green}
//   slash-{red|blue|green}-{dir}-{0|1|2}   dir one of the 8 compass points
//   shield-{red|blue|green}-{0|1}
//   pickup-{medkit|overcharge|adrenaline|shieldBattery|grenade|mine|cloak}
//   amulet-{amuletSpeed|...|amuletHunter}-{0|1}   2-frame sparkle
//   mine-unarmed / mine-armed              a deployed mine
//   particle-{red|blue|green}              elimination "poof" square
//   (the ghost palette has no proj-/slash-/shield-/particle- variant — eliminated players don't attack)

import { PALETTE, PLAYER_PALETTE_KEYS } from './palette.js';
import { PLAYER_FRAMES, DOG_FRAMES, PLAYER_FRAME_SIZE, LEGEND } from './sprites.js';
import { TILE_SIZE_PX, ACTIONS, PLAYER_RADIUS_TILES } from '../../sim/config/balance.js';

const PX = 2; // authored-pixel -> screen-pixel block size (16 authored px * 2 = 32 = TILE_SIZE_PX)

export const COMPASS_DIRECTIONS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const DIRECTION_ANGLES_RAD = COMPASS_DIRECTIONS.map((_, i) => (i * Math.PI) / 4); // 0..7 * 45deg, atan2 convention (Y down)

/** Snaps a continuous aim angle (radians, atan2 convention) to the nearest of the 8 compass directions. */
export function snapToCompassDirection(angleRad) {
  const twoPi = Math.PI * 2;
  const norm = ((angleRad % twoPi) + twoPi) % twoPi;
  const index = Math.round(norm / (Math.PI / 4)) % 8;
  return COMPASS_DIRECTIONS[index];
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function roleColor(role, paletteSet) {
  if (role === 'outline') return PALETTE.outline;
  return paletteSet[role];
}

/** Paints a character grid (see sprites.js LEGEND) onto ctx at (originX, originY), each cell as a PXxPX block. */
function paintGrid(ctx, grid, originX, originY, paletteSet) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const role = LEGEND[ch];
      if (!role) continue;
      ctx.fillStyle = roleColor(role, paletteSet);
      ctx.fillRect(originX + x * PX, originY + y * PX, PX, PX);
    }
  }
}

// --- Players: one atlas per palette (red/blue/green/ghost), 12 named frames each ---

/**
 * Builds one palette-swapped atlas per color from a {frameName: grid} map.
 * Players and dogs share this so a dog is colored by its owner exactly the way
 * a player is — same grids format, same legend, same swap.
 */
function generateCharacterAtlases(scene, frames, keyPrefix, paletteKeys) {
  const frameNames = Object.keys(frames);
  const cols = 4;
  const rows = Math.ceil(frameNames.length / cols);
  const cellSize = PLAYER_FRAME_SIZE * PX; // 32
  const canvas = makeCanvas(cellSize * cols, cellSize * rows);

  for (const key of paletteKeys) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const paletteSet = PALETTE[key];

    const regions = {};
    frameNames.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const originX = col * cellSize;
      const originY = row * cellSize;
      paintGrid(ctx, frames[name], originX, originY, paletteSet);
      regions[name] = { x: originX, y: originY, w: cellSize, h: cellSize };
    });

    const textureKey = `${keyPrefix}-${key}`;
    if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
    const texture = scene.textures.addCanvas(textureKey, cloneCanvas(canvas));
    for (const [name, r] of Object.entries(regions)) {
      texture.add(name, 0, r.x, r.y, r.w, r.h);
    }
  }
}

function cloneCanvas(src) {
  const out = makeCanvas(src.width, src.height);
  out.getContext('2d').drawImage(src, 0, 0);
  return out;
}

// --- Environment: floor, wall, cover blocks, center platform, torches ---

function fillBlock(ctx, gx, gy, gw, gh, color) {
  ctx.fillStyle = color;
  ctx.fillRect(gx * PX, gy * PX, gw * PX, gh * PX);
}

function generateFloorTextures(scene) {
  const size = 16 * PX; // one tile, 32px

  // Floor A / B: flat fill with a 1px-authored darker grid seam on two edges,
  // giving a checker/tile look without needing true alternating draw logic downstream.
  for (const [key, base] of [
    ['tile-floorA', PALETTE.floorA],
    ['tile-floorB', PALETTE.floorB],
  ]) {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = PALETTE.wallBase;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, size - PX, size, PX); // subtle seam, bottom edge
    ctx.fillRect(size - PX, 0, PX, size); // subtle seam, right edge
    ctx.globalAlpha = 1;
    scene.textures.addCanvas(key, canvas);
  }

  // Crack decal: transparent tile with a thin dark crack, composited over a
  // floor tile by the arena renderer on ~1-in-10 tiles (hash-picked).
  {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.floorCrack;
    // A simple jagged authored-pixel crack line from one corner toward center.
    const cells = [
      [2, 2], [3, 3], [3, 4], [4, 5], [5, 5], [5, 6], [6, 7], [7, 7], [7, 8],
    ];
    for (const [gx, gy] of cells) fillBlock(ctx, gx, gy, 1, 1, PALETTE.floorCrack);
    scene.textures.addCanvas('tile-crack', canvas);
  }
}

function generateWallTexture(scene) {
  const size = 16 * PX;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.wallBody;
  ctx.fillRect(0, 0, size, size);
  // Lighter top edge (authored ~4px) and darker base (authored ~3px) — gives
  // the "slight frontal tilt" read the brief asks for.
  fillBlock(ctx, 0, 0, 16, 4, PALETTE.wallTop);
  fillBlock(ctx, 0, 13, 16, 3, PALETTE.wallBase);
  scene.textures.addCanvas('wall', canvas);
}

function generateCoverTexture(scene) {
  // 2x1 tiles of collision, but the visual overhangs upward by a few authored
  // px (the fake-3D top face) — collision itself is untouched (sim/arena.js).
  const OVERHANG_AUTHORED_PX = 6;
  const w = 32 * PX; // 2 tiles wide
  const collisionH = 16 * PX; // 1 tile tall (the actual collision rect)
  const h = (16 + OVERHANG_AUTHORED_PX) * PX;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');

  const overhangPx = OVERHANG_AUTHORED_PX * PX;
  // Body (the part sitting within the collision rect).
  ctx.fillStyle = PALETTE.coverFill;
  ctx.fillRect(0, overhangPx, w, collisionH);
  // Dark lower edge.
  ctx.fillStyle = PALETTE.coverDark;
  ctx.fillRect(0, h - 3 * PX, w, 3 * PX);
  // Light top face, overhanging above the collision rect's top edge.
  ctx.fillStyle = PALETTE.coverLight;
  ctx.fillRect(2 * PX, 0, w - 4 * PX, overhangPx + 2 * PX);
  // Outline.
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = PX;
  ctx.strokeRect(PX / 2, PX / 2, w - PX, h - PX);

  scene.textures.addCanvas('cover', canvas);
  // Anchor metadata for the renderer: fraction of the texture height that is
  // BELOW the collision rect's top edge, i.e. where world-space y=block.y maps to.
  return { overhangPx };
}

function generatePlatformTexture(scene) {
  const w = 48 * PX; // 3 tiles
  const h = 48 * PX;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.platformFill;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = PALETTE.platformEdge;
  ctx.lineWidth = 2 * PX;
  ctx.strokeRect(PX, PX, w - 2 * PX, h - 2 * PX);
  scene.textures.addCanvas('platform', canvas);
}

function generateTorchTextures(scene) {
  // Native 16 wide x 24 tall (extends above the wall top for the flame tip).
  const w = 16 * PX;
  const h = 24 * PX;
  const flameFrames = [
    { core: 9, mid: 11, base: 13 }, // authored flame-tip row per layer, frame 0
    { core: 8, mid: 10, base: 13 }, // frame 1 (taller flame)
    { core: 9, mid: 11, base: 12 }, // frame 2
  ];

  flameFrames.forEach((frame, i) => {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    // Bracket.
    ctx.fillStyle = PALETTE.torchBracket;
    ctx.fillRect(5 * PX, 16 * PX, 6 * PX, 6 * PX);
    // Flame layers (base wider/cooler at the bottom, hot core narrow at top).
    ctx.fillStyle = PALETTE.torchBase;
    ctx.fillRect(4 * PX, frame.base * PX, 8 * PX, (18 - frame.base) * PX);
    ctx.fillStyle = PALETTE.torchMid;
    ctx.fillRect(5 * PX, frame.mid * PX, 6 * PX, (frame.base - frame.mid + 1) * PX);
    ctx.fillStyle = PALETTE.torchCore;
    ctx.fillRect(6 * PX, frame.core * PX, 4 * PX, (frame.mid - frame.core + 1) * PX);
    scene.textures.addCanvas(`torch-${i}`, canvas);
  });
}

// --- Combat FX: projectiles, slash arcs, shield bubble, elimination particle ---

function generateProjectileTextures(scene) {
  const size = 4; // final on-screen px, drawn 1:1 (not tile-grid art)
  for (const key of ['red', 'blue', 'green']) {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[key].accent;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(1, 1, 2, 2);
    scene.textures.addCanvas(`proj-${key}`, canvas);
  }
}

/** A small fading trail dot, one per color, reused (scaled down via alpha, not geometry) behind projectiles. */
function generateProjectileTrailTextures(scene) {
  for (const key of ['red', 'blue', 'green']) {
    const canvas = makeCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[key].accent;
    ctx.fillRect(0, 0, 2, 2);
    scene.textures.addCanvas(`proj-trail-${key}`, canvas);
  }
}

const SLASH_REACH_PX = ACTIONS.slash.reachTiles * TILE_SIZE_PX;
const SLASH_HALF_ARC_RAD = (ACTIONS.slash.arcDegrees / 2 / 180) * Math.PI;
const SLASH_CANVAS_SIZE = Math.ceil(SLASH_REACH_PX * 2 + 8);

function generateSlashTextures(scene) {
  const cx = SLASH_CANVAS_SIZE / 2;
  const cy = SLASH_CANVAS_SIZE / 2;
  // 3 frames: growing reach (the "smear" progressing outward through the swing).
  const frameReachFractions = [0.55, 0.8, 1.0];

  for (const key of ['red', 'blue', 'green']) {
    for (let dirIndex = 0; dirIndex < COMPASS_DIRECTIONS.length; dirIndex++) {
      const dir = COMPASS_DIRECTIONS[dirIndex];
      const centerAngle = DIRECTION_ANGLES_RAD[dirIndex];

      frameReachFractions.forEach((reachFrac, frameIndex) => {
        const canvas = makeCanvas(SLASH_CANVAS_SIZE, SLASH_CANVAS_SIZE);
        const ctx = canvas.getContext('2d');
        const r = SLASH_REACH_PX * reachFrac;
        const startAngle = centerAngle - SLASH_HALF_ARC_RAD;
        const endAngle = centerAngle + SLASH_HALF_ARC_RAD;

        // Owner-color outer edge (drawn slightly larger, behind the white fill).
        ctx.fillStyle = PALETTE[key].accent;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r + 2, startAngle, endAngle, false);
        ctx.closePath();
        ctx.fill();

        // White inner smear.
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, endAngle, false);
        ctx.closePath();
        ctx.fill();

        scene.textures.addCanvas(`slash-${key}-${dir}-${frameIndex}`, canvas);
      });
    }
  }
}

const SHIELD_RADIUS_PX = PLAYER_RADIUS_TILES * TILE_SIZE_PX + 10;

function generateShieldTextures(scene) {
  const size = Math.ceil(SHIELD_RADIUS_PX * 2 + 4);
  const cx = size / 2;
  const cy = size / 2;

  for (const key of ['red', 'blue', 'green']) {
    for (let frame = 0; frame < 2; frame++) {
      const canvas = makeCanvas(size, size);
      const ctx = canvas.getContext('2d');
      // Hand-drawn pixel circle: step around the ring in blocky increments
      // rather than a smooth Graphics arc stroke.
      const blockSize = 3 + frame; // shimmer: ring "breathes" between frames
      const steps = 28;
      ctx.fillStyle = PALETTE.shieldTint;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, SHIELD_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = PALETTE[key].accent;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(angle) * SHIELD_RADIUS_PX - blockSize / 2);
        const y = Math.round(cy + Math.sin(angle) * SHIELD_RADIUS_PX - blockSize / 2);
        ctx.fillRect(x, y, blockSize, blockSize);
      }
      scene.textures.addCanvas(`shield-${key}-${frame}`, canvas);
    }
  }
}

function generateParticleTextures(scene) {
  const size = 4;
  for (const key of ['red', 'blue', 'green']) {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[key].accent;
    ctx.fillRect(0, 0, size, size);
    scene.textures.addCanvas(`particle-${key}`, canvas);
  }
}

/** A short white "chomp" burst drawn on a player the moment a dog bites them. */
function generateBiteTexture(scene) {
  const size = 12;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  // Two opposing jaws of blocky teeth.
  for (const [x, y] of [[1, 1], [4, 2], [7, 1], [10, 2], [1, 9], [4, 8], [7, 9], [10, 8]]) {
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(2, 5, 8, 2);
  scene.textures.addCanvas('bite', canvas);
}

// --- Map items ---
//
// 14 icons is too many to hand-author as ASCII grids without mistakes, so each
// one is a short list of authored-pixel rects instead: [x, y, w, h, color].
// Same 16x16 frame and 2x block size as every other sprite, so they sit on the
// tile grid exactly like the characters do.
const ITEM_GLYPHS = {
  medkit: [
    [2, 4, 12, 9, PALETTE.itemMedkit],
    [7, 6, 2, 5, '#FFFFFF'],
    [5, 8, 6, 2, '#FFFFFF'],
  ],
  overcharge: [
    [9, 2, 3, 5, PALETTE.itemOvercharge],
    [6, 6, 4, 4, PALETTE.itemOvercharge],
    [8, 9, 3, 5, PALETTE.itemOvercharge],
    [4, 9, 4, 3, PALETTE.itemOvercharge],
  ],
  adrenaline: [
    [7, 2, 2, 8, PALETTE.itemAdrenaline],
    [5, 4, 6, 2, PALETTE.itemAdrenaline],
    [5, 10, 6, 4, PALETTE.itemAdrenaline],
  ],
  shieldBattery: [
    [4, 3, 8, 11, PALETTE.itemBattery],
    [6, 1, 4, 2, PALETTE.itemMetal],
    [6, 6, 4, 5, PALETTE.itemOvercharge],
  ],
  grenade: [
    [5, 5, 6, 8, PALETTE.itemGrenade],
    [7, 2, 2, 3, PALETTE.itemMetal],
    [9, 2, 3, 2, PALETTE.itemMetal],
  ],
  mine: [
    [3, 7, 10, 6, PALETTE.itemMine],
    [7, 4, 2, 3, PALETTE.itemMetal],
    [6, 9, 4, 2, PALETTE.itemMedkit],
  ],
  cloak: [
    [5, 3, 6, 4, PALETTE.itemCloak],
    [3, 6, 10, 7, PALETTE.itemCloak],
    [6, 7, 4, 3, PALETTE.outline],
  ],
};

/** An amulet: a gold frame with a per-type gem, so "permanent" reads instantly. */
function amuletGlyph(amuletId) {
  return [
    [4, 3, 8, 10, PALETTE.itemGold],
    [5, 4, 6, 8, PALETTE.itemGoldDark],
    [6, 5, 4, 6, PALETTE.amuletGems[amuletId]],
    [7, 1, 2, 2, PALETTE.itemGold],
  ];
}

/** Paints one glyph into a 16x16 frame with a 1px outline silhouette under it. */
function paintGlyph(ctx, rects, originX = 0, originY = 0) {
  // Outline pass: every rect grown by 1 authored px, drawn in the outline color.
  ctx.fillStyle = PALETTE.outline;
  for (const [x, y, w, h] of rects) {
    ctx.fillRect(originX + (x - 1) * PX, originY + (y - 1) * PX, (w + 2) * PX, (h + 2) * PX);
  }
  for (const [x, y, w, h, color] of rects) {
    ctx.fillStyle = color;
    ctx.fillRect(originX + x * PX, originY + y * PX, w * PX, h * PX);
  }
}

function generateItemTextures(scene) {
  const size = PLAYER_FRAME_SIZE * PX;

  for (const [id, rects] of Object.entries(ITEM_GLYPHS)) {
    const canvas = makeCanvas(size, size);
    paintGlyph(canvas.getContext('2d'), rects);
    scene.textures.addCanvas(`pickup-${id}`, canvas);
  }

  // Amulets get a 2-frame sparkle so they read as rare from across the arena.
  for (const id of Object.keys(PALETTE.amuletGems)) {
    for (let frame = 0; frame < 2; frame++) {
      const canvas = makeCanvas(size, size);
      const ctx = canvas.getContext('2d');
      paintGlyph(ctx, amuletGlyph(id));
      ctx.fillStyle = '#FFFFFF';
      if (frame === 0) {
        ctx.fillRect(11 * PX, 3 * PX, PX, PX);
        ctx.fillRect(4 * PX, 10 * PX, PX, PX);
      } else {
        ctx.fillRect(3 * PX, 4 * PX, PX, PX);
        ctx.fillRect(12 * PX, 9 * PX, PX, PX);
      }
      scene.textures.addCanvas(`amulet-${id}-${frame}`, canvas);
    }
  }

  // Deployed mine: dim before it arms, hot once it is live.
  for (const [key, lamp] of [
    ['mine-unarmed', PALETTE.uiTextMuted],
    ['mine-armed', PALETTE.itemMedkit],
  ]) {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    paintGlyph(ctx, [
      [3, 8, 10, 5, PALETTE.itemMine],
      [6, 10, 4, 2, lamp],
    ]);
    scene.textures.addCanvas(key, canvas);
  }
}

export function generateAllTextures(scene) {
  generateItemTextures(scene);
  generateCharacterAtlases(scene, PLAYER_FRAMES, 'player', PLAYER_PALETTE_KEYS);
  // Dogs are only ever owner-colored — no ghost variant (they don't spectate).
  generateCharacterAtlases(scene, DOG_FRAMES, 'dog', ['red', 'blue', 'green']);
  generateBiteTexture(scene);
  generateFloorTextures(scene);
  generateWallTexture(scene);
  const coverMeta = generateCoverTexture(scene);
  generatePlatformTexture(scene);
  generateTorchTextures(scene);
  generateProjectileTextures(scene);
  generateProjectileTrailTextures(scene);
  generateSlashTextures(scene);
  generateShieldTextures(scene);
  generateParticleTextures(scene);
  return { coverOverhangPx: coverMeta.overhangPx };
}
