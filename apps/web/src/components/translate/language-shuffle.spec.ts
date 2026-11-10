// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureShuffle, playShuffle } from './language-shuffle';

/**
 * The swap's two sheets: measured before, moved from there after.
 *
 * happy-dom has no layout and no Web Animations, so positions are stubbed and
 * `animate` is a spy. What is checked is the contract: a card that moved is animated
 * from where its code was, one passes over and one under, and nothing moves under
 * reduced motion.
 */
let root: HTMLDivElement;

const animations = new Map<HTMLElement, ReturnType<typeof vi.fn>>();

function card(code: string, left: number, top = 0): HTMLElement {
  const element = document.createElement('span');
  element.dataset.shuffleCard = code;
  element.getBoundingClientRect = () => new DOMRect(left, top, 100, 36);
  const animate = vi.fn(() => new Animation());
  element.animate = animate;
  animations.set(element, animate);
  root.append(element);
  return element;
}

/** The spy standing in for a card's `animate`. */
function animateOf(element: HTMLElement) {
  return animations.get(element)!;
}

function move(element: HTMLElement, left: number, top = 0) {
  element.getBoundingClientRect = () => new DOMRect(left, top, 100, 36);
}

function reducedMotion(matches: boolean) {
  window.matchMedia = vi.fn(() => ({ matches }) as MediaQueryList);
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  reducedMotion(false);
});

afterEach(() => {
  root.remove();
});

describe('the language shuffle', () => {
  it('moves each card from where its code was', () => {
    const vi1 = card('vi', 0);
    const en = card('en', 600);
    const before = captureShuffle(root);
    // The pair swapped: the source header now shows en, the target vi.
    vi1.dataset.shuffleCard = 'en';
    en.dataset.shuffleCard = 'vi';
    move(vi1, 0);
    move(en, 600);

    playShuffle(root, before);

    const first: unknown = animateOf(vi1).mock.calls[0]![0];
    const second: unknown = animateOf(en).mock.calls[0]![0];
    const frames = (keyframes: unknown) => keyframes as { transform: string }[];
    // en was at 600 and is now at 0, so it starts 600px to the right of where it lands.
    expect(frames(first)[0]!.transform).toBe('translate(600px, 0px)');
    expect(frames(second)[0]!.transform).toBe('translate(-600px, 0px)');
    // One over, one under: opposite sides of the straight path at the midpoint.
    expect(frames(first)[1]!.transform).toContain('translate(300px, -18px)');
    expect(frames(second)[1]!.transform).toMatch(/translate\(-300px, 12\.\d+px\)/);
    expect(frames(first)[2]!.transform).toBe('none');
    // Each sheet's ground travels with it, from what that language was painted on.
    expect(frames(first)[0]).toHaveProperty('backgroundColor');
    expect(frames(first)[2]).toHaveProperty('backgroundColor');
  });

  it('leaves a card that did not move alone', () => {
    const only = card('vi', 0);
    const before = captureShuffle(root);
    playShuffle(root, before);
    expect(animateOf(only)).not.toHaveBeenCalled();
  });

  it('moves nothing under reduced motion', () => {
    const vi1 = card('vi', 0);
    const en = card('en', 600);
    const before = captureShuffle(root);
    vi1.dataset.shuffleCard = 'en';
    en.dataset.shuffleCard = 'vi';
    reducedMotion(true);

    playShuffle(root, before);

    expect(animateOf(vi1)).not.toHaveBeenCalled();
    expect(animateOf(en)).not.toHaveBeenCalled();
  });
});
