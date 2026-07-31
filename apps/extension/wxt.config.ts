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
      // The microphone, and this is not optional for either thing that uses it.
      // An offscreen document has no UI, so it cannot show Chrome's permission
      // prompt — `getUserMedia({ audio })` there is refused outright rather than
      // asked about. This permission is what grants it up front. Both the echo
      // measurement and the outbound translation open a microphone from that
      // document, and both fail silently without it: `EchoMonitor` swallows the
      // rejection by design, so a missing grant reads as "no echo was heard".
      'audioCapture',
      // Direction, voice, and the flag saying the first-run notice has been seen.
      'storage',
      // `tabCapture.getMediaStreamId` needs the extension to have been INVOKED on
      // the tab. Host permissions alone do not grant that, so this is not optional.
      'activeTab',
      // The right-click entry into capture. Independent of whether Chrome managed
      // to assign the keyboard shortcut, which is why both exist.
      'contextMenus',
    ],
    host_permissions: [
      'https://meet.google.com/*',
      // Zoom's web client only. The desktop app is not a tab and cannot be
      // captured; the popup says so rather than appearing to do nothing.
      'https://*.zoom.us/wc/*',
      // Where a Messenger call actually runs. messenger.com is gone — Meta closed
      // the web client — and a call started from a Facebook thread lands here. The
      // path stays narrow deliberately: this grants the call page, not facebook.com.
      'https://*.facebook.com/groupcall/*',
    ],
    // The only two ways to invoke this extension in a window that has no toolbar.
    //
    // Facebook opens a call in a `type: "popup"` window: no tab strip, no extension
    // icon, nothing to click. And `tabCapture.getMediaStreamId` needs the extension
    // to have been invoked ON THAT TAB — Chrome grants that for an action click, a
    // context-menu item, a commands shortcut, or an omnibox suggestion, and for
    // nothing else. A button drawn by our content script is a click on Facebook's
    // page, not an invocation, so it cannot be the way capture starts.
    commands: {
      'toggle-capture': {
        // One binding for every platform. Chrome maps `Alt` to Option on macOS;
        // it is `Ctrl` that silently becomes Command there (`MacCtrl` is the
        // escape hatch), so Alt avoids the ambiguity outright. Chrome may leave
        // this unassigned if it collides — the overlay reads the real binding
        // back and points at the context menu when there is none.
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Start or stop Chatofy on this meeting tab',
      },
    },
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
