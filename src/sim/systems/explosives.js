// Grenades and mines: the two usable pickups that occupy the item slot.
//
// Both land in state.explosives and blow up through the normal damage path, so
// Shield reduction, spawn invulnerability, ult charge and elimination credit
// all behave exactly as they do for a bullet. Explosions deliberately ignore
// line of sight this pass (see the TODO in balance.js): cover does not block a
// blast.

import { PICKUPS, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES } from '../config/balance.js';
import { COVER_BLOCKS, circleIntersectsRect } from '../arena.js';
import { applyDamage, isUntargetable, damageableEntities, belongsTo } from './damage.js';

const THROW_STEPS = 60; // sampling resolution along the throw line

/**
 * Where a thrown grenade comes to rest: straight along the aim vector, up to
 * range, stopping just short of cover or the arena edge.
 */
function throwLanding(x, y, dirX, dirY, rangeTiles) {
  let last = { x, y };
  for (let i = 1; i <= THROW_STEPS; i++) {
    const dist = (i / THROW_STEPS) * rangeTiles;
    const px = x + dirX * dist;
    const py = y + dirY * dist;
    if (px < 0 || px > ARENA_WIDTH_TILES || py < 0 || py > ARENA_HEIGHT_TILES) return last;
    if (COVER_BLOCKS.some((block) => circleIntersectsRect(px, py, PICKUPS.pickupRadius, block))) return last;
    last = { x: px, y: py };
  }
  return last;
}

/** Consumes the item slot and spawns the grenade or mine. Caller checks the Shield block. */
export function useItem(state, player) {
  const kind = player.item;
  if (!kind) return;
  player.item = null;
  player.itemsUsed[kind] += 1;

  if (kind === 'grenade') {
    const cfg = PICKUPS.temporary.grenade;
    const mag = Math.hypot(player.aimX, player.aimY) || 1;
    const landing = throwLanding(player.x, player.y, player.aimX / mag, player.aimY / mag, cfg.rangeTiles);
    state.explosives.push({
      id: state.nextExplosiveId++,
      kind: 'grenade',
      ownerId: player.id,
      // Origin is kept so the renderer can animate the throw across the fuse.
      originX: player.x,
      originY: player.y,
      x: landing.x,
      y: landing.y,
      explodeAtTick: state.tick + cfg.fuseTicks,
      armedAtTick: state.tick,
      radiusTiles: cfg.radiusTiles,
      damage: cfg.damage,
    });
    return;
  }

  const cfg = PICKUPS.temporary.mine;
  state.explosives.push({
    id: state.nextExplosiveId++,
    kind: 'mine',
    ownerId: player.id,
    originX: player.x,
    originY: player.y,
    x: player.x,
    y: player.y,
    explodeAtTick: null, // mines wait for a victim, not a clock
    armedAtTick: state.tick + cfg.armTicks,
    triggerRadiusTiles: cfg.triggerRadiusTiles,
    radiusTiles: cfg.radiusTiles,
    damage: cfg.damage,
  });
}

function detonate(state, explosive) {
  const owner = state.players.find((p) => p.id === explosive.ownerId) || null;

  state.explosions.push({
    id: state.nextExplosionId++,
    kind: explosive.kind,
    x: explosive.x,
    y: explosive.y,
    radiusTiles: explosive.radiusTiles,
    ownerId: explosive.ownerId,
    tick: state.tick,
  });

  for (const target of damageableEntities(state)) {
    if (belongsTo(target, explosive.ownerId)) continue; // never the owner or their dog
    if (isUntargetable(state, target)) continue;
    // Body overlap, so anyone actually touching the blast is caught. (The
    // Berserker nova uses center-to-center instead, per its own spec.)
    const dist = Math.hypot(target.x - explosive.x, target.y - explosive.y);
    if (dist > explosive.radiusTiles + target.radiusTiles) continue;

    const dealt = applyDamage(state, target, explosive.damage, owner);
    if (owner && dealt > 0) owner.damageByExplosive[explosive.kind] += dealt;
  }
}

/** True if any living non-owner player is standing on an armed mine. */
function mineTriggered(state, mine) {
  if (state.tick < mine.armedAtTick) return false;
  return state.players.some(
    (p) =>
      p.alive &&
      p.id !== mine.ownerId &&
      Math.hypot(p.x - mine.x, p.y - mine.y) <= mine.triggerRadiusTiles + p.radiusTiles
  );
}

/**
 * Ticks every live explosive. An owner who has been eliminated still gets
 * their pending grenade and their standing mines — those keep working and the
 * damage is still credited to them.
 */
export function updateExplosives(state) {
  if (state.explosives.length === 0) return;

  const surviving = [];
  for (const explosive of state.explosives) {
    const blown =
      explosive.kind === 'grenade' ? state.tick >= explosive.explodeAtTick : mineTriggered(state, explosive);
    if (blown) detonate(state, explosive);
    else surviving.push(explosive);
  }
  state.explosives = surviving;
}
