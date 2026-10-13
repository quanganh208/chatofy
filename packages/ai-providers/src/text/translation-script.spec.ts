import { describe, expect, it } from 'vitest';
import { hanCount, leaksForeignScript, toTargetScript } from './translation-script.js';

describe('toTargetScript', () => {
  it('converts Traditional Chinese output to Simplified', () => {
    expect(toTargetScript('zh', '外國人')).toBe('外国人');
    expect(toTargetScript('zh', '聲名遠揚')).toBe('声名远扬');
  });

  it('leaves Simplified Chinese unchanged', () => {
    const text = '我们明天去北京开会，好吗？';
    expect(toTargetScript('zh', text)).toBe(text);
  });

  it('leaves Vietnamese and English untouched, Han included', () => {
    expect(toTargetScript('vi', 'Tôi gặp 王偉 hôm qua')).toBe('Tôi gặp 王偉 hôm qua');
    expect(toTargetScript('en', 'I met 王偉')).toBe('I met 王偉');
  });
});

describe('leaksForeignScript', () => {
  it('flags a zh→vi output that slipped into Chinese', () => {
    // The recorded shape: the translation starts in Vietnamese and finishes in
    // the source language.
    expect(
      leaksForeignScript(
        'zh',
        'vi',
        '“野生动物园”一词是指通过陆路旅行',
        'Từ "safari" … 是指通过陆路旅行',
      ),
    ).toBe(true);
  });

  it('passes Vietnamese and English output with no Han in it', () => {
    expect(leaksForeignScript('zh', 'vi', '我们去吧', 'Chúng ta đi thôi')).toBe(false);
    expect(leaksForeignScript('vi', 'en', 'Chúng ta đi thôi', "Let's go")).toBe(false);
  });

  it('allows a Chinese name an English or Vietnamese source carried', () => {
    expect(leaksForeignScript('en', 'vi', 'I met 王伟 yesterday', 'Tôi gặp 王伟 hôm qua')).toBe(
      false,
    );
    // More Han out than in is still a leak.
    expect(leaksForeignScript('en', 'vi', 'I met 王伟', 'Tôi gặp 王伟 我们')).toBe(true);
  });

  it('never flags an English output', () => {
    expect(leaksForeignScript('zh', 'en', '我们去吧', 'We go 我们去吧')).toBe(false);
  });

  it('never flags a Chinese output', () => {
    expect(leaksForeignScript('vi', 'zh', 'Chúng ta đi', '我们去吧')).toBe(false);
  });
});

describe('hanCount', () => {
  it('counts Han characters only', () => {
    expect(hanCount('Tôi gặp 王伟 hôm qua')).toBe(2);
    expect(hanCount('no han')).toBe(0);
  });
});
