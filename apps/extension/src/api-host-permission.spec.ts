import { describe, expect, it } from 'vitest';
import { apiHostPermission, DEV_API_BASE_URL } from './api-host-permission';
import { DEFAULT_API_BASE_URL } from './settings';

describe('apiHostPermission', () => {
  it('grants exactly the API host the bundle is compiled against', () => {
    expect(apiHostPermission('https://chatofy-api.example.dev')).toBe(
      'https://chatofy-api.example.dev/*',
    );
    expect(apiHostPermission('https://api.example.dev/v1/')).toBe('https://api.example.dev/*');
  });

  it('drops the port, since a match pattern covers every port on its host', () => {
    expect(apiHostPermission('http://localhost:3000')).toBe('http://localhost/*');
  });

  it('falls back to the same default the bundle uses when the variable is unset or blank', () => {
    expect(DEV_API_BASE_URL).toBe(DEFAULT_API_BASE_URL);
    expect(apiHostPermission(undefined)).toBe('http://localhost/*');
    expect(apiHostPermission('')).toBe('http://localhost/*');
  });

  it('refuses a scheme a host permission could not mean', () => {
    expect(() => apiHostPermission('ws://api.example.dev')).toThrow(/http\(s\)/);
  });
});
