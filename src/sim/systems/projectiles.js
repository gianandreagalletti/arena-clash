// Projectile spawning, movement, aim assist, and collision (players, cover, arena edges).
//
// A projectile's velocity is set ONCE, at fire time, and is never written again
// anywhere in this file — no sliding, no re-routing, no axis cancelling. It
// travels a straight line until it hits a player, a cover block or an arena
// edge, and is destroyed at that point. (Player movement DOES slide along
// walls, but that lives in systems/movement.js and is not shared with this.)

import {
  ACTIONS,
  TICK_RATE,
  ARENA_WIDTH_TILES,
  ARENA_HEIGHT_TILES,
  AIM_ASSIST_ENABLED,
  AIM_ASSIST_CONE_DEGREES,
  AIM_ASSIST_MAX_BEND_DEGREES,
} from '../config/balance.js';
import { COVER_BLOCKS, circleIntersectsRect } from '../arena.js';
import { applyDamage, isUntargetable, damageableEntities, belongsTo } from './damage.js';

const SUBSTEPS = 4; // swept-ish movement so fast projectiles don't tunnel through thin cover

// NOTE: AIM_ASSIST_ENABLED_BY_DEVICE (balance.js) is intentionally NOT read here.
// The sim never knows which device a player uses (architecture rule), so a true
// per-device assist toggle can't live inside sim/. It's kept as a documented,
// currently-unused config knob for a future input-layer-side implementation.
// See README "Deviations" for details.

/**
 * Rotates the aim toward an opposing player inside the configured cone, by at
 * most AIM_ASSIST_MAX_BEND_DEGREES. Invariants: it only ever rotates toward a
 * *player*, never because of walls or cover, and with no player in the cone it
 * returns the raw aim unchanged. Currently unreachable — AIM_ASSIST_ENABLED is
 * false (see the single guard in spawnProjectile).
 */
function bendTowardNearestEnemy(dirX, dirY, owner, players) {
  const maxBendDeg = AIM_ASSIST_MAX_BEND_DEGREES;
  if (maxBendDeg <= 0) return { x: dirX, y: dirY };

  const coneRad = (AIM_ASSIST_CONE_DEGREES * Math.PI) / 180;
  const maxBendRad = (maxBendDeg * Math.PI) / 180;
  const aimAngle = Math.atan2(dirY, dirX);

  let bestAngleDiff = Infinity;
  let bestSigned = 0;
  for (const p of players) {
    if (p.id === owner.id || !p.alive) continue;
    const dx = p.x - owner.x;
    const dy = p.y - owner.y;
    if (dx === 0 && dy === 0) continue;
    const angleToTarget = Math.atan2(dy, dx);
    let diff = angleToTarget - aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) <= coneRad && Math.abs(diff) < bestAngleDiff) {
      bestAngleDiff = Math.abs(diff);
      bestSigned = diff;
    }
  }

  if (bestAngleDiff === Infinity) return { x: dirX, y: dirY };

  const bend = Math.sign(bestSigned) * Math.min(Math.abs(bestSigned), maxBendRad);
  const newAngle = aimAngle + bend;
  return { x: Math.cos(newAngle), y: Math.sin(newAngle) };
}

/** True if a circle at (x, y) starts inside cover or outside the arena bounds. */
function isInsideGeometry(x, y, radius) {
  if (x < 0 || x > ARENA_WIDTH_TILES || y < 0 || y > ARENA_HEIGHT_TILES) return true;
  return COVER_BLOCKS.some((block) => circleIntersectsRect(x, y, radius, block));
}

/** Spawns one Shoot projectile for `owner`, travelling exactly along the aim at fire time. */
export function spawnProjectile(state, owner) {
  const shoot = ACTIONS.shoot;
  const mag = Math.hypot(owner.aimX, owner.aimY) || 1;
  const rawX = owner.aimX / mag;
  const rawY = owner.aimY / mag;

  // The one and only aim-assist guard. Disabled -> the fired direction is
  // exactly the raw input aim, for every player and every device.
  const aimDir = AIM_ASSIST_ENABLED
    ? bendTowardNearestEnemy(rawX, rawY, owner, state.players)
    : { x: rawX, y: rawY };

  // A muzzle inside geometry is destroyed, never relocated — relocating is what
  // would push a shot sideways out of a wall. Unreachable today (the muzzle is
  // the player's center, and movement.js keeps that center clear of cover and
  // bounds), but it's the rule if a muzzle offset is ever added.
  if (isInsideGeometry(owner.x, owner.y, shoot.projectileRadiusTiles)) return;

  state.projectiles.push({
    id: state.nextProjectileId++,
    ownerId: owner.id,
    kind: 'projectile', // 'projectile_aoe' is retained but unused this week (see explode())
    x: owner.x,
    y: owner.y,
    // Written once, here. Nothing else ever touches vx/vy.
    // Speed is the owner's (Sniper's rounds fly faster), resolved in state.js.
    vx: aimDir.x * owner.shootProjectileSpeed,
    vy: aimDir.y * owner.shootProjectileSpeed,
    radius: shoot.projectileRadiusTiles,
    damage: owner.shootDamage, // boost-derived, per player
    remainingRangeTiles: shoot.rangeTiles, // null = unlimited
    ageTicks: 0,
    explodeRadiusTiles: 0,
  });
}

/**
 * Area-damage impact. No Week 1 action spawns a 'projectile_aoe', so this is
 * currently dead code — kept wired (rather than deleted) because Week 2/3
 * abilities are expected to reuse it.
 */
function explode(state, proj, x, y) {
  state.explosions.push({ x, y, radius: proj.explodeRadiusTiles, tick: state.tick, ownerId: proj.ownerId });
  const owner = state.players.find((p) => p.id === proj.ownerId);
  for (const target of damageableEntities(state)) {
    if (belongsTo(target, proj.ownerId)) continue; // no self-damage
    if (isUntargetable(state, target)) continue;
    const dist = Math.hypot(target.x - x, target.y - y);
    if (dist <= proj.explodeRadiusTiles + target.radiusTiles) {
      applyDamage(state, target, proj.damage, owner);
    }
  }
}

/** Advances every projectile one tick, resolving hits/explosions/removal. */
export function updateProjectiles(state) {
  const surviving = [];

  for (const proj of state.projectiles) {
    const owner = state.players.find((p) => p.id === proj.ownerId);
    const totalDx = proj.vx / TICK_RATE;
    const totalDy = proj.vy / TICK_RATE;
    const totalDist = Math.hypot(totalDx, totalDy);

    let stepX = proj.x;
    let stepY = proj.y;
    let stopped = false;
    let hitTarget = null;

    for (let s = 1; s <= SUBSTEPS && !stopped; s++) {
      const px = proj.x + (totalDx * s) / SUBSTEPS;
      const py = proj.y + (totalDy * s) / SUBSTEPS;

      // Arena edges.
      if (px < 0 || px > ARENA_WIDTH_TILES || py < 0 || py > ARENA_HEIGHT_TILES) {
        stepX = Math.max(0, Math.min(ARENA_WIDTH_TILES, px));
        stepY = Math.max(0, Math.min(ARENA_HEIGHT_TILES, py));
        stopped = true;
        break;
      }

      // Cover blocks.
      for (const block of COVER_BLOCKS) {
        if (circleIntersectsRect(px, py, proj.radius, block)) {
          stepX = px;
          stepY = py;
          stopped = true;
          break;
        }
      }
      if (stopped) break;

      // Players and dogs alike (skipping the shooter's own entities).
      for (const target of damageableEntities(state)) {
        if (belongsTo(target, proj.ownerId)) continue;
        if (isUntargetable(state, target)) continue;
        const dist = Math.hypot(target.x - px, target.y - py);
        if (dist <= proj.radius + target.radiusTiles) {
          stepX = px;
          stepY = py;
          stopped = true;
          hitTarget = target;
          break;
        }
      }
      if (stopped) break;

      stepX = px;
      stepY = py;
    }

    proj.ageTicks += 1;
    if (proj.remainingRangeTiles !== null) proj.remainingRangeTiles -= totalDist;
    proj.x = stepX;
    proj.y = stepY;

    const outOfRange = proj.remainingRangeTiles !== null && proj.remainingRangeTiles <= 0;
    const expired = proj.ageTicks >= ACTIONS.shoot.maxLifetimeTicks; // leak guard only
    const terminated = stopped || outOfRange || expired;

    if (terminated) {
      if (hitTarget) {
        if (proj.kind === 'projectile_aoe') {
          explode(state, proj, proj.x, proj.y);
        } else {
          applyDamage(state, hitTarget, proj.damage, owner);
        }
      } else if (proj.kind === 'projectile_aoe') {
        // Impact with cover, arena edge, or max range still explodes.
        explode(state, proj, proj.x, proj.y);
      }
      // Non-AoE projectiles that hit cover/edge/max-range without a target simply vanish.
    } else {
      surviving.push(proj);
    }
  }

  state.projectiles = surviving;
}
