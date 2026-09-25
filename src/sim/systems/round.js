// Round lifecycle: countdown -> playing -> recap -> next round / match over.
// Also handles the double-knockout "void round" replay case.

import {
  SPAWN_INVULN_TICKS,
  ROUND_COUNTDOWN_TICKS,
  ROUND_RECAP_TICKS,
  ROUNDS_TO_WIN_MATCH,
  ULT_CHARGE_CARRY_FRACTION,
} from '../config/balance.js';
import { SPAWN_POINTS } from '../arena.js';
import { buildRoundLog } from '../log.js';

/**
 * Resets one player's per-round state (position, HP, cooldowns, stats).
 * Ult charge is handled by the caller. Boost-derived stats (maxHp, speed,
 * shoot/slash damage) are match-long and deliberately left untouched.
 */
function resetPlayerForRound(player) {
  const spawn = SPAWN_POINTS[player.id];
  player.x = spawn.x;
  player.y = spawn.y;
  player.aimX = spawn.defaultAimX;
  player.aimY = spawn.defaultAimY;
  player.hp = player.maxHp;
  player.alive = true;
  player.shootCooldownTicks = 0;
  player.slashCooldownTicks = 0;
  player.shieldActiveUntilTick = 0;
  player.shieldReadyAtTick = 0;
  player.charging = null;
  player.chargeReleaseTick = 0;
  player.dogReadyAtTick = 0; // a fresh round starts with the dog available
  player.invulnUntilTick = 0; // set once the round actually starts playing
  player.damageDealt = 0;
  player.damageTaken = 0;
  player.eliminations = 0;
  player.deathTick = null;
  player.damageTakenFirst30s = false;
}

/** Begins a fresh round: `carryUlt` applies the 50% carry-over; false for void-round replays. */
export function beginRound(state, { carryUlt }) {
  for (const player of state.players) {
    if (carryUlt) {
      player.ultCharge = Math.floor(player.ultCharge * ULT_CHARGE_CARRY_FRACTION);
    }
    resetPlayerForRound(player);
  }
  state.dogs = []; // minions don't survive a round boundary
  state.projectiles = [];
  state.roundState = 'countdown';
  state.roundStateTimerTicks = ROUND_COUNTDOWN_TICKS;
}

export function tickCountdown(state) {
  state.roundStateTimerTicks -= 1;
  if (state.roundStateTimerTicks <= 0) {
    state.roundState = 'playing';
    state.roundStartTick = state.tick;
    for (const player of state.players) {
      player.invulnUntilTick = state.tick + SPAWN_INVULN_TICKS;
    }
  }
}

/** Checks alive-player count after combat resolves; handles round end / void replay. */
export function checkRoundEnd(state) {
  const alive = state.players.filter((p) => p.alive);

  if (alive.length === 1) {
    const winner = alive[0];
    winner.roundsWon += 1;
    const log = buildRoundLog(state, winner);
    state.logs.push(log);
    state.pendingLogPrint = log;
    state.pendingMatchOver = winner.roundsWon >= ROUNDS_TO_WIN_MATCH;
    state.roundState = 'recap';
    state.roundStateTimerTicks = ROUND_RECAP_TICKS;
  } else if (alive.length === 0) {
    state.voidRoundThisTick = true;
    beginRound(state, { carryUlt: false });
  }
}

export function tickRecap(state) {
  state.roundStateTimerTicks -= 1;
  if (state.roundStateTimerTicks <= 0) {
    if (state.pendingMatchOver) {
      const winner = state.players.reduce((a, b) => (a.roundsWon > b.roundsWon ? a : b));
      state.roundState = 'matchOver';
      state.matchWinner = winner.id;
    } else {
      state.roundNumber += 1;
      beginRound(state, { carryUlt: true });
    }
  }
}
