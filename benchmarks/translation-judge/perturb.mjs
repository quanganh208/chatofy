// Known answers for the judge: real translations broken by fixed rules.
//
//   node perturb.mjs candidates --in data/turns.scribed.jsonl > data/calibration-clean.jsonl
//   node perturb.mjs perturb --in data/calibration-clean.jsonl --judged results/<clean run> \
//     > data/calibration-perturbed.jsonl
//
// No model writes these. Each rule changes one thing a reader would get wrong —
// a number, a negation, a name, a clause — so the error a control carries is
// known without anyone grading it.
//
// `candidates` picks turns whose hearing is not in question (the app and Scribe
// heard the same words), so a flag the judge raises there is about the
// translation. `perturb` breaks only the candidates the judge then found free
// of serious errors: a serious error on the broken copy can be credited to the
// break and not to something the translation already got wrong.
import { fileURLToPath } from 'node:url';

import { consensus, loadJudgements } from './consensus.mjs';
import { readJsonl, toJsonl, turnId } from './rows.mjs';

export const KINDS = ['number', 'negation', 'name', 'omission'];
export const CANDIDATES = 40;
export const PER_KIND = 10;
/** Word error between the app's and Scribe's hearing at or under which a turn counts as heard right. */
export const MAX_HEARING_ERROR = 0.1;

function words(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate of `hyp` against `ref` (Levenshtein over words). */
export function wordError(ref, hyp) {
  const a = words(ref);
  const b = words(hyp);
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length] / a.length;
}

/** A stable pseudo-random order: FNV-1a of the id. */
export function stableHash(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function byHash(rows) {
  return [...rows].sort((a, b) => stableHash(a.id ?? turnId(a)) - stableHash(b.id ?? turnId(b)));
}

function targetOf(row) {
  return row.direction.split('_to_')[1];
}

export function pickCandidates(rows, count = CANDIDATES) {
  return byHash(
    rows.filter(
      (row) =>
        row.translation &&
        !row.scribe_missing &&
        ['en', 'vi'].includes(targetOf(row)) &&
        row.words >= 5 &&
        row.words <= 30 &&
        wordError(row.scribe_source, row.source) <= MAX_HEARING_ERROR,
    ),
  )
    .slice(0, count)
    .map((row) => ({ ...row, id: turnId(row) }));
}

const EN_CONTRACTIONS = {
  "don't": 'do',
  "doesn't": 'does',
  "didn't": 'did',
  "isn't": 'is',
  "aren't": 'are',
  "wasn't": 'was',
  "weren't": 'were',
  "can't": 'can',
  "won't": 'will',
  "couldn't": 'could',
  "wouldn't": 'would',
  "shouldn't": 'should',
  "haven't": 'have',
  "hasn't": 'has',
};
const VI_PRONOUN = /(^|\s)(chúng tôi|chúng ta|tôi|anh|chị|em|bạn|họ|nó|mình)(\s+)/iu;

/** The rules. Each returns the broken text, or null when it does not apply. */
export const RULES = {
  number(text) {
    const match = /\d+/.exec(text);
    if (!match) return null;
    const digits = match[0];
    const last = (Number(digits.at(-1)) + 1) % 10;
    return (
      text.slice(0, match.index) +
      digits.slice(0, -1) +
      last +
      text.slice(match.index + digits.length)
    );
  },
  negation(text, target) {
    if (target === 'en') {
      const contraction = /\b(\w+n't)\b/i.exec(text);
      if (contraction && EN_CONTRACTIONS[contraction[1].toLowerCase()]) {
        return text.replace(contraction[1], EN_CONTRACTIONS[contraction[1].toLowerCase()]);
      }
      if (/\bnot\s+/i.test(text)) return text.replace(/\bnot\s+/i, '');
      if (/\bnever\b/i.test(text)) return text.replace(/\bnever\b/i, 'always');
      if (/\b(is|are|was|were|will|can)\b/.test(text))
        return text.replace(/\b(is|are|was|were|will|can)\b/, '$1 not');
      return null;
    }
    const negated = /(^|\s)(không|chưa|chẳng)\s+(?=\p{L})/iu;
    if (negated.test(text)) return text.replace(negated, '$1');
    if (VI_PRONOUN.test(text)) return text.replace(VI_PRONOUN, '$1$2$3không ');
    return null;
  },
  name(text, target) {
    const tokens = text.split(/(\s+)/);
    for (let i = 2; i < tokens.length; i += 2) {
      const word = tokens[i].replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
      const previous = tokens[i - 2];
      if (!/^\p{Lu}\p{Ll}+$/u.test(word) || /^I('|$)/.test(word) || /[.!?…:]["”]?$/u.test(previous))
        continue;
      const fallback = target === 'vi' ? 'Hùng' : 'Daniel';
      const replacement = word === fallback ? 'Laura' : fallback;
      tokens[i] = tokens[i].replace(word, replacement);
      return tokens.join('');
    }
    return null;
  },
  omission(text) {
    if (words(text).length < 8) return null;
    let parts = text.split(/,\s+/);
    let glue = ', ';
    if (parts.length < 2) {
      const conj = /\s+(and|và)\s+/i.exec(text);
      if (!conj) return null;
      parts = text.split(conj[0]);
      glue = conj[0];
    }
    let longest = 0;
    for (let i = 1; i < parts.length; i += 1)
      if (words(parts[i]).length > words(parts[longest]).length) longest = i;
    const kept = parts.filter((_, i) => i !== longest);
    if (words(kept.join(' ')).length < 3) return null;
    return kept.join(glue);
  },
};

/** Up to `perKind` broken copies per rule, spread over distinct turns where possible. */
export function perturbRows(bases, perKind = PER_KIND) {
  const out = [];
  const used = new Set();
  for (const kind of KINDS) {
    const fresh = bases.filter((row) => !used.has(row.id));
    const reused = bases.filter((row) => used.has(row.id));
    let made = 0;
    for (const row of [...fresh, ...reused]) {
      if (made >= perKind) break;
      const broken = RULES[kind](row.translation, targetOf(row));
      if (!broken || broken === row.translation) continue;
      out.push({
        ...row,
        id: `${row.id}~${kind}`,
        base: row.id,
        kind,
        original: row.translation,
        translation: broken,
      });
      used.add(row.id);
      made += 1;
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : null;
  };
  if (command === 'candidates') {
    const picked = pickCandidates(readJsonl(flag('--in')));
    process.stdout.write(toJsonl(picked));
    console.error(`${picked.length} clean candidates`);
  } else if (command === 'perturb') {
    const rows = readJsonl(flag('--in'));
    const { byId } = loadJudgements(flag('--judged'));
    const bases = rows.filter(
      (row) => byId.get(row.id)?.length && !consensus(byId.get(row.id)).keys.has('any'),
    );
    const broken = perturbRows(bases);
    process.stdout.write(toJsonl(broken));
    const counts = Object.fromEntries(
      KINDS.map((kind) => [kind, broken.filter((row) => row.kind === kind).length]),
    );
    console.error(
      `${bases.length} of ${rows.length} candidates judged clean; broken: ${JSON.stringify(counts)}`,
    );
  } else {
    console.error('usage: perturb.mjs candidates|perturb …');
    process.exit(2);
  }
}
