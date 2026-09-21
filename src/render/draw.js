// All Phaser drawing lives here. Reads GameState and draws; never mutates it
// (architecture rule 7). Redraws every frame via Graphics.clear() + redraw —
// simple and plenty fast for the small entity counts in this MVP.

import Phaser from 'phaser';
import {
  TILE_SIZE_PX,
  ARENA_WIDTH_TILES,
  ARENA_HEIGHT_TILES,
  ROUNDS_TO_WIN_MATCH,
  CHARACTERS,
} from '../sim/config/balance.js';
import { COVER_BLOCKS, CENTER_PLATFORM } from '../sim/arena.js';

const T = TILE_SIZE_PX;

export function drawStaticArena(graphics) {
  graphics.clear();

  // Grid background.
  graphics.fillStyle(0x1a1a1a, 1);
  graphics.fillRect(0, 0, ARENA_WIDTH_TILES * T, ARENA_HEIGHT_TILES * T);
  graphics.lineStyle(1, 0x2a2a2a, 1);
  for (let x = 0; x <= ARENA_WIDTH_TILES; x++) {
    graphics.lineBetween(x * T, 0, x * T, ARENA_HEIGHT_TILES * T);
  }
  for (let y = 0; y <= ARENA_HEIGHT_TILES; y++) {
    graphics.lineBetween(0, y * T, ARENA_WIDTH_TILES * T, y * T);
  }

  // Arena border.
  graphics.lineStyle(3, 0x555555, 1);
  graphics.strokeRect(0, 0, ARENA_WIDTH_TILES * T, ARENA_HEIGHT_TILES * T);

  // Center platform (visual only).
  graphics.fillStyle(0x2a2a33, 1);
  graphics.fillRect(CENTER_PLATFORM.x * T, CENTER_PLATFORM.y * T, CENTER_PLATFORM.w * T, CENTER_PLATFORM.h * T);
  graphics.lineStyle(1, 0x444455, 1);
  graphics.strokeRect(CENTER_PLATFORM.x * T, CENTER_PLATFORM.y * T, CENTER_PLATFORM.w * T, CENTER_PLATFORM.h * T);

  // Cover blocks.
  graphics.fillStyle(0x666666, 1);
  graphics.lineStyle(2, 0x888888, 1);
  for (const block of COVER_BLOCKS) {
    graphics.fillRect(block.x * T, block.y * T, block.w * T, block.h * T);
    graphics.strokeRect(block.x * T, block.y * T, block.w * T, block.h * T);
  }
}

function colorToInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

export function drawDynamic(graphics, state, textPool) {
  graphics.clear();

  for (const proj of state.projectiles) {
    const owner = state.players.find((p) => p.id === proj.ownerId);
    const color = colorToInt(CHARACTERS[owner.characterId].color);
    graphics.fillStyle(color, 1);
    graphics.fillCircle(proj.x * T, proj.y * T, Math.max(2, proj.radius * T));
  }

  for (const explosion of state.explosions) {
    graphics.fillStyle(0xffcc66, 0.35);
    graphics.fillCircle(explosion.x * T, explosion.y * T, explosion.radius * T);
    graphics.lineStyle(2, 0xffcc66, 0.9);
    graphics.strokeCircle(explosion.x * T, explosion.y * T, explosion.radius * T);
  }

  for (const swing of state.meleeSwings) {
    const color = colorToInt(CHARACTERS[state.players[swing.playerId].characterId].color);
    const aimAngle = Math.atan2(swing.aimY, swing.aimX);
    const half = ((swing.arcDegrees / 2) * Math.PI) / 180;
    graphics.fillStyle(color, 0.35);
    graphics.beginPath();
    graphics.moveTo(swing.x * T, swing.y * T);
    graphics.arc(
      swing.x * T,
      swing.y * T,
      swing.reachTiles * T,
      aimAngle - half,
      aimAngle + half,
      false
    );
    graphics.closePath();
    graphics.fillPath();
  }

  for (const player of state.players) {
    drawPlayer(graphics, player, state);
  }

  updateHud(textPool, state);
}

function drawPlayer(graphics, player, state) {
  const def = CHARACTERS[player.characterId];
  const color = colorToInt(def.color);
  const px = player.x * T;
  const py = player.y * T;
  const radiusPx = player.radiusTiles * T;

  if (!player.alive) {
    // Spectator ghost.
    graphics.fillStyle(color, 0.2);
    graphics.fillCircle(px, py, radiusPx);
    return;
  }

  const invuln = state.tick < player.invulnUntilTick;
  graphics.fillStyle(color, invuln ? 0.5 : 1);
  graphics.fillCircle(px, py, radiusPx);
  if (invuln) {
    graphics.lineStyle(2, 0xffffff, 0.8);
    graphics.strokeCircle(px, py, radiusPx + 3);
  }

  // Aim direction triangle.
  const angle = Math.atan2(player.aimY, player.aimX);
  const tipX = px + Math.cos(angle) * (radiusPx + 10);
  const tipY = py + Math.sin(angle) * (radiusPx + 10);
  const leftX = px + Math.cos(angle + 2.6) * radiusPx;
  const leftY = py + Math.sin(angle + 2.6) * radiusPx;
  const rightX = px + Math.cos(angle - 2.6) * radiusPx;
  const rightY = py + Math.sin(angle - 2.6) * radiusPx;
  graphics.fillStyle(0xffffff, 0.9);
  graphics.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);

  // HP bar.
  const barW = 32;
  const barH = 4;
  const barX = px - barW / 2;
  const barY = py - radiusPx - 12;
  const hpFrac = Math.max(0, player.hp / player.maxHp);
  graphics.fillStyle(0x000000, 0.6);
  graphics.fillRect(barX, barY, barW, barH);
  graphics.fillStyle(hpFrac > 0.3 ? 0x4caf50 : 0xe53935, 1);
  graphics.fillRect(barX, barY, barW * hpFrac, barH);
}

/** Creates the 3 corner HUD text objects + round/match banner text once. Called from create(). */
export function createHud(scene) {
  const hud = {
    players: [0, 1, 2].map((i) =>
      scene.add
        .text(8, 8 + i * 54, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' })
        .setScrollFactor(0)
        .setDepth(10)
    ),
    banner: scene.add
      .text(ARENA_WIDTH_TILES * T * 0.5, ARENA_HEIGHT_TILES * T * 0.5, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20),
    disconnectBanner: scene.add
      .text(ARENA_WIDTH_TILES * T * 0.5, 20, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff5555',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20),
  };
  return hud;
}

function updateHud(hud, state) {
  state.players.forEach((p, i) => {
    const def = CHARACTERS[p.characterId];
    hud.players[i].setText(
      `P${i + 1} ${def.name}\nHP ${Math.ceil(p.hp)}/${p.maxHp}  ULT ${Math.floor(p.ultCharge)}\nWins ${p.roundsWon}/${ROUNDS_TO_WIN_MATCH}`
    );
    hud.players[i].setColor(colorToCss(def.color));
  });

  if (state.roundState === 'countdown') {
    const secs = Math.ceil(state.roundStateTimerTicks / 60);
    hud.banner.setText(`Round ${state.roundNumber}\n${secs}`);
  } else if (state.roundState === 'recap') {
    const log = state.logs[state.logs.length - 1];
    const scores = state.players.map((p) => p.roundsWon).join(' - ');
    hud.banner.setText(
      log ? `Round ${log.roundNumber} — P${log.winnerId + 1} wins!\nScore: ${scores}` : ''
    );
  } else if (state.roundState === 'matchOver') {
    hud.banner.setText(`Player ${state.matchWinner + 1} wins the match!\nPress A / Space to rematch`);
  } else {
    hud.banner.setText('');
  }
}

function colorToCss(hex) {
  return hex;
}
