// Summoner dogs: sprite (owner-colored, facing + walk animation), shadow,
// always-visible HP bar and hit flash.
//
// Purely presentational. Lifecycle FX (spawn pop, death poof, bite chomp) live
// in fx/fxRenderer.js next to the other particle work. Everything remembered
// between frames lives in the per-dog-id maps below, never in sim state.

import Phaser from 'phaser';
import { TILE_SIZE_PX, CHARACTERS } from '../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from './coords.js';
import { paletteKeyForCharacterColor } from './art/palette.js';

const HIT_FLASH_TICKS = 2;
const IDLE_FRAME_TICKS = 24;
const WALK_FRAME_TICKS = 6; // scurries faster than a player walks
const MOVE_EPSILON_TILES = 0.002;
const BODY_ORIGIN_Y = 0.85;
const FRAME_SIZE_PX = 32;
const SHADOW_OFFSET_PX = (1 - BODY_ORIGIN_Y) * FRAME_SIZE_PX;

const HP_BAR_SEGMENTS = 5;
const HP_BAR_W = 16;
const HP_BAR_H = 3;

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/** Facing from the movement delta (the dog has no aim vector of its own). */
function quantizeFacing(dx, dy) {
  if (Math.abs(dx) < MOVE_EPSILON_TILES && Math.abs(dy) < MOVE_EPSILON_TILES) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > -45 && deg <= 45) return { facing: 'side', flipX: false };
  if (deg > 45 && deg <= 135) return { facing: 'down', flipX: false };
  if (deg > 135 || deg <= -135) return { facing: 'side', flipX: true };
  return { facing: 'up', flipX: false };
}

export function createDogRenderer(scene) {
  const visuals = new Map(); // dogId -> { body, shadow, bar }
  const memory = new Map(); // dogId -> { prevX, prevY, prevHp, hitFlashTicks, facing, flipX }
  const free = [];

  function acquire() {
    const pooled = free.pop();
    if (pooled) {
      pooled.body.setVisible(true);
      pooled.shadow.setVisible(true);
      pooled.bar.setVisible(true);
      return pooled;
    }
    const body = scene.add.sprite(0, 0, 'dog-red', 'idle-down-0');
    body.setOrigin(0.5, BODY_ORIGIN_Y);
    const shadow = scene.add.ellipse(0, 0, 8, 3, 0x000000, 0.35);
    const bar = scene.add.graphics();
    return { body, shadow, bar };
  }

  function release(entry) {
    entry.body.setVisible(false);
    entry.shadow.setVisible(false);
    entry.bar.setVisible(false);
    entry.bar.clear();
    free.push(entry);
  }

  function drawHpBar(bar, screenX, screenY, fraction, accentHex) {
    bar.clear();
    const x = screenX - HP_BAR_W / 2;
    const y = screenY - TILE_SIZE_PX * 0.55;
    const segW = (HP_BAR_W - (HP_BAR_SEGMENTS - 1)) / HP_BAR_SEGMENTS;
    const filledCount = Math.ceil(fraction * HP_BAR_SEGMENTS);
    for (let i = 0; i < HP_BAR_SEGMENTS; i++) {
      const filled = i < filledCount;
      bar.fillStyle(filled ? colorInt(accentHex) : 0x000000, filled ? 1 : 0.6);
      bar.fillRect(x + i * (segW + 1), y, segW, HP_BAR_H);
    }
  }

  return {
    update(state) {
      const seen = new Set();

      for (const dog of state.dogs) {
        seen.add(dog.id);
        const owner = state.players.find((p) => p.id === dog.ownerId);
        if (!owner) continue;
        const accentHex = CHARACTERS[owner.characterId].color;
        const paletteKey = paletteKeyForCharacterColor(accentHex);

        if (!visuals.has(dog.id)) visuals.set(dog.id, acquire());
        if (!memory.has(dog.id)) {
          memory.set(dog.id, {
            prevX: dog.x,
            prevY: dog.y,
            prevHp: dog.hp,
            hitFlashTicks: 0,
            facing: 'down',
            flipX: false,
          });
        }
        const visual = visuals.get(dog.id);
        const mem = memory.get(dog.id);

        const screenX = worldToScreenX(dog.x);
        const screenY = worldToScreenY(dog.y);

        if (dog.hp < mem.prevHp) mem.hitFlashTicks = HIT_FLASH_TICKS;
        mem.prevHp = dog.hp;
        if (mem.hitFlashTicks > 0) mem.hitFlashTicks -= 1;

        // Facing follows movement; a standing dog keeps the way it last faced.
        const heading = quantizeFacing(dog.x - mem.prevX, dog.y - mem.prevY);
        const moving = heading !== null;
        if (moving) {
          mem.facing = heading.facing;
          mem.flipX = heading.flipX;
        }
        mem.prevX = dog.x;
        mem.prevY = dog.y;

        const frameTicks = moving ? WALK_FRAME_TICKS : IDLE_FRAME_TICKS;
        const frameIndex = Math.floor(state.tick / frameTicks) % 2;
        visual.body.setTexture(`dog-${paletteKey}`, `${moving ? 'walk' : 'idle'}-${mem.facing}-${frameIndex}`);
        visual.body.setFlipX(mem.flipX);
        visual.body.setPosition(screenX, screenY);
        visual.body.setDepth(dog.y);
        if (mem.hitFlashTicks > 0) visual.body.setTintFill(0xffffff);
        else visual.body.clearTint();

        visual.shadow.setPosition(screenX, screenY + SHADOW_OFFSET_PX);
        visual.shadow.setDepth(dog.y - 0.01);

        // Always visible: enemies need to see it's killable and how close it is.
        visual.bar.setDepth(6000);
        drawHpBar(visual.bar, screenX, screenY, Math.max(0, dog.hp / dog.maxHp), accentHex);
      }

      for (const [id, entry] of visuals) {
        if (!seen.has(id)) {
          release(entry);
          visuals.delete(id);
          memory.delete(id);
        }
      }
    },
  };
}
