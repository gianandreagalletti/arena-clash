// Thin wrapper re-exporting the Summoner's data-only definition from balance.js
// (the single source of truth for numbers — architecture rule 8).
// Shoot/Slash/Shield baselines live in balance.js ACTIONS; per-character
// overrides and abilities live on this character's own CHARACTERS entry.
// Summoner identity: the killable `dog` minion (see systems/dog.js).

import { CHARACTERS } from '../config/balance.js';

export const summoner = CHARACTERS.summoner;

export default summoner;
