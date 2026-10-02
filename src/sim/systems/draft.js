// The between-round draft: +1 stat point and 1 ability out of 3, per player,
// one player at a time.
//
// Pick order is deliberately worst-last: the round winner picks first and the
// player who died first picks last, so whoever is behind gets to see every
// other choice before committing. That is the only catch-up mechanic here.
//
// Offers come from the seeded RNG in state and picks arrive through the
// InputFrame, so a recorded match replays identically, draft included.

import { DRAFT, abilityPoolFor, abilityConfig, BOOST_CATEGORIES } from '../config/balance.js';
import { nextRandom } from '../rng.js';
import { recomputeDerivedStats } from '../state.js';

function draw(state) {
  const roll = nextRandom(state.rng);
  state.rng = roll.rng;
  return roll.value;
}

/** Every ability this player already holds, in either form. */
export function ownedAbilities(player) {
  return [...player.abilities.passives, ...player.abilities.slots.filter(Boolean)];
}

/**
 * Pick order for the round just played: winner first, then eliminations from
 * latest to earliest. Two players eliminated on the same tick tie, and the
 * lower player index goes first.
 */
export function buildPickOrder(players) {
  return [...players]
    .sort((a, b) => {
      const aAlive = a.deathTick === null;
      const bAlive = b.deathTick === null;
      if (aAlive !== bAlive) return aAlive ? -1 : 1; // survivor first
      if (a.deathTick !== b.deathTick) return b.deathTick - a.deathTick; // died later = picks earlier
      return a.id - b.id; // same tick: lower index first
    })
    .map((p) => p.id);
}

/**
 * Three abilities drawn uniformly without replacement from the character's
 * pool, skipping anything already owned. Fewer than three if the pool is
 * nearly exhausted; an empty list means "stat point only".
 */
function rollOffers(state, player) {
  const owned = new Set(ownedAbilities(player));
  const candidates = abilityPoolFor(player.characterId).filter((id) => !owned.has(id));

  const offers = [];
  while (offers.length < DRAFT.offersPerDraft && candidates.length > 0) {
    const index = Math.floor(draw(state) * candidates.length);
    offers.push(candidates.splice(index, 1)[0]);
  }
  return offers;
}

/** Opens the draft. Offers for all three players are rolled up front, in player order. */
export function beginDraft(state) {
  const order = buildPickOrder(state.players);
  const offers = {};
  // Rolled in player-index order, NOT pick order, so the RNG stream does not
  // depend on who happened to win.
  for (const player of state.players) offers[player.id] = rollOffers(state, player);

  state.draft = {
    order,
    turn: 0,
    turnEndsAtTick: state.tick + DRAFT.turnTimeTicks,
    offers,
    picks: { 0: null, 1: null, 2: null },
  };
  state.roundState = 'draft';
}

function activePlayerId(state) {
  return state.draft.order[state.draft.turn];
}

/** True if this pick is legal for the player whose turn it is. */
function isValidPick(state, playerId, pick) {
  if (!pick || playerId !== activePlayerId(state)) return false;
  if (!BOOST_CATEGORIES.includes(pick.stat)) return false;

  const player = state.players[playerId];
  const offers = state.draft.offers[playerId];

  // Stat-only pick, valid exactly when there was nothing left to offer.
  if (pick.abilityId === null || pick.abilityId === undefined) return offers.length === 0;
  if (!offers.includes(pick.abilityId)) return false;

  const config = abilityConfig(player.characterId, pick.abilityId);
  if (!config) return false;
  if (config.type !== 'active') return true;

  // An active with both slots full must say which one it replaces.
  const freeSlot = player.abilities.slots.indexOf(null);
  if (freeSlot !== -1) return true;
  return pick.replaceSlot === 0 || pick.replaceSlot === 1;
}

function applyPick(state, playerId, pick) {
  const player = state.players[playerId];

  player.statPicks[pick.stat] += 1;

  // What the pick actually DID, as opposed to what the input asked for: an
  // input may carry a replaceSlot that is never used because a slot was free.
  // The end-of-round log reports these, so they have to be the truth.
  let slot = null;
  let replaced = null;

  if (pick.abilityId) {
    const config = abilityConfig(player.characterId, pick.abilityId);
    if (config.type === 'passive') {
      player.abilities.passives.push(pick.abilityId);
    } else {
      const freeSlot = player.abilities.slots.indexOf(null);
      // A replaced ability simply returns to the pool and can be offered again.
      slot = freeSlot !== -1 ? freeSlot : pick.replaceSlot;
      replaced = freeSlot !== -1 ? null : player.abilities.slots[slot];
      player.abilities.slots[slot] = pick.abilityId;
    }
  }

  // Stat points and passives both feed the derived stats, so recompute once,
  // here — never per tick.
  recomputeDerivedStats(player);
  state.draft.picks[playerId] = { ...pick, slot, replaced };
}

/**
 * The default when a turn runs out: the stat point goes to HP and the first
 * offer is taken. An active offer with no free slot is skipped entirely rather
 * than silently evicting something the player chose earlier.
 */
function timeoutPick(state, playerId) {
  const player = state.players[playerId];
  const offers = state.draft.offers[playerId];
  const first = offers[0] || null;

  let abilityId = first;
  if (first) {
    const config = abilityConfig(player.characterId, first);
    if (config.type === 'active' && player.abilities.slots.indexOf(null) === -1) abilityId = null;
  }
  return { stat: 'hp', abilityId, replaceSlot: null, timedOut: true };
}

function advanceTurn(state) {
  state.draft.turn += 1;
  state.draft.turnEndsAtTick = state.tick + DRAFT.turnTimeTicks;
}

/**
 * One tick of the draft. `inputs` is the usual per-player InputFrame array;
 * only `draftPick` from the active player is read, and only when valid.
 * Returns true once every player has picked.
 */
export function tickDraft(state, inputs) {
  const playerId = activePlayerId(state);
  const pick = inputs[playerId] ? inputs[playerId].draftPick : null;

  if (isValidPick(state, playerId, pick)) {
    applyPick(state, playerId, pick);
    advanceTurn(state);
  } else if (state.tick >= state.draft.turnEndsAtTick) {
    applyPick(state, playerId, timeoutPick(state, playerId));
    advanceTurn(state);
  }

  return state.draft.turn >= state.players.length;
}
