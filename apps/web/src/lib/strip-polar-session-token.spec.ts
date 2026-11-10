import { describe, expect, it, vi } from 'vitest';
import { stripPolarSessionToken } from './strip-polar-session-token';

function history() {
  return { state: { __NA: true }, replaceState: vi.fn() };
}

describe('stripPolarSessionToken', () => {
  it('drops the token and keeps checkout=done, other parameters and the hash', () => {
    const h = history();
    const removed = stripPolarSessionToken(
      {
        href: 'https://chatofy.example/account?checkout=done&customer_session_token=polar_cst_x&x=1#credits',
      },
      h,
    );
    expect(removed).toBe(true);
    expect(h.replaceState).toHaveBeenCalledWith(h.state, '', '/account?checkout=done&x=1#credits');
  });

  it('leaves the history alone when there is no token', () => {
    const h = history();
    expect(
      stripPolarSessionToken({ href: 'https://chatofy.example/account?checkout=done' }, h),
    ).toBe(false);
    expect(h.replaceState).not.toHaveBeenCalled();
  });
});
