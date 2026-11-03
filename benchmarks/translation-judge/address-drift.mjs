// How often does the Vietnamese address form switch between consecutive turns?
//
//   node address-drift.mjs <rows.jsonl> [--replace <arm rows.jsonl>]
//
// For each en→vi row, the address form is the first match, in this order, of
// the forms below (whole words). A switch is two consecutive en→vi rows of the
// same speaker using different forms. Rows without `speakerRole` are read as
// one speaker per conversation, which over-counts an interview where host and
// guest rightly address each other differently; the output says which reading
// it used. `--replace` swaps in an arm's translations by `conv#pos` first, so a
// shipped arm can be read the way a reader would see it.
import { readJsonl, turnId } from './rows.mjs';

const FORMS = ['quý vị', 'các bạn', 'anh/chị', 'anh', 'chị', 'ông', 'bà', 'em', 'bạn'];
const LETTER = '\\p{L}';
const PATTERNS = FORMS.map((form) => ({
  form,
  re: new RegExp(`(?<!${LETTER})${form.replace('/', '\\/')}(?!${LETTER}|\\/)`, 'iu'),
}));

/** The first address form a translation uses, by position in the text. */
export function addressForm(text) {
  let best = null;
  for (const { form, re } of PATTERNS) {
    const match = re.exec(text);
    if (match && (best === null || match.index < best.index)) best = { form, index: match.index };
  }
  return best?.form ?? null;
}

export function switches(rows) {
  const byConv = new Map();
  for (const row of rows) {
    if (row.direction !== 'en_to_vi') continue;
    const list = byConv.get(row.conv) ?? [];
    list.push(row);
    byConv.set(row.conv, list);
  }
  const perConv = [];
  for (const [conv, list] of byConv) {
    list.sort((a, b) => Number(a.pos) - Number(b.pos));
    const last = new Map();
    let count = 0;
    for (const row of list) {
      const form = addressForm(row.translation ?? '');
      if (!form) continue;
      const speaker = row.speakerRole ?? '*';
      if (last.has(speaker) && last.get(speaker) !== form) count += 1;
      last.set(speaker, form);
    }
    perConv.push({
      conv,
      rows: list.length,
      switches: count,
      bySpeaker: list.some((r) => r.speakerRole),
    });
  }
  return perConv;
}

const args = process.argv.slice(2);
const at = args.indexOf('--replace');
let rows = readJsonl(args[0]);
if (at !== -1) {
  const arm = new Map(readJsonl(args[at + 1]).map((row) => [turnId(row), row.translation]));
  rows = rows.map((row) =>
    arm.has(turnId(row)) ? { ...row, translation: arm.get(turnId(row)) } : row,
  );
}
let total = 0;
let count = 0;
for (const c of switches(rows)) {
  total += c.switches;
  count += c.rows;
  console.log(
    `${c.conv} switches=${c.switches} rows=${c.rows} speakers=${c.bySpeaker ? 'role' : 'one'}`,
  );
}
console.log(`total switches=${total} rows=${count}`);
