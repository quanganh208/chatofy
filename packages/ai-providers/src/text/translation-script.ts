// What script a translation INTO each language must be written in, and how to
// tell when a model wrote it in the wrong one.
//
// Measured on 1,200 recorded DeepSeek outputs into or out of Chinese
// (benchmarks/mt-zh, 261013-deepseek-flash-r3): 3 zh outputs used Traditional
// characters, and 3 of 600 zh→vi outputs left Chinese in the Vietnamese — one of
// them most of its source sentence. 0 of 600 did in each of en→vi, zh→en and
// vi→en. So Chinese output is always converted to Simplified, and a Vietnamese
// output carrying more Han than its source can explain is a leak. English gets
// no leak check: nothing was measured leaking into it.
import * as OpenCC from 'opencc-js/t2cn';
import { HAN_CHARACTER, type LanguageCode, type LanguageTable } from '@chatofy/types';

interface TargetScript {
  /** The output as it is displayed and spoken. */
  toDisplay(text: string): string;
  /** A character that should not appear in output for this target, or null. */
  leak: RegExp | null;
  /** Whether text in this language is written in Han characters. */
  writtenInHan: boolean;
}

const identity = (text: string): string => text;

let toSimplified: ((text: string) => string) | undefined;

/**
 * OpenCC Traditional → Simplified (mainland), built on first use: its tables are
 * a few megabytes, and a process that never translates into Chinese should not
 * pay for them at import.
 */
function simplified(text: string): string {
  // Typed optional because the package's one declaration file covers every
  // preset; the t2cn entry point always carries it.
  const convert = (toSimplified ??= OpenCC.Converter?.({ from: 't', to: 'cn' }));
  if (!convert) throw new Error('opencc-js/t2cn has no Converter');
  return convert(text);
}

const SCRIPTS: LanguageTable<TargetScript> = {
  vi: { toDisplay: identity, leak: HAN_CHARACTER, writtenInHan: false },
  en: { toDisplay: identity, leak: null, writtenInHan: false },
  zh: { toDisplay: simplified, leak: null, writtenInHan: true },
};

/** Whether text in `language` is written in Han characters. */
export function isWrittenInHan(language: LanguageCode): boolean {
  return SCRIPTS[language].writtenInHan;
}

/** `text` in the script its target is displayed in: Simplified for Chinese. */
export function toTargetScript(target: LanguageCode, text: string): string {
  return SCRIPTS[target].toDisplay(text);
}

function countMatches(pattern: RegExp, text: string): number {
  return text.match(new RegExp(pattern.source, 'gu'))?.length ?? 0;
}

/**
 * Whether a translation into `target` slipped into a script it is not written in.
 *
 * True when the target has a leak pattern and the output holds more such
 * characters than the source allows. The allowance is the source's own count
 * when the source is NOT written in that script — an English or Vietnamese
 * sentence naming 王伟 may carry the name through — and zero when it is, because
 * then every Han character in a Vietnamese output was copied instead of
 * translated. Comparing raw counts would miss exactly the recorded leaks: the
 * worst one kept 31 of its source's 42 Han characters.
 */
export function leaksForeignScript(
  source: LanguageCode,
  target: LanguageCode,
  sourceText: string,
  output: string,
): boolean {
  const { leak } = SCRIPTS[target];
  if (!leak) return false;
  const allowance = SCRIPTS[source].writtenInHan
    ? 0
    : countMatches(leak, sourceText.normalize('NFC'));
  return countMatches(leak, output.normalize('NFC')) > allowance;
}

/** How many Han characters a text holds; for logs, which never carry the text. */
export function hanCount(text: string): number {
  return countMatches(HAN_CHARACTER, text);
}
