#!/usr/bin/env node
// Measure every rendered <video> element with Playwright and print JSON to stdout.
// Read-only: it opens pages, never writes files. Feed the output to
// `video_web_audit.py --rendered`.
//
// Usage: node capture_rendered_videos.mjs URL [URL...] [--viewport 390x844 ...] [--wait-ms 1000] [--scroll]

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_VIEWPORTS = ['390x844', '1440x900'];
const USAGE = 'Usage: capture_rendered_videos.mjs URL [URL...] [--viewport WxH ...] [--wait-ms N] [--scroll]';

function fail(message, code = 1) {
  process.stderr.write(`Error: ${message}\n${code === 1 ? USAGE + '\n' : ''}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { urls: [], viewports: [], waitMs: 1000, scroll: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--viewport') {
      const match = /^(\d+)x(\d+)$/.exec(argv[++i] || '');
      if (!match) fail('--viewport needs WIDTHxHEIGHT, e.g. 390x844');
      opts.viewports.push({ width: Number(match[1]), height: Number(match[2]) });
    } else if (arg === '--wait-ms') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) fail('--wait-ms needs a non-negative number');
      opts.waitMs = value;
    } else if (arg === '--scroll') {
      opts.scroll = true;
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else if (/^(https?|file):\/\//i.test(arg)) {
      opts.urls.push(arg);
    } else if (existsSync(arg)) {
      opts.urls.push(pathToFileURL(arg).href);
    } else {
      fail(`not a URL or existing file: ${arg}`);
    }
  }
  if (!opts.urls.length) fail('at least one URL is required');
  if (!opts.viewports.length) {
    opts.viewports = DEFAULT_VIEWPORTS.map((v) => {
      const [width, height] = v.split('x').map(Number);
      return { width, height };
    });
  }
  return opts;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // ESM import ignores NODE_PATH and global installs; CommonJS resolution honours them.
    for (const base of [join(process.cwd(), 'noop.js'), import.meta.url]) {
      try {
        return createRequire(base)('playwright');
      } catch {
        // try the next resolution base
      }
    }
  }
  fail('playwright is not installed; run `npm install playwright && npx playwright install chromium`', 2);
  return null;
}

// Runs in the page: describe every <video> element.
function collectVideos() {
  const lightbox = 'dialog, [role="dialog"], [aria-modal="true"], .modal, .lightbox, [class*="lightbox" i], '
    + '[class*="modal" i], [data-fancybox], .fancybox, .glightbox, .pswp';
  return Array.from(document.querySelectorAll('video')).map((video) => {
    const rect = video.getBoundingClientRect();
    return {
      currentSrc: video.currentSrc || '',
      src: video.getAttribute('src') || '',
      sources: Array.from(video.querySelectorAll('source')).map((s) => ({
        src: s.getAttribute('src') || '', type: s.getAttribute('type') || '', media: s.getAttribute('media') || '',
      })),
      poster: video.getAttribute('poster') || '',
      attributes: {
        autoplay: video.hasAttribute('autoplay'),
        muted: video.hasAttribute('muted') || video.muted,
        loop: video.hasAttribute('loop'),
        playsinline: video.hasAttribute('playsinline'),
        controls: video.hasAttribute('controls'),
        preload: video.getAttribute('preload'),
      },
      cssWidth: rect.width,
      cssHeight: rect.height,
      devicePixelRatio: window.devicePixelRatio,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      inDialog: Boolean(video.parentElement && video.parentElement.closest(lightbox)),
      readyState: video.readyState,
    };
  });
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = await loadPlaywright();
  const results = [];
  let browser;
  try {
    browser = await chromium.launch();
    for (const url of opts.urls) {
      for (const viewport of opts.viewports) {
        const label = `${viewport.width}x${viewport.height}`;
        const context = await browser.newContext({ viewport });
        try {
          const page = await context.newPage();
          await page.goto(url, { waitUntil: 'load', timeout: 30000 });
          if (opts.scroll) await scrollThrough(page);
          if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
          for (const video of await page.evaluate(collectVideos)) {
            results.push({ pageUrl: url, viewport: label, ...video });
          }
        } catch (error) {
          results.push({ pageUrl: url, viewport: label, error: String(error && error.message ? error.message : error) });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
