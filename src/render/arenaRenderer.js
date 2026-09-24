// Static + semi-static arena drawing: floor checker, wall ring, cover blocks
// (y-sorted against players), center platform, torches with flicker + glow.
// Reads sim/arena.js + balance.js for every size/position; never mutates state.

import Phaser from 'phaser';
import { TILE_SIZE_PX, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES } from '../sim/config/balance.js';
import { COVER_BLOCKS, CENTER_PLATFORM } from '../sim/arena.js';
import { worldToScreenX, worldToScreenY, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './coords.js';
import { hashTile } from './art/hash.js';

const STATIC_DEPTH = -2000;
const TORCH_DEPTH = -100;
const TORCH_GLOW_DEPTH = -150;

const CRACK_CHANCE = 0.1; // ~1 tile in 10

/** Builds the fully static floor+wall+platform image once, as a single RenderTexture. */
function buildStaticLayer(scene) {
  const rt = scene.add.renderTexture(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
  rt.setOrigin(0, 0);
  rt.setDepth(STATIC_DEPTH);

  // Wall ring: one tile outside the playable area on every side.
  for (let x = -1; x <= ARENA_WIDTH_TILES; x++) {
    rt.draw('wall', worldToScreenX(x), worldToScreenY(-1));
    rt.draw('wall', worldToScreenX(x), worldToScreenY(ARENA_HEIGHT_TILES));
  }
  for (let y = 0; y < ARENA_HEIGHT_TILES; y++) {
    rt.draw('wall', worldToScreenX(-1), worldToScreenY(y));
    rt.draw('wall', worldToScreenX(ARENA_WIDTH_TILES), worldToScreenY(y));
  }

  // Floor checker + hash-picked crack decals (deterministic, no Math.random).
  for (let x = 0; x < ARENA_WIDTH_TILES; x++) {
    for (let y = 0; y < ARENA_HEIGHT_TILES; y++) {
      const key = (x + y) % 2 === 0 ? 'tile-floorA' : 'tile-floorB';
      const sx = worldToScreenX(x);
      const sy = worldToScreenY(y);
      rt.draw(key, sx, sy);
      if (hashTile(x, y) < CRACK_CHANCE) {
        rt.draw('tile-crack', sx, sy);
      }
    }
  }

  // Center platform (visual only — collision bounds are unchanged in sim/arena.js).
  rt.draw('platform', worldToScreenX(CENTER_PLATFORM.x), worldToScreenY(CENTER_PLATFORM.y));

  return rt;
}

/** One sprite per cover block, depth-sorted by its bottom (world) edge so players can pass behind it. */
function buildCoverSprites(scene) {
  const overhangPx = scene.registry.get('coverOverhangPx');
  return COVER_BLOCKS.map((block) => {
    const sprite = scene.add.sprite(worldToScreenX(block.x), worldToScreenY(block.y) - overhangPx, 'cover');
    sprite.setOrigin(0, 0);
    sprite.setDepth(block.y + block.h); // y-sort key, same scale as player depth (world tile y)
    return sprite;
  });
}

const TORCH_FLICKER_TICKS = 10; // ticks per flame frame

function torchWorldPositions() {
  // 2 top, 2 bottom, mirrored across the arena's horizontal center.
  const xs = [ARENA_WIDTH_TILES * 0.25, ARENA_WIDTH_TILES * 0.75];
  return [
    ...xs.map((x) => ({ x, y: -0.5 })),
    ...xs.map((x) => ({ x, y: ARENA_HEIGHT_TILES + 0.2 })),
  ];
}

function buildTorches(scene) {
  const glowGraphics = scene.add.graphics();
  glowGraphics.setDepth(TORCH_GLOW_DEPTH);
  glowGraphics.setBlendMode(Phaser.BlendModes.ADD);

  const sprites = torchWorldPositions().map((pos) => {
    const sprite = scene.add.sprite(worldToScreenX(pos.x), worldToScreenY(pos.y), 'torch-0');
    sprite.setOrigin(0.5, 0.85); // flame tip grows upward from the bracket
    sprite.setDepth(TORCH_DEPTH);
    return { sprite, screenX: worldToScreenX(pos.x), screenY: worldToScreenY(pos.y) };
  });

  return { sprites, glowGraphics };
}

export function createArenaRenderer(scene) {
  buildStaticLayer(scene);
  const coverSprites = buildCoverSprites(scene);
  const { sprites: torches, glowGraphics } = buildTorches(scene);

  return {
    /** Called every rendered frame (not every sim tick) with the current sim tick for flicker timing. */
    update(tick) {
      const frame = Math.floor(tick / TORCH_FLICKER_TICKS) % 3;
      glowGraphics.clear();
      for (const { sprite, screenX, screenY } of torches) {
        sprite.setTexture(`torch-${frame}`);

        // 2-3 concentric low-alpha glow squares, additive blend.
        const sizes = [26, 18, 10];
        const alphas = [0.08, 0.14, 0.22];
        for (let i = 0; i < sizes.length; i++) {
          glowGraphics.fillStyle(0xffcc66, alphas[i]);
          const s = sizes[i];
          glowGraphics.fillRect(screenX - s / 2, screenY - s / 2 - 6, s, s);
        }
      }
    },
    coverSprites,
  };
}
