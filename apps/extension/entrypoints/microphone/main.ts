import { localizeDocument, t } from '../../src/i18n';
import { microphoneFailureKey } from '../../src/microphone-failure';
import { microphonePermission } from '../../src/microphone-permission';

/**
 * The one page that can raise Chrome's microphone prompt.
 *
 * Why a whole page exists for one call is in `src/microphone-permission.ts`: the
 * offscreen document opens every microphone this extension uses and cannot ask for
 * one, and the popup cannot either because the prompt closes it. A tab can.
 *
 * The stream opened here is thrown away immediately. Nothing on this page wants
 * audio — the grant is the entire product of the call, and it outlives the track.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

// Before anything reads the page: the static English is only the no-script fallback.
localizeDocument();

const ask = el<HTMLButtonElement>('ask');
const outcome = el<HTMLDivElement>('outcome');
const recover = el<HTMLParagraphElement>('recover');

function show(message: string, ok: boolean): void {
  outcome.textContent = message;
  outcome.className = ok ? 'ok' : 'bad';
  outcome.hidden = false;
}

async function request(): Promise<void> {
  ask.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Before anything else touches the page: while these tracks live, Chrome shows
    // the recording indicator for a page that is recording nothing.
    stream.getTracks().forEach((track) => track.stop());
    show(t('extension.microphone.granted'), true);
    recover.hidden = true;
  } catch (err) {
    // The browser's message is English in every locale; the console keeps it, the
    // page shows the sentence for the kind of failure.
    console.warn('[chatofy] microphone request failed', err);
    show(t(microphoneFailureKey(err)), false);
    // Only for a standing block. A prompt the user has just dismissed will be shown
    // again by the button, and telling them to go dig through settings for that is
    // sending them somewhere they do not need to go.
    recover.hidden = (await microphonePermission()) !== 'denied';
    ask.disabled = false;
  }
}

ask.addEventListener('click', () => void request());

// Someone who arrived here has already asked for this — from the popup's button, or
// by opening the page on purpose. Making them click a second button to reach the
// prompt buys nothing, and the button stays for the retry after a dismissal.
void (async () => {
  if ((await microphonePermission()) === 'granted') {
    show(t('extension.microphone.alreadyGranted'), true);
    ask.disabled = true;
    return;
  }
  await request();
})();
