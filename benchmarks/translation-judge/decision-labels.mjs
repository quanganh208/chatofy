// What a polish gate should have decided on each judged prod turn.
//
//   node decision-labels.mjs   # writes data/decision/labels.jsonl
//
// The Opus judge annotated each of the 162 turns three times, once as drafted
// and once after the gpt-5.6-sol polish. A turn is a positive when its DRAFT
// carries a serious (major/critical) error the judge blames on the translator
// (`mt`) in a majority of repeats: that is the turn a gate must not skip.
// `unstable` marks turns where the repeats split (1 or 2 of 3), which the
// scorer reports both with and without. The 28 turns the polish left alone
// keep their draft verdict as their polished one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SERIOUS, consensus, loadJudgements } from './consensus.mjs';
import { DATA, RESULTS, readJsonl, toJsonl, turnId } from './rows.mjs';

const DRAFT_RUN = join(RESULTS, 'full-claude-opus-5-5');
const POLISHED_RUN = join(RESULTS, 'arm2-gpt-5.6-sol-claude-opus-5-5');
const POLISHED_ARM = join(DATA, 'arms', 'arm-2-gpt-5.6-sol.jsonl');
const TURNS = join(DATA, 'turns.scribed.jsonl');
export const LABELS = join(DATA, 'decision', 'labels.jsonl');

function hasSeriousMt(answer) {
  return (answer.errors ?? []).some((e) => e.origin === 'mt' && SERIOUS.has(e.severity));
}

export function buildLabels() {
  const draft = loadJudgements(DRAFT_RUN).byId;
  const polished = loadJudgements(POLISHED_RUN).byId;
  const turns = new Map(readJsonl(TURNS).map((row) => [turnId(row), row]));
  const labels = [];
  for (const arm of readJsonl(POLISHED_ARM)) {
    const id = turnId(arm);
    const draftAnswers = draft.get(id);
    if (!draftAnswers?.length) throw new Error(`${id}: no draft judgement`);
    const polishedAnswers = arm.rewritten ? polished.get(id) : draftAnswers;
    if (!polishedAnswers?.length) throw new Error(`${id}: rewritten but no polished judgement`);
    const turn = turns.get(id);
    if (!turn) throw new Error(`${id}: not in turns.scribed.jsonl`);
    const draftConsensus = consensus(draftAnswers).keys;
    const mtVotes = draftAnswers.filter(hasSeriousMt).length;
    const draftSeriousMt = draftConsensus.has('mt');
    const polishedSeriousMt = consensus(polishedAnswers).keys.has('mt');
    labels.push({
      conv: arm.conv,
      pos: arm.pos,
      direction: arm.direction,
      draftSeriousMt,
      draftSeriousAny: draftConsensus.has('any'),
      polishedSeriousMt,
      unstable: mtVotes > 0 && mtVotes < draftAnswers.length,
      polishFixed: draftSeriousMt && !polishedSeriousMt,
      source: turn.source,
      draft: turn.translation,
      context: turn.context ?? [],
    });
  }
  return labels.sort((a, b) => turnId(a).localeCompare(turnId(b)));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const labels = buildLabels();
  mkdirSync(join(DATA, 'decision'), { recursive: true });
  writeFileSync(LABELS, toJsonl(labels));
  const count = (f) => labels.filter(f).length;
  console.error(
    `${labels.length} turns: ${count((r) => r.draftSeriousMt)} serious-mt drafts, ` +
      `${count((r) => r.polishFixed)} fixed by polish, ${count((r) => r.unstable)} unstable`,
  );
}
