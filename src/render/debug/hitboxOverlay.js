// F3 debug overlay: draws the sim's actual collision geometry (player radius,
// cover rects, arena bounds, projectile radius, slash reach arc) as 1px lines
// over the art, so hitbox/art alignment can be checked at a glance.

import { ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES, PLAYER_RADIUS_TILES } from '../../sim/config/balance.js';
import { COVER_BLOCKS } from '../../sim/arena.js';
import { worldToScreenX, worldToScreenY } from '../coords.js';

export function createHitboxOverlay(scene) {
  const graphics = scene.add.graphics().setDepth(20000);
  graphics.setVisible(false);

  return {
    setVisible(visible) {
      graphics.setVisible(visible);
    },
    update(state) {
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
    },
  };
}
