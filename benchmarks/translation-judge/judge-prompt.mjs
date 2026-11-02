// The judge's instruction and answer schema, in one place.
//
// The judge annotates errors in the style of MQM: a list of spans with a
// category, a severity and an origin, not a single 1–10 score. A list can be
// audited span by span, and it stays stable across repeats where a score drifts.
//
// The judge never writes a translation. The instruction forbids it and the
// schema has no field to put one in: a model-written translation would be a
// model-written reference, which this project does not allow.

export const LANGUAGE_NAMES = { vi: 'Vietnamese', en: 'English', zh: 'Chinese' };

export const CATEGORIES = [
  'mistranslation',
  'omission',
  'addition',
  'terminology',
  'fluency',
  'segmentation',
];
export const SEVERITIES = ['minor', 'major', 'critical'];
export const ORIGINS = ['asr', 'mt', 'segmentation', 'unclear'];

/** Gemini `responseSchema` (OpenAPI subset). */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    errors: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          span: { type: 'STRING' },
          category: { type: 'STRING', enum: CATEGORIES },
          severity: { type: 'STRING', enum: SEVERITIES },
          origin: { type: 'STRING', enum: ORIGINS },
          reason: { type: 'STRING' },
        },
        required: ['span', 'category', 'severity', 'origin', 'reason'],
        propertyOrdering: ['span', 'category', 'severity', 'origin', 'reason'],
      },
    },
  },
  required: ['errors'],
};

/** The same schema as JSON Schema, for Claude's `output_config.format`. */
export const JSON_SCHEMA = {
  type: 'object',
  properties: {
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          span: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          severity: { type: 'string', enum: SEVERITIES },
          origin: { type: 'string', enum: ORIGINS },
          reason: { type: 'string' },
        },
        required: ['span', 'category', 'severity', 'origin', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['errors'],
  additionalProperties: false,
};

export const SYSTEM_INSTRUCTION = `You are a professional translation quality annotator for a live speech translation app.

A person spoke. The app's speech recognizer wrote down what it heard (APP HEARD), and the app translated that text (TRANSLATION). An independent, stronger transcriber also wrote down what was said (REFERENCE HEARD); it is usually right, but it can also mishear. Earlier turns of the same conversation are given as CONTEXT.

List every error in the TRANSLATION, judged against what the speaker actually said. Use MQM conventions:
- category: mistranslation (wrong meaning, wrong number, wrong name, flipped negation), omission (meaning left out), addition (meaning not said), terminology (a term or name rendered inconsistently or wrongly), fluency (grammar or wording that a reader would stumble on, meaning intact), segmentation (the turn starts or ends in the middle of a clause, so its meaning is cut).
- severity: minor (a reader still gets the meaning), major (a reader gets part of the meaning wrong), critical (a reader gets the main point wrong or is misled).
- origin:
  - asr: APP HEARD already differs in meaning from what was said, and the translation faithfully renders the wrong words;
  - mt: the translation is unfaithful to what was said, while APP HEARD had it right (or close enough);
  - segmentation: the error comes from where the turn was cut;
  - unclear: you cannot tell what was said (both transcripts disagree and neither is plausible).
- span: the exact words of the TRANSLATION that carry the error; for an omission, the APP HEARD words that were left out.
- reason: at most 15 words, saying what is wrong. Never write a corrected translation, in the reason or anywhere else.

Rules:
- Speech is informal. Fillers, repetitions and spoken style are not errors when the translation carries them faithfully.
- REFERENCE HEARD was cut from a whole-recording transcript by time, so its first or last few words may belong to the neighbouring turn. Words present only at its edges are not omissions.
- Do not count punctuation or capitalization alone.
- Judge meaning against what was said, not against your own preferred wording. A different but correct wording is not an error.
- If there is no error, return an empty list.`;

function block(label, text) {
  return `${label}:\n${text ?? '(none)'}`;
}

/** The user message for one turn. */
export function judgeMessage(row) {
  const [from, to] = row.direction.split('_to_');
  const context = row.context?.length
    ? row.context
        .map(
          (turn, i) => `${i + 1}. ${turn.source}\n   → ${turn.translation ?? '(no translation)'}`,
        )
        .join('\n')
    : '(this is the first turn)';
  return [
    `Direction: ${LANGUAGE_NAMES[from] ?? from} → ${LANGUAGE_NAMES[to] ?? to}`,
    block('CONTEXT (earlier turns, oldest first)', context),
    block(
      'REFERENCE HEARD',
      row.scribe_missing ? '(not available for this turn)' : row.scribe_source,
    ),
    block('APP HEARD', row.source),
    block('TRANSLATION', row.translation),
  ].join('\n\n');
}

/** Checks an answer against the schema the API was asked for; throws on drift. */
export function parseAnswer(text) {
  const answer = JSON.parse(text);
  if (!Array.isArray(answer.errors)) throw new Error('answer has no errors array');
  for (const error of answer.errors) {
    if (!CATEGORIES.includes(error.category)) throw new Error(`bad category ${error.category}`);
    if (!SEVERITIES.includes(error.severity)) throw new Error(`bad severity ${error.severity}`);
    if (!ORIGINS.includes(error.origin)) throw new Error(`bad origin ${error.origin}`);
  }
  return { errors: answer.errors };
}
