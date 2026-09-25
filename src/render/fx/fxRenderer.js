// Combat FX: pooled projectiles + trail, 8-direction pre-drawn slash smears,
// shield is handled in playerRenderer.js (it's anchored to the player), and
// elimination "poof" + optional camera shake.
//
// All render-side memory (pools, active-swing tracking, previous alive state)
// lives in this module's closures, never in sim state.

import Phaser from 'phaser';
import { TILE_SIZE_PX, CHARACTERS } from '../../sim/config/balance.js';
import { worldToScreenX, worldToScreenY } from '../coords.js';
import { PALETTE, paletteKeyForCharacterColor } from '../art/palette.js';
import { snapToCompassDirection } from '../art/textures.js';

const FX_DEPTH = 7000;
const TELEGRAPH_DEPTH = -10; // above the floor, below every player and cover block
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

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/**
 * A hand-drawn blocky ring, rather than a smooth strokeCircle, so it reads as
 * pixel art at any radius. Block count scales with the radius so the spacing
 * stays even as the shockwave grows.
 */
function drawPixelRing(graphics, cx, cy, radiusPx, blockSize, color, alpha) {
  if (radiusPx <= 0) return;
  const steps = Math.max(8, Math.round((radiusPx * 2 * Math.PI) / (blockSize * 1.6)));
  graphics.fillStyle(color, alpha);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * radiusPx - blockSize / 2);
    const y = Math.round(cy + Math.sin(angle) * radiusPx - blockSize / 2);
    graphics.fillRect(x, y, blockSize, blockSize);
  }
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
    update(state, events) {
      for (const swing of events.meleeSwings) {
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

// --- Nova windup telegraph: where the blast lands, and when ---

const TELEGRAPH_BLINK_TICKS = 8;
const TELEGRAPH_FAST_BLINK_TICKS = 3;
const TELEGRAPH_URGENT_FRACTION = 0.75; // blink faster past this much of the windup

function createNovaTelegraph(scene) {
  const graphics = scene.add.graphics().setDepth(TELEGRAPH_DEPTH);

  return {
    update(state) {
      graphics.clear();

      for (const player of state.players) {
        if (player.charging !== 'nova' || !player.alive) continue;
        const nova = CHARACTERS[player.characterId].nova;
        if (!nova) continue;

        // Progress straight from sim state — no render-side start-tick
        // bookkeeping needed. Normalised over the frames the telegraph is
        // actually VISIBLE for: `remaining` runs windupTicks..1 (the release
        // tick itself clears `charging`, so it is never drawn), so dividing by
        // windupTicks would top out at 1-1/w and the ring would never quite
        // fill. Dividing by w-1 makes it land on exactly 1 on the last frame
        // before the blast.
        const remaining = player.chargeReleaseTick - state.tick;
        const span = Math.max(1, nova.windupTicks - 1);
        const progress = Math.max(0, Math.min(1, (nova.windupTicks - remaining) / span));

        const cx = worldToScreenX(player.x);
        const cy = worldToScreenY(player.y);
        const radiusPx = nova.radiusTiles * TILE_SIZE_PX;
        const accent = colorInt(CHARACTERS[player.characterId].color);

        // Fill grows from the center until it reaches the ring as the blast fires.
        graphics.fillStyle(accent, 0.18);
        graphics.fillCircle(cx, cy, radiusPx * progress);

        // The ring itself sits at the true radius for the whole windup, so you
        // can judge the edge from the first frame.
        const blinkTicks = progress >= TELEGRAPH_URGENT_FRACTION ? TELEGRAPH_FAST_BLINK_TICKS : TELEGRAPH_BLINK_TICKS;
        const bright = Math.floor(state.tick / blinkTicks) % 2 === 0;
        drawPixelRing(graphics, cx, cy, radiusPx, 4, accent, bright ? 0.95 : 0.4);

        // Small glow on the caster.
        graphics.fillStyle(accent, 0.25);
        graphics.fillCircle(cx, cy, TILE_SIZE_PX * 0.45);
      }
    },
  };
}

// --- Nova blast ---

const BLAST_TICKS = 7;
const BLAST_SHAKE_MS = 90;
const BLAST_SHAKE_INTENSITY = 0.005;

function createNovaBlastFx(scene) {
  const graphics = scene.add.graphics().setDepth(FX_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
  const active = []; // { x, y, radiusPx, startTick, accent }
  const seen = new Set(); // dedupe key, see below

  return {
    update(state, events) {
      for (const blast of events.novaBlasts) {
        // state.novaBlasts entries carry no id, so dedupe on the only
        // combination that is unique: a given player can only blast once on a
        // given tick. (Flagged in the PR — an explicit id would be cleaner.)
        const key = `${blast.playerId}:${blast.tick}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const caster = state.players.find((p) => p.id === blast.playerId);
        active.push({
          x: worldToScreenX(blast.x),
          y: worldToScreenY(blast.y),
          radiusPx: blast.radiusTiles * TILE_SIZE_PX,
          startTick: state.tick,
          accent: colorInt(caster ? CHARACTERS[caster.characterId].color : PALETTE.uiText),
        });
        if (ELIMINATION_SHAKE_ENABLED) scene.cameras.main.shake(BLAST_SHAKE_MS, BLAST_SHAKE_INTENSITY);
      }

      graphics.clear();
      for (let i = active.length - 1; i >= 0; i--) {
        const blast = active[i];
        const elapsed = state.tick - blast.startTick;
        if (elapsed >= BLAST_TICKS) {
          active.splice(i, 1);
          continue;
        }
        const t = elapsed / BLAST_TICKS;
        const fade = 1 - t;
        // Shockwave expanding out to the true radius, white core inside an
        // owner-colored edge.
        drawPixelRing(graphics, blast.x, blast.y, blast.radiusPx * t, 5, blast.accent, fade);
        drawPixelRing(graphics, blast.x, blast.y, blast.radiusPx * t - 3, 3, 0xffffff, fade * 0.9);
      }

      if (seen.size > 64) seen.clear(); // the key set can't grow forever
    },
  };
}

// --- Dog lifecycle: spawn pop, death poof, bite chomp ---

const DOG_SPAWN_TICKS = 4;
const DOG_DEATH_TICKS = 6;
const BITE_TICKS = 3;

function createDogFx(scene) {
  const prevDogs = new Map(); // dogId -> { alive, x, y, cooldown, colorKey }
  const puffs = []; // { sprite, startTick, angle, x, y, lifetime, spread }
  const bites = []; // { sprite, startTick }
  const freeBites = [];

  function spawnPuff(state, x, y, colorKey, count, lifetime, spread) {
    for (let i = 0; i < count; i++) {
      const sprite = scene.add.sprite(x, y, `particle-${colorKey}`);
      sprite.setDepth(FX_DEPTH);
      puffs.push({ sprite, startTick: state.tick, angle: (i / count) * Math.PI * 2, x, y, lifetime, spread });
    }
  }

  function showBite(state, x, y) {
    const sprite = freeBites.pop() || scene.add.sprite(0, 0, 'bite').setDepth(FX_DEPTH);
    sprite.setPosition(x, y);
    sprite.setVisible(true);
    bites.push({ sprite, startTick: state.tick });
  }

  /** The player a dog is biting: same "nearest targetable enemy" rule the sim uses. */
  function biteTarget(state, dog) {
    let best = null;
    let bestDist = Infinity;
    for (const player of state.players) {
      if (player.id === dog.ownerId || !player.alive) continue;
      const dist = Math.hypot(player.x - dog.x, player.y - dog.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = player;
      }
    }
    return best;
  }

  return {
    update(state) {
      const live = new Set();

      for (const dog of state.dogs) {
        live.add(dog.id);
        const owner = state.players.find((p) => p.id === dog.ownerId);
        const colorKey = owner ? paletteKeyForCharacterColor(CHARACTERS[owner.characterId].color) : 'red';
        const prev = prevDogs.get(dog.id);

        if (!prev) {
          // Pop-in, so a dog never simply appears.
          spawnPuff(state, worldToScreenX(dog.x), worldToScreenY(dog.y), colorKey, 4, DOG_SPAWN_TICKS, 0.35);
        } else if (dog.attackCooldownTicks > prev.cooldown) {
          // The sim exposes no bite event, but the attack cooldown only ever
          // jumps UP on the tick a bite actually lands. (Flagged in the PR.)
          const target = biteTarget(state, dog);
          if (target) showBite(state, worldToScreenX(target.x), worldToScreenY(target.y));
        }

        prevDogs.set(dog.id, {
          alive: true,
          x: dog.x,
          y: dog.y,
          cooldown: dog.attackCooldownTicks,
          colorKey,
        });
      }

      // Dogs that vanished from state since last frame died: poof, no shake.
      for (const [id, prev] of prevDogs) {
        if (live.has(id)) continue;
        spawnPuff(state, worldToScreenX(prev.x), worldToScreenY(prev.y), prev.colorKey, 5, DOG_DEATH_TICKS, 0.45);
        prevDogs.delete(id);
      }

      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        const elapsed = state.tick - p.startTick;
        if (elapsed >= p.lifetime) {
          p.sprite.destroy();
          puffs.splice(i, 1);
          continue;
        }
        const dist = (elapsed / p.lifetime) * TILE_SIZE_PX * p.spread;
        p.sprite.setPosition(p.x + Math.cos(p.angle) * dist, p.y + Math.sin(p.angle) * dist);
        p.sprite.setAlpha(1 - elapsed / p.lifetime);
      }

      for (let i = bites.length - 1; i >= 0; i--) {
        const b = bites[i];
        if (state.tick - b.startTick >= BITE_TICKS) {
          b.sprite.setVisible(false);
          freeBites.push(b.sprite);
          bites.splice(i, 1);
        }
      }
    },
  };
}

export function createFxRenderer(scene) {
  const projectiles = createProjectilePool(scene);
  const slash = createSlashFx(scene);
  const elimination = createEliminationFx(scene);
  const telegraph = createNovaTelegraph(scene);
  const blast = createNovaBlastFx(scene);
  const dogFx = createDogFx(scene);

  return {
    /**
     * `events` carries the transient per-tick sim data accumulated across every
     * sim tick this frame (GameScene can run several), so a blast is never
     * missed just because another tick ran after it.
     */
    update(state, events) {
      projectiles.update(state);
      slash.update(state, events);
      elimination.update(state);
      telegraph.update(state);
      blast.update(state, events);
      dogFx.update(state);
    },
  };
}
