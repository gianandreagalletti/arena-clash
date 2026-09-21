// Projectile spawning, movement, aim assist, and collision (players, cover, arena edges).

import {
  TICK_RATE,
  ARENA_WIDTH_TILES,
  ARENA_HEIGHT_TILES,
  AIM_ASSIST_CONE_DEGREES,
  AIM_ASSIST_MAX_BEND_DEGREES,
} from '../config/balance.js';
import { COVER_BLOCKS, circleIntersectsRect } from '../arena.js';
import { applyDamage, isUntargetable } from './damage.js';

const SUBSTEPS = 4; // swept-ish movement so fast projectiles don't tunnel through thin cover

// NOTE: AIM_ASSIST_ENABLED_BY_DEVICE (balance.js) is intentionally NOT read here.
// The sim never knows which device a player uses (architecture rule), so a true
// per-device assist toggle can't live inside sim/. It's kept as a documented,
// currently-unused config knob for a future input-layer-side implementation.
// See README "Deviations" for details.

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

/** Spawns one projectile for `owner`'s attack, applying aim assist. */
export function spawnProjectile(state, owner, characterDef) {
  const { attack } = characterDef;
  const mag = Math.hypot(owner.aimX, owner.aimY) || 1;
  const aimDir = bendTowardNearestEnemy(owner.aimX / mag, owner.aimY / mag, owner, state.players);

  state.projectiles.push({
    id: state.nextProjectileId++,
    ownerId: owner.id,
    kind: attack.kind, // 'projectile' | 'projectile_aoe'
    x: owner.x,
    y: owner.y,
    vx: aimDir.x * attack.speedTilesPerSec,
    vy: aimDir.y * attack.speedTilesPerSec,
    radius: attack.projectileRadiusTiles,
    damage: attack.damage,
    remainingRangeTiles: attack.rangeTiles,
    explodeRadiusTiles: attack.explodeRadiusTiles ?? 0,
  });
}

function explode(state, proj, x, y) {
  state.explosions.push({ x, y, radius: proj.explodeRadiusTiles, tick: state.tick, ownerId: proj.ownerId });
  const owner = state.players.find((p) => p.id === proj.ownerId);
  for (const target of state.players) {
    if (target.id === proj.ownerId) continue; // no self-damage
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

      // Players (skip owner and untargetable players).
      for (const target of state.players) {
        if (target.id === proj.ownerId) continue;
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

    proj.remainingRangeTiles -= totalDist;
    proj.x = stepX;
    proj.y = stepY;

    const outOfRange = proj.remainingRangeTiles <= 0;
    const terminated = stopped || outOfRange;

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
