// Map items and the things they leave behind: pickups lying on the ground,
// grenades in flight with their blast telegraph, and deployed mines.
//
// Pooled — sprites are recycled, never created or destroyed per frame. All
// render-only memory (which ids have already popped in) lives in the maps
// below, keyed by the sim's own ids.

import Phaser from 'phaser';
import { TILE_SIZE_PX, PICKUPS, CHARACTERS } from '../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from './coords.js';
import { PALETTE } from './art/palette.js';

const ITEM_DEPTH = 5; // on the floor, below players (whose depth is their tile y)
const TELEGRAPH_DEPTH = -10;
const SPARKLE_TICKS = 18;
const BOB_TICKS = 24;
const DESPAWN_WARNING_TICKS = 2 * 60; // blink over the last 2 seconds
const SPAWN_POP_TICKS = 4;

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/** Blocky ring, matching the nova telegraph style. */
function drawPixelRing(graphics, cx, cy, radiusPx, blockSize, color, alpha) {
  if (radiusPx <= 0) return;
  const steps = Math.max(8, Math.round((radiusPx * 2 * Math.PI) / (blockSize * 1.6)));
  graphics.fillStyle(color, alpha);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    graphics.fillRect(
      Math.round(cx + Math.cos(angle) * radiusPx - blockSize / 2),
      Math.round(cy + Math.sin(angle) * radiusPx - blockSize / 2),
      blockSize,
      blockSize
    );
  }
}

export function createItemRenderer(scene) {
  const pickupSprites = new Map(); // pickupId -> { sprite, shadow }
  const pickupSeen = new Map(); // pickupId -> first tick we drew it (for the pop-in)
  const freePickups = [];

  const explosiveSprites = new Map(); // explosiveId -> sprite
  const freeExplosives = [];

  const telegraph = scene.add.graphics().setDepth(TELEGRAPH_DEPTH);

  function acquirePickup() {
    const pooled = freePickups.pop();
    if (pooled) {
      pooled.sprite.setVisible(true);
      pooled.shadow.setVisible(true);
      return pooled;
    }
    const shadow = scene.add.ellipse(0, 0, 10, 3, 0x000000, 0.3).setDepth(ITEM_DEPTH - 0.01);
    const sprite = scene.add.sprite(0, 0, 'pickup-medkit').setDepth(ITEM_DEPTH);
    return { sprite, shadow };
  }

  function releasePickup(entry) {
    entry.sprite.setVisible(false);
    entry.shadow.setVisible(false);
    freePickups.push(entry);
  }

  function acquireExplosive() {
    const pooled = freeExplosives.pop();
    if (pooled) {
      pooled.setVisible(true);
      return pooled;
    }
    return scene.add.sprite(0, 0, 'mine-unarmed').setDepth(ITEM_DEPTH);
  }

  return {
    update(state) {
      telegraph.clear();

      // --- Items on the ground ---
      const livePickups = new Set();
      for (const pickup of state.pickups) {
        livePickups.add(pickup.id);
        if (!pickupSprites.has(pickup.id)) pickupSprites.set(pickup.id, acquirePickup());
        if (!pickupSeen.has(pickup.id)) pickupSeen.set(pickup.id, state.tick);

        const { sprite, shadow } = pickupSprites.get(pickup.id);
        const screenX = worldToScreenX(pickup.x);
        const screenY = worldToScreenY(pickup.y);

        // 1px idle bob, straight off the sim tick.
        const bob = Math.floor(state.tick / BOB_TICKS) % 2 === 0 ? 0 : -2;

        if (pickup.family === 'amulet') {
          const frame = Math.floor(state.tick / SPARKLE_TICKS) % 2;
          sprite.setTexture(`amulet-${pickup.type}-${frame}`);
        } else {
          sprite.setTexture(`pickup-${pickup.type}`);
        }

        // Temporary items blink out over their last couple of seconds.
        let alpha = 1;
        if (pickup.family === 'temporary') {
          const remaining = PICKUPS.temporary.lifetimeTicks - (state.tick - pickup.spawnTick);
          if (remaining <= DESPAWN_WARNING_TICKS) {
            alpha = Math.floor(state.tick / 4) % 2 === 0 ? 1 : 0.25;
          }
        }
        // Brief pop-in so an item never simply blinks into existence.
        const age = state.tick - pickupSeen.get(pickup.id);
        const scale = age < SPAWN_POP_TICKS ? 0.5 + (0.5 * age) / SPAWN_POP_TICKS : 1;

        sprite.setPosition(screenX, screenY + bob);
        sprite.setAlpha(alpha);
        sprite.setScale(scale);
        shadow.setPosition(screenX, screenY + 6);
        shadow.setAlpha(alpha * 0.8);
      }

      for (const [id, entry] of pickupSprites) {
        if (livePickups.has(id)) continue;
        releasePickup(entry);
        pickupSprites.delete(id);
        pickupSeen.delete(id);
      }

      // --- Grenades in flight and deployed mines ---
      const liveExplosives = new Set();
      for (const explosive of state.explosives) {
        liveExplosives.add(explosive.id);
        if (!explosiveSprites.has(explosive.id)) explosiveSprites.set(explosive.id, acquireExplosive());
        const sprite = explosiveSprites.get(explosive.id);

        if (explosive.kind === 'grenade') {
          // The sim lands the grenade instantly and then burns the fuse, so the
          // renderer animates the throw across that fuse from the stored origin.
          const fuse = PICKUPS.temporary.grenade.fuseTicks;
          const remaining = explosive.explodeAtTick - state.tick;
          const t = Math.max(0, Math.min(1, 1 - remaining / fuse));
          const flight = Math.min(1, t * 2); // lands halfway through the fuse
          const x = worldToScreenX(explosive.originX + (explosive.x - explosive.originX) * flight);
          const y = worldToScreenY(explosive.originY + (explosive.y - explosive.originY) * flight);

          sprite.setTexture('pickup-grenade');
          sprite.setPosition(x, y - Math.sin(flight * Math.PI) * 10); // little arc
          sprite.setDepth(ITEM_DEPTH + 1);

          // Blast telegraph on the floor, blinking faster as the fuse runs out.
          const blinkTicks = t > 0.7 ? 3 : 8;
          const bright = Math.floor(state.tick / blinkTicks) % 2 === 0;
          drawPixelRing(
            telegraph,
            worldToScreenX(explosive.x),
            worldToScreenY(explosive.y),
            explosive.radiusTiles * TILE_SIZE_PX,
            4,
            colorInt(PALETTE.itemMedkit),
            bright ? 0.85 : 0.35
          );
        } else {
          const armed = state.tick >= explosive.armedAtTick;
          sprite.setTexture(armed ? 'mine-armed' : 'mine-unarmed');
          sprite.setPosition(worldToScreenX(explosive.x), worldToScreenY(explosive.y));
          sprite.setDepth(ITEM_DEPTH);
          // Armed mines pulse slowly — visible to everyone, by design.
          sprite.setAlpha(armed && Math.floor(state.tick / 15) % 2 === 0 ? 1 : 0.65);
          const owner = state.players.find((p) => p.id === explosive.ownerId);
          if (owner) sprite.setTint(colorInt(CHARACTERS[owner.characterId].color));
        }
      }

      for (const [id, sprite] of explosiveSprites) {
        if (liveExplosives.has(id)) continue;
        sprite.setVisible(false);
        sprite.clearTint();
        freeExplosives.push(sprite);
        explosiveSprites.delete(id);
      }
    },
  };
}
