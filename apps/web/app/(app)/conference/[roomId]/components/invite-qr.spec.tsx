// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';
import { InviteQr } from './invite-qr';

/**
 * Join a meeting from a phone by scanning a code. Wordly, Maestra and JotMe all offer it
 * for people in the same room; here it sits beside "Copy invite link".
 */
const URL = 'https://chatofy.example.com/conference/room-abc';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((n) => n.remove());
});

function open(locale: 'en' | 'vi' = 'en') {
  act(() => {
    root.render(
      <LocaleProvider locale={locale}>
        <InviteQr url={() => URL} />
      </LocaleProvider>,
    );
  });
  const trigger = container.querySelector('button');
  act(() => {
    trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    trigger!.click();
  });
  return trigger!;
}

describe('InviteQr', () => {
  it('has a named button that opens the code', () => {
    const trigger = open();
    expect(trigger.getAttribute('aria-label')).toBe('Show QR code');
    expect(document.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it('draws the code as an image with a name, on a light ground with a quiet zone', () => {
    open();
    const svg = document.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('QR code to join the meeting');
    expect(svg.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(50);
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(w).toBe(h);
    // A 4-module quiet zone each side: viewBox is the grid plus 8.
    expect(((w ?? 0) - 8 - 17) % 4).toBe(0);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('white');
  });

  it('says what to do and shows the link it encodes', () => {
    open();
    expect(document.body.textContent).toContain('Scan this with a phone camera');
    expect(document.body.textContent).toContain(URL);
  });

  it('is available in Vietnamese', () => {
    const trigger = open('vi');
    expect(trigger.getAttribute('aria-label')).toBe('Hiện mã QR');
  });
});
