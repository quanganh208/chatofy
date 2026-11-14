// The two questions a decision model is asked about one translated turn.
//
// `fidelity` (choice) is the polish gate: polish when P(wrong) is high.
// `omission` (noul) is the omission check: flag when P(covers all) is low.
// Choice option order changes per repeat (see FIDELITY_ORDERS), so a run's
// repeats measure order sensitivity (a documented Jev weakness), not just
// sampling. `shuffleSeed` is the 1-based repeat number.

const FIDELITY_CRITERIA = {
  faithful: 'Same meaning, nothing added or lost',
  minor: 'Small nuance lost, meaning intact',
  wrong: 'Meaning changed, wrong, or a clause missing',
};

/**
 * Option order per repeat: each option takes each position once over three
 * repeats (a Latin square), so averaging repeats cancels position bias. A
 * seeded shuffle was tried first and gave repeats 2 and 3 the same order.
 */
export const FIDELITY_ORDERS = {
  1: ['wrong', 'faithful', 'minor'],
  2: ['minor', 'faithful', 'wrong'],
  3: ['faithful', 'wrong', 'minor'],
};

/** The fidelity criteria in the order for `repeat` (1-based; cycles past 3). */
export function orderedCriteria(repeat) {
  const order = FIDELITY_ORDERS[((repeat - 1) % 3) + 1];
  return Object.fromEntries(order.map((option) => [option, FIDELITY_CRITERIA[option]]));
}

/** One question by name; `withContext` false drops the reference to earlier turns. */
export function question(kind, { shuffleSeed = 0, withContext = true } = {}) {
  if (kind === 'fidelity') {
    return {
      type: 'choice',
      instructions: withContext
        ? 'How faithfully does `translation` render the meaning of `source`, given the earlier turns in `context`?'
        : 'How faithfully does `translation` render the meaning of `source`?',
      criteria: orderedCriteria(shuffleSeed),
    };
  }
  if (kind === 'omission') {
    return {
      type: 'noul',
      instructions: 'Does `translation` convey every sentence of `source`, including the last one?',
    };
  }
  throw new Error(`unknown question ${kind}`);
}

/** The questions for one request, keyed by name. */
export function questionsFor(kinds, options) {
  return Object.fromEntries(kinds.map((kind) => [kind, question(kind, options)]));
}

/** The state sent for one turn; the no-context arm omits `context`. */
export function stateFor(row, { withContext = true } = {}) {
  const state = { direction: row.direction, source: row.source, translation: row.translation };
  if (withContext)
    state.context = (row.context ?? []).map(({ source, translation }) => ({ source, translation }));
  return state;
}
