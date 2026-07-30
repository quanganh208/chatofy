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
  // WXT's dev server defaults to port 3000, which the api already listens on. It
  // binds the loopback address specifically, and a specific bind beats the api's
  // wildcard one, so `http://localhost:3000` from the extension reaches the dev
  // server instead of the api — a connection that fails without an error worth
  // reading. Moved off the collision rather than relying on start order.
  dev: {
    server: { port: 3010 },
  },
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
      // Messenger calls do not all run on messenger.com. Starting one from a
      // Facebook thread lands on facebook.com/groupcall/, which is the same
      // product on a different host, so leaving it out made the popup refuse a
      // call the extension can handle. The path stays narrow deliberately: this
      // grants the call page, not facebook.com.
      'https://*.facebook.com/groupcall/*',
    ],
    // No `web_accessible_resources`. The worklet is fetched by
    // `chrome.runtime.getURL` from the offscreen document, which is an extension
    // page loading a resource from its own origin — that never needs declaring.
    // Declaring it anyway is not merely redundant: the meeting host patterns carry
    // paths, and Chrome requires the path in a web-accessible match to be exactly
    // `/*`, so `https://*.zoom.us/wc/*` fails the manifest at load time. Leaving
    // the section out also keeps the extension's id unprobeable from those origins.
    //
    // The worklet must still be emitted as its own file rather than inlined: an
    // AudioWorklet module is fetched by the audio thread, and a bundler that folded
    // it into a chunk would break `addModule`.
  },
});
