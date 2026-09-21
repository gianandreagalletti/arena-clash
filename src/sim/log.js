// End-of-round log: a pure builder plus a console printer. Kept separate so
// `step()` itself never performs I/O — the render/game-loop layer calls
// `printRoundLog` when it notices `state.logs` grew.

import { TICK_RATE } from './config/balance.js';

/** Builds a plain, serializable end-of-round log object. Pure — no console output. */
export function buildRoundLog(state, winner) {
  const durationSec = (state.tick - state.roundStartTick) / TICK_RATE;

  return {
    roundNumber: state.roundNumber,
    durationSec,
    winnerId: winner.id,
    winnerCharacter: winner.characterId,
    winnerTookDamageInFirst30s: winner.damageTakenFirst30s,
    players: state.players.map((p) => ({
      id: p.id,
      characterId: p.characterId,
      boosts: { ...p.boosts },
      damageDealt: p.damageDealt,
      damageTaken: p.damageTaken,
      eliminations: p.eliminations,
      timeOfDeathSec: p.deathTick === null ? null : (p.deathTick - state.roundStartTick) / TICK_RATE,
    })),
  };
}

export function printRoundLog(log) {
  // eslint-disable-next-line no-console
  console.log(
    `[Round ${log.roundNumber}] winner: P${log.winnerId + 1} (${log.winnerCharacter}) ` +
      `in ${log.durationSec.toFixed(1)}s | took dmg in first 30s: ${log.winnerTookDamageInFirst30s}`
  );
  for (const p of log.players) {
    const boosts = `hp${p.boosts.hp}/spd${p.boosts.speed}/sht${p.boosts.shootDmg}/slh${p.boosts.slashDmg}`;
    // eslint-disable-next-line no-console
    console.log(
      `  P${p.id + 1} (${p.characterId}) [${boosts}]: dealt ${p.damageDealt.toFixed(1)}, ` +
        `taken ${p.damageTaken.toFixed(1)}, elims ${p.eliminations}, ` +
        `died ${p.timeOfDeathSec === null ? '-' : p.timeOfDeathSec.toFixed(1) + 's'}`
    );
  }
}
