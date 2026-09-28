import { createInitialState } from '../src/sim/state.js';
import { step, NEUTRAL_INPUT } from '../src/sim/step.js';

export function makeInput(overrides = {}) {
  return { ...NEUTRAL_INPUT, ...overrides };
}

export function neutralInputs() {
  return [makeInput(), makeInput(), makeInput()];
}

/** Steps with neutral input until the round countdown finishes and play begins. */
export function skipToPlaying(state) {
  let s = state;
  let guard = 0;
  while (s.roundState === 'countdown') {
    s = step(s, neutralInputs());
    guard += 1;
    if (guard > 10000) throw new Error('skipToPlaying: countdown never finished');
  }
  return s;
}

/** Convenience: creates a match already in the 'playing' state for round 1. */
export function newPlayingGame(seed = 1, chars = ['sniper', 'berserker', 'summoner']) {
  return skipToPlaying(createInitialState(seed, chars));
}

/**
 * Drives a between-round draft to completion by having each player take the
 * stat point in HP and their first offer, in turn order. Use this in any test
 * that crosses a round boundary — without it the sim sits in the draft phase
 * until every turn times out.
 */
export function skipDraft(state) {
  let s = state;
  let guard = 0;
  while (s.roundState === 'draft') {
    const active = s.draft.order[s.draft.turn];
    const offers = s.draft.offers[active];
    const inputs = neutralInputs();
    inputs[active] = makeInput({
      draftPick: { stat: 'hp', abilityId: offers[0] || null, replaceSlot: 0 },
    });
    s = step(s, inputs);
    guard += 1;
    if (guard > 1000) throw new Error('skipDraft: draft never finished');
  }
  return s;
}

/** Steps until the next round is actually being played, through recap and draft. */
export function advanceToNextRound(state) {
  let s = state;
  let guard = 0;
  while (s.roundState !== 'playing') {
    if (s.roundState === 'draft') {
      s = skipDraft(s);
      continue;
    }
    if (s.roundState === 'matchOver') return s;
    s = step(s, neutralInputs());
    guard += 1;
    if (guard > 5000) throw new Error('advanceToNextRound: never reached playing');
  }
  return s;
}

/** Test-only convenience: clears spawn invulnerability so scripted hits register immediately. */
export function clearInvuln(state) {
  for (const p of state.players) p.invulnUntilTick = state.tick;
  return state;
}

export { step, NEUTRAL_INPUT, createInitialState };
