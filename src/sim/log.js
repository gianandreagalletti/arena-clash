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
      // Only the types actually picked up, so the log stays readable.
      pickupsCollected: nonZero(p.pickupsCollected),
      itemsUsed: nonZero(p.itemsUsed),
      damageByExplosive: nonZero(p.damageByExplosive),
      // Full counts, including zeros: this is the column we'll correlate
      // against round wins, so it must be uniform across players.
      amulets: { ...p.amulets },
    })),
    // Every item that spawned this round and what became of it.
    pickupEvents: state.roundPickupEvents.map((e) => ({
      type: e.type,
      family: e.family,
      spawnSec: (e.spawnTick - state.roundStartTick) / TICK_RATE,
      outcome: e.outcome,
      collectedBy: e.collectedBy,
    })),
  };
}

function nonZero(counts) {
  const out = {};
  for (const [key, value] of Object.entries(counts)) if (value) out[key] = value;
  return out;
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

    const held = Object.entries(p.amulets).filter(([, n]) => n > 0);
    const extras = [];
    if (held.length) extras.push(`amulets ${held.map(([k, n]) => `${shortName(k)}x${n}`).join(' ')}`);
    if (Object.keys(p.pickupsCollected).length) {
      extras.push(`picked ${Object.entries(p.pickupsCollected).map(([k, n]) => `${k}x${n}`).join(' ')}`);
    }
    if (Object.keys(p.itemsUsed).length) {
      extras.push(`used ${Object.entries(p.itemsUsed).map(([k, n]) => `${k}x${n}`).join(' ')}`);
    }
    if (Object.keys(p.damageByExplosive).length) {
      extras.push(
        `explosive dmg ${Object.entries(p.damageByExplosive).map(([k, n]) => `${k} ${n.toFixed(1)}`).join(' ')}`
      );
    }
    // eslint-disable-next-line no-console
    if (extras.length) console.log(`      ${extras.join(' | ')}`);
  }

  if (log.pickupEvents.length) {
    // eslint-disable-next-line no-console
    console.log(
      `  items: ${log.pickupEvents
        .map((e) => {
          const who = e.outcome === 'collected' ? `P${e.collectedBy + 1}` : e.outcome;
          return `${e.type}@${e.spawnSec.toFixed(1)}s->${who}`;
        })
        .join(', ')}`
    );
  }
}

function shortName(amuletId) {
  return amuletId.replace(/^amulet/, '');
}
