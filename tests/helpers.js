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

/** Test-only convenience: clears spawn invulnerability so scripted hits register immediately. */
export function clearInvuln(state) {
  for (const p of state.players) p.invulnUntilTick = state.tick;
  return state;
}

export { step, NEUTRAL_INPUT, createInitialState };
