// Ability summons: the Summoner's viper and thorn trap.
//
// The dog has its own renderer (dogRenderer.js) because it carries a lot more
// state — facing, walk cycle, hit flash. These two are simpler, so they share
// one pooled renderer.

import Phaser from 'phaser';
import { TILE_SIZE_PX, CHARACTERS } from '../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from './coords.js';
import { PALETTE, paletteKeyForCharacterColor } from './art/palette.js';

const SUMMON_DEPTH_OFFSET = 0; // y-sorted with players, like the dog
const TRAP_DEPTH = 4; // on the floor, under everything that walks
const VIPER_FRAME_TICKS = 8;
const HP_BAR_W = 14;
const HP_BAR_H = 2;

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

export function createSummonRenderer(scene) {
  const viperVisuals = new Map(); // viperId -> { sprite, bar }
  const trapSprites = new Map(); // trapId -> sprite
  const freeVipers = [];
  const freeTraps = [];

  function ownerColorKey(state, ownerId) {
    const owner = state.players.find((p) => p.id === ownerId);
    return owner ? paletteKeyForCharacterColor(CHARACTERS[owner.characterId].color) : 'green';
  }

  function acquireViper() {
    const pooled = freeVipers.pop();
    if (pooled) {
      pooled.sprite.setVisible(true);
      pooled.bar.setVisible(true);
      return pooled;
    }
    return {
      sprite: scene.add.sprite(0, 0, 'viper-green-0').setOrigin(0.5, 0.8),
      bar: scene.add.graphics(),
    };
  }

  function acquireTrap() {
    const pooled = freeTraps.pop();
    if (pooled) {
      pooled.setVisible(true);
      return pooled;
    }
    return scene.add.sprite(0, 0, 'trap-green-idle').setDepth(TRAP_DEPTH);
  }

  return {
    update(state) {
      // --- Vipers ---
      const liveVipers = new Set();
      for (const viper of state.vipers) {
        liveVipers.add(viper.id);
        if (!viperVisuals.has(viper.id)) viperVisuals.set(viper.id, acquireViper());
        const { sprite, bar } = viperVisuals.get(viper.id);

        const colorKey = ownerColorKey(state, viper.ownerId);
        const frame = Math.floor(state.tick / VIPER_FRAME_TICKS) % 2;
        const screenX = worldToScreenX(viper.x);
        const screenY = worldToScreenY(viper.y);

        sprite.setTexture(`viper-${colorKey}-${frame}`);
        sprite.setPosition(screenX, screenY);
        sprite.setDepth(viper.y + SUMMON_DEPTH_OFFSET);

        // Killable, so it needs a readable health bar like the dog.
        bar.clear();
        bar.setDepth(6000);
        const fraction = Math.max(0, viper.hp / viper.maxHp);
        bar.fillStyle(0x000000, 0.6);
        bar.fillRect(screenX - HP_BAR_W / 2, screenY - TILE_SIZE_PX * 0.5, HP_BAR_W, HP_BAR_H);
        bar.fillStyle(colorInt(PALETTE.poison), 1);
        bar.fillRect(screenX - HP_BAR_W / 2, screenY - TILE_SIZE_PX * 0.5, HP_BAR_W * fraction, HP_BAR_H);
      }

      for (const [id, visual] of viperVisuals) {
        if (liveVipers.has(id)) continue;
        visual.sprite.setVisible(false);
        visual.bar.setVisible(false);
        visual.bar.clear();
        freeVipers.push(visual);
        viperVisuals.delete(id);
      }

      // --- Thorn traps ---
      const liveTraps = new Set();
      for (const trap of state.traps) {
        liveTraps.add(trap.id);
        if (!trapSprites.has(trap.id)) trapSprites.set(trap.id, acquireTrap());
        const sprite = trapSprites.get(trap.id);

        const colorKey = ownerColorKey(state, trap.ownerId);
        const armed = state.tick >= trap.armedAtTick;
        sprite.setTexture(`trap-${colorKey}-${armed ? 'armed' : 'idle'}`);
        sprite.setPosition(worldToScreenX(trap.x), worldToScreenY(trap.y));
        // Scaled to the real trigger radius, so what you see is what bites.
        sprite.setScale((trap.radiusTiles * TILE_SIZE_PX * 2) / (16 * 2));
        // Armed traps pulse; about to expire, they fade.
        const remaining = trap.expiresAtTick - state.tick;
        const expiring = remaining < 90 && Math.floor(state.tick / 6) % 2 === 0;
        sprite.setAlpha(!armed ? 0.5 : expiring ? 0.35 : 0.9);
      }

      for (const [id, sprite] of trapSprites) {
        if (liveTraps.has(id)) continue;
        sprite.setVisible(false);
        freeTraps.push(sprite);
        trapSprites.delete(id);
      }
    },
  };
}
