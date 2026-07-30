import { defineConfig } from 'wxt';

/**
 * Chrome MV3 build for the meeting translator.
 *
 * No UI framework, deliberately. The plan allowed for React and Tailwind and also
 * for dropping them if they cost time; they were dropped, and the reason is the
 * overlay. It lives in a closed shadow root, where Tailwind's generated stylesheet
 * does not reach without being injected as a string — a known trap — and the whole
 * surface is one status line plus a transcript list. Hand-written CSS in the same
 * file as the markup is smaller, has nothing to configure, and cannot pull `eval`
 * into a build that MV3's CSP forbids it in.
 *
 * The manifest is written out here rather than left to defaults, because a missing
 * permission on this path does not fail the load — it fails at runtime, silently,
 * in the middle of a meeting.
 */
export default defineConfig({
  srcDir: '.',
  manifest: {
    name: 'Chatofy meeting translator',
    description: 'Translates what other people say in a browser meeting, as they say it.',
    permissions: [
      // Capturing the tab's audio is the entire input side.
      'tabCapture',
      // Service workers cannot hold an AudioContext, so the audio graph lives in
      // an offscreen document.
      'offscreen',
      // Direction, voice, and the flag saying the first-run notice has been seen.
      'storage',
      // `tabCapture.getMediaStreamId` needs the extension to have been INVOKED on
      // the tab. Host permissions alone do not grant that, so this is not optional.
      'activeTab',
    ],
    host_permissions: [
      'https://meet.google.com/*',
      // Zoom's web client only. The desktop app is not a tab and cannot be
      // captured; the popup says so rather than appearing to do nothing.
      'https://*.zoom.us/wc/*',
      'https://www.messenger.com/*',
    ],
    web_accessible_resources: [
      {
        // Loaded by URL from the offscreen document via `chrome.runtime.getURL`.
        // It must stay a separate file: an AudioWorklet module is fetched by the
        // audio thread, so a bundler that inlined it into a chunk would break it.
        resources: ['worklets/mic-capture-processor.js'],
        matches: [
          'https://meet.google.com/*',
          'https://*.zoom.us/wc/*',
          'https://www.messenger.com/*',
        ],
      },
    ],
  },
});
