// Combat FX: pooled projectiles + trail, 8-direction pre-drawn slash smears,
// shield is handled in playerRenderer.js (it's anchored to the player), and
// elimination "poof" + optional camera shake.
//
// All render-side memory (pools, active-swing tracking, previous alive state)
// lives in this module's closures, never in sim state.

import { TILE_SIZE_PX, CHARACTERS } from '../../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from '../coords.js';
import { paletteKeyForCharacterColor } from '../art/palette.js';
import { snapToCompassDirection } from '../art/textures.js';

const FX_DEPTH = 7000;
const SLASH_DISPLAY_TICKS = 6; // sim exposes no swing-duration field; matches the change request's fallback
const SLASH_FRAME_COUNT = 3;
const ELIMINATION_DISPLAY_TICKS = 6;
const ELIMINATION_SHAKE_ENABLED = true; // single flag — flip off to disable camera shake entirely
const ELIMINATION_SHAKE_MS = 100;
const ELIMINATION_SHAKE_INTENSITY = 0.006;

function ownerColorKey(state, ownerId) {
  const owner = state.players.find((p) => p.id === ownerId);
  return paletteKeyForCharacterColor(CHARACTERS[owner.characterId].color);
}

// --- Projectiles (pooled) ---

function createProjectilePool(scene) {
  const active = new Map(); // projectileId -> { core, trailA, trailB, prevX, prevY }
  const free = [];

  function acquire(colorKey) {
    let entry = free.pop();
    if (!entry) {
      entry = {
        core: scene.add.sprite(0, 0, `proj-${colorKey}`),
        trailA: scene.add.sprite(0, 0, `proj-trail-${colorKey}`),
        trailB: scene.add.sprite(0, 0, `proj-trail-${colorKey}`),
      };
      entry.core.setDepth(FX_DEPTH);
      entry.trailA.setDepth(FX_DEPTH - 1);
      entry.trailB.setDepth(FX_DEPTH - 2);
    } else {
      entry.core.setTexture(`proj-${colorKey}`);
      entry.trailA.setTexture(`proj-trail-${colorKey}`);
      entry.trailB.setTexture(`proj-trail-${colorKey}`);
    }
    entry.core.setVisible(true);
    entry.trailA.setVisible(true).setAlpha(0.55);
    entry.trailB.setVisible(true).setAlpha(0.25);
    return entry;
  }

  function release(entry) {
    entry.core.setVisible(false);
    entry.trailA.setVisible(false);
    entry.trailB.setVisible(false);
    free.push(entry);
  }

  return {
    update(state) {
      const seen = new Set();

      for (const proj of state.projectiles) {
        seen.add(proj.id);
        const screenX = worldToScreenX(proj.x);
        const screenY = worldToScreenY(proj.y);

        let entry = active.get(proj.id);
        if (!entry) {
          entry = acquire(ownerColorKey(state, proj.ownerId));
          entry.prevX = screenX;
          entry.prevY = screenY;
          active.set(proj.id, entry);
        }

        entry.trailB.setPosition(entry.prevX, entry.prevY);
        entry.trailA.setPosition((entry.prevX + screenX) / 2, (entry.prevY + screenY) / 2);
        entry.core.setPosition(screenX, screenY);

        entry.prevX = screenX;
        entry.prevY = screenY;
      }

      for (const [id, entry] of active) {
        if (!seen.has(id)) {
          release(entry);
          active.delete(id);
        }
      }
    },
  };
}

// --- Slash smears (8 pre-drawn directions x 3 frames, pooled by attacker slot) ---

function createSlashFx(scene) {
  const activeByPlayer = new Map(); // playerId -> { sprite, startTick, colorKey, dir }

  function spriteFor(playerId) {
    let entry = activeByPlayer.get(playerId);
    if (!entry) {
      const sprite = scene.add.sprite(0, 0, 'slash-red-E-0');
      sprite.setDepth(FX_DEPTH);
      entry = { sprite, startTick: -Infinity, colorKey: 'red', dir: 'E' };
      activeByPlayer.set(playerId, entry);
    }
    return entry;
  }

  return {
    update(state) {
      for (const swing of state.meleeSwings) {
        const entry = spriteFor(swing.playerId);
        entry.startTick = state.tick;
        entry.colorKey = ownerColorKey(state, swing.playerId);
        entry.dir = snapToCompassDirection(Math.atan2(swing.aimY, swing.aimX));
        entry.sprite.setPosition(worldToScreenX(swing.x), worldToScreenY(swing.y));
      }

      for (const entry of activeByPlayer.values()) {
        const elapsed = state.tick - entry.startTick;
        if (elapsed < 0 || elapsed >= SLASH_DISPLAY_TICKS) {
          entry.sprite.setVisible(false);
          continue;
        }
        const frame = Math.min(
          SLASH_FRAME_COUNT - 1,
          Math.floor((elapsed / SLASH_DISPLAY_TICKS) * SLASH_FRAME_COUNT)
        );
        entry.sprite.setTexture(`slash-${entry.colorKey}-${entry.dir}-${frame}`);
        entry.sprite.setOrigin(0.5, 0.5);
        entry.sprite.setVisible(true);
      }
    },
  };
}

// --- Elimination poof + optional camera shake ---

function createEliminationFx(scene) {
  const wasAlive = new Map(); // playerId -> boolean, to detect the alive->dead edge
  const particles = []; // { sprite, startTick, angle, colorKey }
  const POOF_PARTICLE_COUNT = 6;

  function spawn(state, player) {
    const colorKey = paletteKeyForCharacterColor(CHARACTERS[player.characterId].color);
    const x = worldToScreenX(player.x);
    const y = worldToScreenY(player.y);
    for (let i = 0; i < POOF_PARTICLE_COUNT; i++) {
      const sprite = scene.add.sprite(x, y, `particle-${colorKey}`);
      sprite.setDepth(FX_DEPTH);
      particles.push({ sprite, startTick: state.tick, angle: (i / POOF_PARTICLE_COUNT) * Math.PI * 2, x, y });
    }
    if (ELIMINATION_SHAKE_ENABLED) {
      scene.cameras.main.shake(ELIMINATION_SHAKE_MS, ELIMINATION_SHAKE_INTENSITY);
    }
  }

  return {
    update(state) {
      for (const player of state.players) {
        const prev = wasAlive.get(player.id);
        if (prev === true && player.alive === false) spawn(state, player);
        wasAlive.set(player.id, player.alive);
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const elapsed = state.tick - p.startTick;
        if (elapsed >= ELIMINATION_DISPLAY_TICKS) {
          p.sprite.destroy();
          particles.splice(i, 1);
          continue;
        }
        const dist = (elapsed / ELIMINATION_DISPLAY_TICKS) * TILE_SIZE_PX * 0.6;
        p.sprite.setPosition(p.x + Math.cos(p.angle) * dist, p.y + Math.sin(p.angle) * dist);
        p.sprite.setAlpha(1 - elapsed / ELIMINATION_DISPLAY_TICKS);
      }
    },
  };
}

export function createFxRenderer(scene) {
  const projectiles = createProjectilePool(scene);
  const slash = createSlashFx(scene);
  const elimination = createEliminationFx(scene);

  return {
    update(state) {
      projectiles.update(state);
      slash.update(state);
      elimination.update(state);
    },
  };
}
