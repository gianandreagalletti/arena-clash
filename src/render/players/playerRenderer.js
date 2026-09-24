// Per-player sprite rendering: body sprite (facing/animation), shadow, number
// tag, aim reticle, hit flash, spawn-invuln blink, shield bubble, ghost.
//
// Anything the renderer needs to remember between frames (previous HP for hit
// flash, previous position for walk/idle, animation phase) lives in
// per-player-id maps HERE, never in sim state (architecture rule).

import Phaser from 'phaser';
import { TILE_SIZE_PX, PLAYER_RADIUS_TILES, CHARACTERS } from '../../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from '../coords.js';
import { PALETTE, paletteKeyForCharacterColor } from '../art/palette.js';
import { PIXEL_FONT_FAMILY } from '../art/font.js';

const RADIUS_PX = PLAYER_RADIUS_TILES * TILE_SIZE_PX;
const HIT_FLASH_TICKS = 2;
const IDLE_FRAME_TICKS = 20;
const WALK_FRAME_TICKS = 8;
const INVULN_BLINK_TICKS = 4;
const MOVE_EPSILON_TILES = 0.002;
const REACH_TILES_FOR_RETICLE = 0.8;

// Sprite anchor: the sim position (player.x/y) is the *center of the collision
// circle*, but a literal geometric-center anchor on a chibi sprite (huge head,
// tiny legs) would visually float the body well above its own hitbox. Anchoring
// near the torso/feet instead keeps the character visually grounded on the sim
// position and lets the shadow sit exactly at the sprite's bottom edge — see
// README "Art" section for this documented reading of "body center."
const BODY_ORIGIN_Y = 0.82;
const FRAME_SIZE_PX = 32; // 16 authored px * 2 (see textures.js)
const SHADOW_OFFSET_PX = (1 - BODY_ORIGIN_Y) * FRAME_SIZE_PX; // sprite's bottom edge, from the anchor

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/** aimX/aimY -> { facing: 'down'|'up'|'side', flipX } (quantized, no rotation). */
function quantizeFacing(aimX, aimY) {
  const deg = (Math.atan2(aimY, aimX) * 180) / Math.PI;
  if (deg > -45 && deg <= 45) return { facing: 'side', flipX: false }; // right
  if (deg > 45 && deg <= 135) return { facing: 'down', flipX: false };
  if (deg > 135 || deg <= -135) return { facing: 'side', flipX: true }; // left
  return { facing: 'up', flipX: false };
}

function makePlayerVisual(scene, playerId) {
  const shadow = scene.add.ellipse(0, 0, 10, 3, 0x000000, 0.35);
  const body = scene.add.sprite(0, 0, 'player-red', 'idle-down-0');
  body.setOrigin(0.5, BODY_ORIGIN_Y);

  const shield = scene.add.sprite(0, 0, 'shield-red-0');
  shield.setVisible(false);

  const reticle = scene.add.rectangle(0, 0, 3, 3, 0xffffff);
  reticle.setDepth(6000);

  const tag = scene.add
    .text(0, 0, String(playerId + 1), {
      fontFamily: PIXEL_FONT_FAMILY,
      fontSize: '8px',
      color: PALETTE.uiText,
      stroke: PALETTE.outline,
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(6000);

  return { shadow, body, shield, reticle, tag };
}

export function createPlayerRenderer(scene) {
  const visuals = new Map(); // playerId -> visual objects
  const memory = new Map(); // playerId -> { prevX, prevY, prevHp, hitFlashTicks }

  function getOrCreate(playerId) {
    if (!visuals.has(playerId)) visuals.set(playerId, makePlayerVisual(scene, playerId));
    if (!memory.has(playerId)) memory.set(playerId, { prevX: null, prevY: null, prevHp: null, hitFlashTicks: 0 });
    return { visual: visuals.get(playerId), mem: memory.get(playerId) };
  }

  return {
    /** Called once per rendered frame with the current sim state. */
    update(state) {
      for (const player of state.players) {
        const { visual, mem } = getOrCreate(player.id);
        const def = CHARACTERS[player.characterId];
        const paletteKey = player.alive ? paletteKeyForCharacterColor(def.color) : 'ghost';
        const screenX = worldToScreenX(player.x);
        const screenY = worldToScreenY(player.y);

        // Hit-flash trigger: HP dropped since the last frame we saw.
        if (mem.prevHp !== null && player.hp < mem.prevHp) {
          mem.hitFlashTicks = HIT_FLASH_TICKS;
        }
        mem.prevHp = player.hp;
        if (mem.hitFlashTicks > 0) mem.hitFlashTicks -= 1;

        if (!player.alive) {
          renderGhost(visual, screenX, screenY, player.y, paletteKey);
          mem.prevX = player.x;
          mem.prevY = player.y;
          continue;
        }

        const moving =
          mem.prevX !== null &&
          (Math.abs(player.x - mem.prevX) > MOVE_EPSILON_TILES || Math.abs(player.y - mem.prevY) > MOVE_EPSILON_TILES);
        mem.prevX = player.x;
        mem.prevY = player.y;

        const { facing, flipX } = quantizeFacing(player.aimX, player.aimY);
        const frameTicks = moving ? WALK_FRAME_TICKS : IDLE_FRAME_TICKS;
        const frameIndex = Math.floor(state.tick / frameTicks) % 2;
        const frameName = `${moving ? 'walk' : 'idle'}-${facing}-${frameIndex}`;

        visual.body.setPosition(screenX, screenY);
        visual.body.setTexture(`player-${paletteKey}`, frameName);
        visual.body.setFlipX(flipX);
        visual.body.setVisible(true);

        const invuln = state.tick < player.invulnUntilTick;
        let alpha = 1;
        if (invuln) alpha = Math.floor(state.tick / INVULN_BLINK_TICKS) % 2 === 0 ? 1 : 0.4;
        visual.body.setAlpha(alpha);

        if (mem.hitFlashTicks > 0) {
          visual.body.setTintFill(0xffffff);
        } else {
          visual.body.clearTint();
        }

        visual.body.setDepth(player.y);

        visual.shadow.setPosition(screenX, screenY + SHADOW_OFFSET_PX);
        visual.shadow.setDepth(player.y - 0.01);
        visual.shadow.setVisible(true);

        visual.tag.setPosition(screenX, screenY - RADIUS_PX * 2 - 6);
        visual.tag.setColor(def.color);
        visual.tag.setVisible(true);

        const reachPx = REACH_TILES_FOR_RETICLE * TILE_SIZE_PX;
        visual.reticle.setPosition(screenX + player.aimX * reachPx, screenY + player.aimY * reachPx);
        visual.reticle.setFillStyle(colorInt(def.color));
        visual.reticle.setVisible(true);

        if (state.tick < player.shieldActiveUntilTick) {
          const shieldFrame = Math.floor(state.tick / 15) % 2;
          visual.shield.setTexture(`shield-${paletteKey}-${shieldFrame}`);
          visual.shield.setPosition(screenX, screenY);
          visual.shield.setDepth(player.y + 0.5);
          visual.shield.setVisible(true);
        } else {
          visual.shield.setVisible(false);
        }
      }
    },
  };
}

function renderGhost(visual, screenX, screenY, tileY, paletteKey) {
  visual.body.setPosition(screenX, screenY);
  visual.body.setTexture(`player-${paletteKey}`, 'idle-down-0');
  visual.body.setFlipX(false);
  visual.body.clearTint();
  visual.body.setAlpha(0.35);
  visual.body.setDepth(tileY);
  visual.body.setVisible(true);

  visual.shadow.setVisible(false);
  visual.tag.setVisible(false);
  visual.reticle.setVisible(false);
  visual.shield.setVisible(false);
}
