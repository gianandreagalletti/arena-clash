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
      // Drafted loadout, and what it actually did this round. `abilityUses`
      // counts activations that dealt no damage (dashes, summons, Vanish);
      // `damageByAbility` holds the rest, so an ability shows up in exactly one
      // of the two and neither double-counts the other.
      statPicks: { ...p.statPicks },
      slots: [...p.abilities.slots],
      passives: [...p.abilities.passives],
      abilityUses: nonZero(p.abilityUses),
      damageByAbility: nonZero(p.damageByAbility),
    })),
    // The draft that set up this round: who picked in what order, what each
    // player was offered, what they took, and whether the clock took it for
    // them. Null before round 1, which has no draft in front of it.
    draft: state.lastDraft ? buildDraftLog(state) : null,
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

/** The stored draft, flattened to one row per player IN PICK ORDER. */
function buildDraftLog(state) {
  const draft = state.lastDraft;

  return {
    order: [...draft.order],
    picks: draft.order.map((playerId) => {
      const pick = draft.picks[playerId];
      return {
        playerId,
        characterId: state.players[playerId].characterId,
        offers: [...(draft.offers[playerId] || [])],
        stat: pick ? pick.stat : null,
        abilityId: pick ? pick.abilityId || null : null,
        // Where the ability actually went and what it pushed out, not what the
        // input asked for — an input's replaceSlot goes unused when a slot is free.
        slot: pick && pick.slot !== undefined ? pick.slot : null,
        replaced: pick && pick.replaced !== undefined ? pick.replaced : null,
        timedOut: !!(pick && pick.timedOut),
      };
    }),
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

    const slots = p.slots.map((id) => id || '-').join('/');
    const passives = p.passives.length ? p.passives.join(' ') : '-';
    const picks = Object.entries(p.statPicks).filter(([, n]) => n > 0);
    // eslint-disable-next-line no-console
    console.log(
      `      loadout: slots ${slots} | passives ${passives}` +
        (picks.length ? ` | stat picks ${picks.map(([k, n]) => `${k}+${n}`).join(' ')}` : '')
    );

    const abilityParts = [];
    for (const [id, dealt] of Object.entries(p.damageByAbility)) abilityParts.push(`${id} ${dealt.toFixed(1)} dmg`);
    for (const [id, uses] of Object.entries(p.abilityUses)) abilityParts.push(`${id} x${uses}`);
    // eslint-disable-next-line no-console
    if (abilityParts.length) console.log(`      abilities: ${abilityParts.join(' | ')}`);

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

  if (log.draft) {
    // eslint-disable-next-line no-console
    console.log(`  draft (pick order P${log.draft.order.map((id) => id + 1).join(' > P')}):`);
    for (const pick of log.draft.picks) {
      const took = pick.abilityId || 'stat only';
      let where = '';
      if (pick.replaced) where = ` (slot ${pick.slot + 1}, dropped ${pick.replaced})`;
      else if (pick.slot !== null) where = ` (slot ${pick.slot + 1})`;
      // eslint-disable-next-line no-console
      console.log(
        `      P${pick.playerId + 1} (${pick.characterId}) offered [${pick.offers.join(', ') || '-'}] ` +
          `-> +${pick.stat} + ${took}${where}${pick.timedOut ? ' [TIMED OUT]' : ''}`
      );
    }
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
