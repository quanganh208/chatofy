// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cloneDocumentStyles } from './clone-document-styles';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function blank(): Document {
  return document.implementation.createHTMLDocument('');
}

afterEach(() => {
  document.head.querySelectorAll('[data-test]').forEach((node) => node.remove());
  document.documentElement.className = '';
});

function style(text: string): HTMLStyleElement {
  const node = document.createElement('style');
  node.dataset.test = '';
  node.textContent = text;
  document.head.append(node);
  return node;
}

describe('cloneDocumentStyles', () => {
  it('copies every stylesheet and style, and nothing else', () => {
    style('.a{color:red}');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.test = '';
    document.head.append(link);
    const meta = document.createElement('meta');
    meta.dataset.test = '';
    document.head.append(meta);

    const to = blank();
    const dispose = cloneDocumentStyles(document, to);
    expect(to.head.querySelector('style')?.textContent).toBe('.a{color:red}');
    expect(to.head.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(to.head.querySelector('meta')).toBeNull();
    dispose();
  });

  it('carries the theme class across, and keeps it in step', async () => {
    document.documentElement.className = 'font-x dark';
    const to = blank();
    const dispose = cloneDocumentStyles(document, to);
    expect(to.documentElement.className).toBe('font-x dark');

    document.documentElement.className = 'font-x light';
    await flush();
    expect(to.documentElement.className).toBe('font-x light');
    dispose();
  });

  it('follows styles the page adds, edits and removes while open', async () => {
    const to = blank();
    const dispose = cloneDocumentStyles(document, to);
    const late = style('.b{}');
    await flush();
    expect(to.head.textContent).toContain('.b{}');

    late.textContent = '.b{color:blue}';
    await flush();
    expect(to.head.textContent).toContain('.b{color:blue}');

    late.remove();
    await flush();
    expect(to.head.textContent).not.toContain('.b{');
    dispose();
  });

  it('stops following once disposed', async () => {
    const to = blank();
    cloneDocumentStyles(document, to)();
    style('.c{}');
    await flush();
    expect(to.head.textContent).not.toContain('.c{}');
  });
});
