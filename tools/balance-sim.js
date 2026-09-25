#!/usr/bin/env node
// Balance simulator: plays many bot-vs-bot-vs-bot matches through the pure
// sim (src/sim/) and reports per-character win rates and combat stats, so
// balance drift (someone too strong/too weak) shows up as numbers instead
// of a gut feeling from playtesting.
//
// Usage:
//   node tools/balance-sim.js [--matches=300] [--seed=1000] [--boosts=zero|random] [--json=out.json] [--verbose]
//
// Only imports from src/sim/ — never touches Phaser/DOM. Bot decision logic
// lives entirely in this file and is intentionally simple: the goal is a
// consistent, "reasonable" player for every character, not a perfect one,
// so the numbers reflect character design rather than bot skill.

import { writeFileSync } from 'node:fs';
import { createInitialState, createEmptyBoosts } from '../src/sim/state.js';
import { step, NEUTRAL_INPUT } from '../src/sim/step.js';
import { CHARACTERS, CHARACTER_IDS, ACTIONS, BOOST_CATEGORIES, BOOST_POINTS_PER_PLAYER } from '../src/sim/config/balance.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { matches: 300, seed: 1000, boosts: 'zero', json: null, verbose: false, maxTicks: 60 * 60 * 5 };
  for (const raw of argv) {
    const [key, val] = raw.replace(/^--/, '').split('=');
    if (key === 'matches') args.matches = parseInt(val, 10);
    else if (key === 'seed') args.seed = parseInt(val, 10);
    else if (key === 'boosts') args.boosts = val;
    else if (key === 'json') args.json = val;
    else if (key === 'maxTicks') args.maxTicks = parseInt(val, 10);
    else if (key === 'verbose') args.verbose = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Tiny seeded RNG for bot decisions (kept OUT of src/sim on purpose — the
// sim itself must stay Math.random-free and RNG-pure; this is match-runner
// tooling, not gameplay logic).
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Bot policy
//
// Every character gets the same decision loop; only per-character tuning
// (preferred engagement range, ability usage) differs, via STYLE/ability
// checks below. This isolates "is the character strong" from "is the bot
// smart" as much as a simple heuristic bot can.
// ---------------------------------------------------------------------------

const STYLE = {
  // preferredRange: distance the bot tries to settle at once no better move
  // is available. minRange: below this, a kiter actively backs away.
  sniper: { preferredRange: 7, minRange: 4.5 },
  berserker: { preferredRange: 0, minRange: 0 }, // always closes in
  summoner: { preferredRange: 5, minRange: 2.5 },
};

const SHIELD_HP_THRESHOLD = 0.35; // pop shield below this HP fraction, if ready

function createBotState(seed) {
  return { rand: mulberry32(seed), strafeSign: 1, nextStrafeFlipTick: 0 };
}

function pickTarget(state, selfId) {
  let best = null;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (p.id === selfId || !p.alive) continue;
    const d = Math.hypot(p.x - state.players[selfId].x, p.y - state.players[selfId].y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { target: best, dist: bestDist } : null;
}

function botDecide(state, selfIndex, botState) {
  const self = state.players[selfIndex];
  if (!self.alive) return NEUTRAL_INPUT;

  const picked = pickTarget(state, self.id);
  if (!picked) return NEUTRAL_INPUT;
  const { target, dist } = picked;

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const nx = dist > 0 ? dx / dist : 0;
  const ny = dist > 0 ? dy / dist : 0;

  const style = STYLE[self.characterId];
  let moveX = 0;
  let moveY = 0;

  if (dist > style.preferredRange + 1) {
    moveX = nx;
    moveY = ny; // close the gap
  } else if (style.minRange > 0 && dist < style.minRange) {
    moveX = -nx;
    moveY = -ny; // kite away
  } else {
    // Hold range: strafe perpendicular, flipping direction every ~0.5-1.2s
    // so the bot reads as circling rather than vibrating in place.
    if (state.tick >= botState.nextStrafeFlipTick) {
      botState.strafeSign = botState.rand() < 0.5 ? -1 : 1;
      botState.nextStrafeFlipTick = state.tick + 30 + Math.floor(botState.rand() * 40);
    }
    moveX = -ny * botState.strafeSign;
    moveY = nx * botState.strafeSign;
  }

  const wantShield = self.hp / self.maxHp < SHIELD_HP_THRESHOLD && state.tick >= self.shieldReadyAtTick;
  const wantSlash = dist <= ACTIONS.slash.reachTiles && self.slashCooldownTicks <= 0;

  let wantUlt = false;
  const def = CHARACTERS[self.characterId];
  if (def.nova) {
    // Only worth starting the telegraphed windup if the target is already in
    // (or about to walk into) blast range, and no windup is already running.
    wantUlt = !self.charging && self.ultCharge >= def.nova.ultCost && dist <= def.nova.radiusTiles + 1.5;
  } else if (def.dog) {
    // Harmless to hold this "true" every tick: canSummonDog() in the sim
    // already no-ops while a dog is alive or the respawn cooldown is up.
    wantUlt = state.tick >= self.dogReadyAtTick;
  }

  return {
    moveX,
    moveY,
    aimX: nx,
    aimY: ny,
    fire: true, // gated by the sim's own shootCooldownTicks check
    slash: wantSlash,
    shield: wantShield,
    ult: wantUlt,
  };
}

// ---------------------------------------------------------------------------
// Match runner
// ---------------------------------------------------------------------------

// All 6 permutations of the 3 characters across the 3 spawn slots, so which
// character sits at which spawn point is cancelled out over many matches
// even though the arena is already rotationally symmetric.
const PERMUTATIONS = [
  ['sniper', 'berserker', 'summoner'],
  ['sniper', 'summoner', 'berserker'],
  ['berserker', 'sniper', 'summoner'],
  ['berserker', 'summoner', 'sniper'],
  ['summoner', 'sniper', 'berserker'],
  ['summoner', 'berserker', 'sniper'],
];

function randomBoosts(rand) {
  // Spends all BOOST_POINTS_PER_PLAYER points across categories with random
  // weights (a crude stand-in for "some player made some build choice").
  const weights = BOOST_CATEGORIES.map(() => rand());
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / totalWeight) * BOOST_POINTS_PER_PLAYER);
  const floored = raw.map(Math.floor);
  let spent = floored.reduce((a, b) => a + b, 0);
  // Hand out leftover points (rounding) to the highest-weight categories.
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a]);
  let k = 0;
  while (spent < BOOST_POINTS_PER_PLAYER) {
    floored[order[k % order.length]] += 1;
    spent += 1;
    k += 1;
  }
  const boosts = createEmptyBoosts();
  BOOST_CATEGORIES.forEach((cat, i) => (boosts[cat] = floored[i]));
  return boosts;
}

function runMatch({ seed, characterIds, boostAllocations, maxTicks }) {
  let state = createInitialState(seed, characterIds, boostAllocations);
  const botStates = characterIds.map((_, i) => createBotState(seed * 7919 + i * 104729 + 1));

  while (state.roundState !== 'matchOver' && state.tick < maxTicks) {
    const inputs = characterIds.map((_, i) => botDecide(state, i, botStates[i]));
    state = step(state, inputs);
  }

  return {
    timedOut: state.roundState !== 'matchOver',
    matchWinnerCharacter: state.matchWinner !== null ? characterIds[state.matchWinner] : null,
    logs: state.logs, // one entry per round played, with per-player stats
  };
}

// ---------------------------------------------------------------------------
// Aggregation + report
// ---------------------------------------------------------------------------

function emptyAgg() {
  return {
    roundsPlayed: 0,
    roundsWon: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    damageDealt: 0,
    damageTaken: 0,
    eliminations: 0,
    survivedRounds: 0, // rounds where this character was NOT eliminated
    survivalSecSum: 0, // only counted when eliminated (time to death)
    deaths: 0,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agg = Object.fromEntries(CHARACTER_IDS.map((id) => [id, emptyAgg()]));
  let timeouts = 0;

  const boostRand = mulberry32(args.seed + 999);

  for (let m = 0; m < args.matches; m++) {
    const seed = args.seed + m;
    const characterIds = PERMUTATIONS[m % PERMUTATIONS.length];
    const boostAllocations =
      args.boosts === 'random' ? characterIds.map(() => randomBoosts(boostRand)) : characterIds.map(() => createEmptyBoosts());

    const result = runMatch({ seed, characterIds, boostAllocations, maxTicks: args.maxTicks });
    if (result.timedOut) timeouts += 1;

    for (const id of characterIds) agg[id].matchesPlayed += 1;
    if (result.matchWinnerCharacter) agg[result.matchWinnerCharacter].matchesWon += 1;

    for (const log of result.logs) {
      for (const p of log.players) {
        const a = agg[p.characterId];
        a.roundsPlayed += 1;
        a.damageDealt += p.damageDealt;
        a.damageTaken += p.damageTaken;
        a.eliminations += p.eliminations;
        if (p.timeOfDeathSec === null) {
          a.survivedRounds += 1;
        } else {
          a.deaths += 1;
          a.survivalSecSum += p.timeOfDeathSec;
        }
      }
      agg[log.winnerCharacter].roundsWon += 1;
    }

    if (args.verbose) {
      console.log(
        `match ${m + 1}/${args.matches} seed=${seed} [${characterIds.join(',')}] -> ` +
          `${result.matchWinnerCharacter ?? 'TIMEOUT'} (${result.logs.length} rounds)`
      );
    }
  }

  const n = CHARACTER_IDS.length;
  const expectedWinRate = 1 / n;

  const report = CHARACTER_IDS.map((id) => {
    const a = agg[id];
    const roundWinRate = a.roundsPlayed ? a.roundsWon / a.roundsPlayed : 0;
    const matchWinRate = a.matchesPlayed ? a.matchesWon / a.matchesPlayed : 0;
    const avgDeathTime = a.deaths ? a.survivalSecSum / a.deaths : null;
    return {
      character: id,
      roundsPlayed: a.roundsPlayed,
      roundWinRate,
      matchWinRate,
      avgDamageDealt: a.roundsPlayed ? a.damageDealt / a.roundsPlayed : 0,
      avgDamageTaken: a.roundsPlayed ? a.damageTaken / a.roundsPlayed : 0,
      avgEliminations: a.roundsPlayed ? a.eliminations / a.roundsPlayed : 0,
      survivalRate: a.roundsPlayed ? a.survivedRounds / a.roundsPlayed : 0,
      avgDeathTimeSec: avgDeathTime,
      deviationFromExpected: roundWinRate - expectedWinRate,
    };
  });

  console.log(`\nArena Clash balance report — ${args.matches} matches, boosts=${args.boosts}, seed base=${args.seed}`);
  if (timeouts > 0) console.log(`WARNING: ${timeouts} match(es) hit the ${args.maxTicks}-tick cap without resolving.`);
  console.log('');
  console.log(
    'character   round-win%  match-win%  avg-dealt  avg-taken  avg-elims  survival%  avg-death-s  flag'
  );
  for (const r of report) {
    const flag =
      Math.abs(r.deviationFromExpected) > 0.08
        ? r.deviationFromExpected > 0 ? '⚠ strong' : '⚠ weak'
        : '';
    console.log(
      `${r.character.padEnd(11)} ${(r.roundWinRate * 100).toFixed(1).padStart(9)}%  ` +
        `${(r.matchWinRate * 100).toFixed(1).padStart(9)}%  ` +
        `${r.avgDamageDealt.toFixed(1).padStart(9)}  ` +
        `${r.avgDamageTaken.toFixed(1).padStart(9)}  ` +
        `${r.avgEliminations.toFixed(2).padStart(9)}  ` +
        `${(r.survivalRate * 100).toFixed(1).padStart(8)}%  ` +
        `${(r.avgDeathTimeSec === null ? '-' : r.avgDeathTimeSec.toFixed(1)).padStart(10)}  ${flag}`
    );
  }
  console.log(`\n(expected round-win rate at perfect balance: ${(expectedWinRate * 100).toFixed(1)}%)`);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ args, timeouts, report }, null, 2));
    console.log(`\nJSON report written to ${args.json}`);
  }
}

main();
