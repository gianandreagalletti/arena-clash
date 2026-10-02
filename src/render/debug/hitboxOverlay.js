// F3 debug overlay: draws the sim's actual collision geometry (player radius,
// cover rects, arena bounds, projectile radius, slash reach arc, dash paths,
// Whirlwind reach, trap trigger radius, viper hitbox and target) as 1px lines
// over the art, so hitbox/art alignment can be checked at a glance.
//
// It also draws the mouse-aim chain used to diagnose the aim-offset bug:
//   green cross  = the keyboard/mouse player's SIM position
//   cyan cross   = the world aim point the SIM receives
//   white square = the raw pointer pixel, as the browser reports it
// When the conversion is right, the cyan cross sits exactly under the
// crosshair, and the white square sits on top of it.

import {
  ARENA_WIDTH_TILES,
  ARENA_HEIGHT_TILES,
  PLAYER_RADIUS_TILES,
  CHARACTERS,
  TICK_RATE,
} from '../../sim/config/balance.js';
import { COVER_BLOCKS, SPAWN_CANDIDATE_TILES } from '../../sim/arena.js';
import { worldToScreenX, worldToScreenY } from '../coords.js';

function drawCross(graphics, x, y, size) {
  graphics.beginPath();
  graphics.moveTo(x - size, y);
  graphics.lineTo(x + size, y);
  graphics.moveTo(x, y - size);
  graphics.lineTo(x, y + size);
  graphics.strokePath();
}

/** Nearest targetable enemy of `ownerId` — the same rule dogs and vipers use. */
function nearestEnemy(state, ownerId, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const player of state.players) {
    if (player.id === ownerId || !player.alive) continue;
    const dist = Math.hypot(player.x - x, player.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

export function createHitboxOverlay(scene) {
  const graphics = scene.add.graphics().setDepth(20000);
  graphics.setVisible(false);

  return {
    setVisible(visible) {
      graphics.setVisible(visible);
    },
    /**
     * `aim` (optional): { player, aimWorld, pointer } — the keyboard/mouse
     * player's sim position, the world aim point the sim got, and the live
     * Phaser pointer, for the aim-chain markers.
     */
    update(state, aim) {
      if (!graphics.visible) return;
      graphics.clear();

      // Arena bounds.
      graphics.lineStyle(1, 0x00ffff, 0.9);
      graphics.strokeRect(
        worldToScreenX(0),
        worldToScreenY(0),
        (ARENA_WIDTH_TILES) * (worldToScreenX(1) - worldToScreenX(0)),
        (ARENA_HEIGHT_TILES) * (worldToScreenY(1) - worldToScreenY(0))
      );

      // Cover blocks.
      graphics.lineStyle(1, 0xffff00, 0.9);
      for (const block of COVER_BLOCKS) {
        graphics.strokeRect(
          worldToScreenX(block.x),
          worldToScreenY(block.y),
          worldToScreenX(block.x + block.w) - worldToScreenX(block.x),
          worldToScreenY(block.y + block.h) - worldToScreenY(block.y)
        );
      }

      const tileToPx = worldToScreenX(1) - worldToScreenX(0);
      const radiusPx = PLAYER_RADIUS_TILES * tileToPx;

      // Players.
      graphics.lineStyle(1, 0x00ff00, 0.9);
      for (const player of state.players) {
        if (!player.alive) continue;
        graphics.strokeCircle(worldToScreenX(player.x), worldToScreenY(player.y), radiusPx);
      }

      // Nova radius — drawn always, not only while charging, so the telegraph
      // ring can be checked against the real number at any time.
      for (const player of state.players) {
        const nova = CHARACTERS[player.characterId].nova;
        if (!nova || !player.alive) continue;
        graphics.lineStyle(1, 0xff4444, player.charging === 'nova' ? 0.9 : 0.35);
        graphics.strokeCircle(worldToScreenX(player.x), worldToScreenY(player.y), nova.radiusTiles * tileToPx);
      }

      // Dogs: hitbox, plus a line to the enemy they're biased toward.
      for (const dog of state.dogs) {
        const dx = worldToScreenX(dog.x);
        const dy = worldToScreenY(dog.y);
        graphics.lineStyle(1, 0x00ff88, 0.9);
        graphics.strokeCircle(dx, dy, dog.radiusTiles * tileToPx);

        const target = nearestEnemy(state, dog.ownerId, dog.x, dog.y);
        if (target) {
          graphics.lineStyle(1, 0x00ff88, 0.4);
          graphics.lineBetween(dx, dy, worldToScreenX(target.x), worldToScreenY(target.y));
        }
      }

      // Vipers: hitbox plus a line to the enemy they're hunting, same rule the
      // sim uses to pick one. Owner-agnostic colour — the line says whose it is.
      for (const viper of state.vipers) {
        const vx = worldToScreenX(viper.x);
        const vy = worldToScreenY(viper.y);
        graphics.lineStyle(1, 0x7ce07c, 0.9);
        graphics.strokeCircle(vx, vy, viper.radiusTiles * tileToPx);

        const target = nearestEnemy(state, viper.ownerId, viper.x, viper.y);
        if (target) {
          graphics.lineStyle(1, 0x7ce07c, 0.4);
          graphics.lineBetween(vx, vy, worldToScreenX(target.x), worldToScreenY(target.y));
        }
      }

      // Thorn traps: the real trigger radius, bright once armed. An unarmed
      // trap is drawn too, so you can see one before it can bite.
      for (const trap of state.traps) {
        const armed = state.tick >= trap.armedAtTick;
        graphics.lineStyle(1, 0x3fa34d, armed ? 0.9 : 0.3);
        graphics.strokeCircle(worldToScreenX(trap.x), worldToScreenY(trap.y), trap.radiusTiles * tileToPx);
      }

      // Dashes (Charge and Roll): the path still to run, and the end point.
      // A Charge also sweeps players along the way; a Roll is invulnerable, so
      // the two are drawn in different colours.
      for (const player of state.players) {
        if (!player.dash) continue;
        // vx/vy are tiles per SECOND — the sim divides by TICK_RATE each tick,
        // so the remaining path has to as well or the line overshoots 60x.
        const remaining = Math.max(0, player.dash.ticksLeft);
        const px = worldToScreenX(player.x);
        const py = worldToScreenY(player.y);
        const endX = worldToScreenX(player.x + (player.dash.vx / TICK_RATE) * remaining);
        const endY = worldToScreenY(player.y + (player.dash.vy / TICK_RATE) * remaining);

        graphics.lineStyle(1, player.dash.invulnerable ? 0x4ee0c0 : 0xff5a4e, 0.9);
        graphics.lineBetween(px, py, endX, endY);
        graphics.strokeCircle(endX, endY, radiusPx);
      }

      // Whirlwind reach, for anyone holding it: it is the player's real Slash
      // reach, drawn always so the ring FX can be checked against the number.
      for (const player of state.players) {
        if (!player.alive || !player.abilities.slots.includes('whirlwind')) continue;
        graphics.lineStyle(1, 0xff5a4e, 0.3);
        graphics.strokeCircle(worldToScreenX(player.x), worldToScreenY(player.y), player.slashReachTiles * tileToPx);
      }

      // Candidate spawn tiles, as dim dots.
      graphics.fillStyle(0x666688, 0.25);
      for (const tile of SPAWN_CANDIDATE_TILES) {
        graphics.fillRect(worldToScreenX(tile.x) - 1, worldToScreenY(tile.y) - 1, 2, 2);
      }

      // Each player's real pickup reach (body radius + pickup radius, Hunter included).
      graphics.lineStyle(1, 0xf2c14e, 0.5);
      for (const player of state.players) {
        if (!player.alive) continue;
        graphics.strokeCircle(
          worldToScreenX(player.x),
          worldToScreenY(player.y),
          (player.radiusTiles + player.pickupRadiusTiles) * tileToPx
        );
      }

      // Live explosives: blast radius, plus the trigger radius for mines.
      for (const explosive of state.explosives) {
        const ex = worldToScreenX(explosive.x);
        const ey = worldToScreenY(explosive.y);
        graphics.lineStyle(1, 0xff6600, 0.8);
        graphics.strokeCircle(ex, ey, explosive.radiusTiles * tileToPx);
        if (explosive.kind === 'mine') {
          graphics.lineStyle(1, 0xff0000, state.tick >= explosive.armedAtTick ? 0.9 : 0.3);
          graphics.strokeCircle(ex, ey, explosive.triggerRadiusTiles * tileToPx);
        }
      }

      // Projectiles.
      graphics.lineStyle(1, 0xff00ff, 0.9);
      for (const proj of state.projectiles) {
        graphics.strokeCircle(worldToScreenX(proj.x), worldToScreenY(proj.y), proj.radius * tileToPx);
      }

      // Active slash swings this frame: exact reach/arc geometry.
      graphics.lineStyle(1, 0xff8800, 0.9);
      for (const swing of state.meleeSwings) {
        const cx = worldToScreenX(swing.x);
        const cy = worldToScreenY(swing.y);
        const r = swing.reachTiles * tileToPx;
        const aimAngle = Math.atan2(swing.aimY, swing.aimX);
        const half = ((swing.arcDegrees / 2) * Math.PI) / 180;
        graphics.beginPath();
        graphics.moveTo(cx, cy);
        graphics.arc(cx, cy, r, aimAngle - half, aimAngle + half, false);
        graphics.closePath();
        graphics.strokePath();
      }

      if (!aim) return;

      // Sim position of the mouse-aiming player.
      graphics.lineStyle(1, 0x00ff00, 1);
      drawCross(graphics, worldToScreenX(aim.player.x), worldToScreenY(aim.player.y), 6);

      // The world aim point the sim actually received.
      const aimScreenX = worldToScreenX(aim.aimWorld.x);
      const aimScreenY = worldToScreenY(aim.aimWorld.y);
      graphics.lineStyle(1, 0x00ffff, 1);
      drawCross(graphics, aimScreenX, aimScreenY, 8);

      // The raw pointer pixel, for comparison. Any gap between this and the
      // cyan cross is a screen -> world conversion error.
      graphics.lineStyle(1, 0xffffff, 1);
      graphics.strokeRect(aim.pointer.worldX - 4, aim.pointer.worldY - 4, 8, 8);

      // The line the shot will actually take.
      graphics.lineStyle(1, 0xff8800, 0.5);
      graphics.beginPath();
      graphics.moveTo(worldToScreenX(aim.player.x), worldToScreenY(aim.player.y));
      graphics.lineTo(aimScreenX, aimScreenY);
      graphics.strokePath();
    },
  };
}
