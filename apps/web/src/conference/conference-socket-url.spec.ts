import { describe, expect, it } from 'vitest';

import { conferenceSocketBaseUrl, conferenceTranslateSocketUrl } from './conference-socket-url';

describe('conferenceSocketBaseUrl', () => {
  it('maps http to ws and keeps the port', () => {
    expect(conferenceSocketBaseUrl('http://localhost:3100')).toBe('ws://localhost:3100');
  });

  it('maps https to wss', () => {
    expect(conferenceSocketBaseUrl('https://api.example.com')).toBe('wss://api.example.com');
  });

  it('drops a path and trailing slash so callers can append /ws/…', () => {
    expect(conferenceSocketBaseUrl('https://api.example.com/v1/')).toBe('wss://api.example.com');
  });
});

describe('conferenceTranslateSocketUrl', () => {
  it('keeps an https API on a secure socket', () => {
    expect(conferenceTranslateSocketUrl('https://api.example')).toBe(
      'wss://api.example/ws/translate',
    );
  });

  it('maps an http API to ws', () => {
    expect(conferenceTranslateSocketUrl('http://localhost:3100')).toBe(
      'ws://localhost:3100/ws/translate',
    );
  });
});
