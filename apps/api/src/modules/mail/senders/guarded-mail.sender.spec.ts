import { Logger } from '@nestjs/common';
import {
  MailBudgetClass,
  MailDispatch,
  MailPurpose,
} from '../interfaces/mail-sender.interface';
import {
  BUDGET_CEILINGS,
  COOLDOWN_MS,
  GuardedMailSender,
  maskEmail,
} from './guarded-mail.sender';

function dispatch(over: Partial<MailDispatch> = {}): MailDispatch {
  return {
    to: 'victim@corp.com',
    purpose: MailPurpose.VerifyEmail,
    budgetClass: MailBudgetClass.Reserved,
    link: 'https://app.example.com/verify-email?token=super-secret-token',
    ...over,
  };
}

describe('GuardedMailSender', () => {
  let inner: { send: jest.Mock };
  let guarded: GuardedMailSender;
  let logSpies: Record<'log' | 'warn' | 'error', jest.SpyInstance>;

  beforeEach(() => {
    inner = { send: jest.fn().mockResolvedValue(undefined) };
    guarded = new GuardedMailSender(inner);
    logSpies = {
      log: jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined),
      warn: jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined),
      error: jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined),
    };
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('cooldown', () => {
    it('sends the first mail to a recipient', async () => {
      await guarded.send(dispatch());
      expect(inner.send).toHaveBeenCalledTimes(1);
    });

    it('drops a repeat send to the same address inside the cooldown window', async () => {
      await guarded.send(dispatch());
      jest.advanceTimersByTime(COOLDOWN_MS - 1);
      await guarded.send(dispatch());
      expect(inner.send).toHaveBeenCalledTimes(1);
    });

    it('allows a repeat send once the cooldown window elapses', async () => {
      await guarded.send(dispatch());
      jest.advanceTimersByTime(COOLDOWN_MS);
      await guarded.send(dispatch());
      expect(inner.send).toHaveBeenCalledTimes(2);
    });

    it('does not burn the cooldown window when the send fails', async () => {
      inner.send.mockRejectedValueOnce(new Error('smtp down'));
      await expect(guarded.send(dispatch())).rejects.toThrow('smtp down');
      // Immediately retried — a killed send must not have started the window.
      inner.send.mockResolvedValueOnce(undefined);
      await guarded.send(dispatch());
      expect(inner.send).toHaveBeenCalledTimes(2);
    });

    it("does not let one recipient's cooldown affect another", async () => {
      await guarded.send(dispatch({ to: 'a@corp.com' }));
      await guarded.send(dispatch({ to: 'b@corp.com' }));
      expect(inner.send).toHaveBeenCalledTimes(2);
    });

    /**
     * The cooldown must not become a way to silence someone else's mail.
     *
     * Keyed on the address alone, the notice below — which anyone can trigger
     * for any address by posting that address to /auth/register — starts a
     * window the victim's own reset mail falls inside and is dropped in. Repeat
     * it every ten minutes and a named person never recovers their account,
     * while every route still answers 202.
     */
    it("does not let an attacker-triggerable notice suppress the victim's reset mail", async () => {
      await guarded.send(
        dispatch({
          purpose: MailPurpose.AccountExistsNotice,
          budgetClass: MailBudgetClass.AttackerTriggerable,
        }),
      );
      await guarded.send(
        dispatch({
          purpose: MailPurpose.PasswordReset,
          budgetClass: MailBudgetClass.Reserved,
        }),
      );

      expect(inner.send).toHaveBeenCalledTimes(2);
      expect(inner.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ purpose: MailPurpose.PasswordReset }),
      );
    });

    it('still drops a repeat of the SAME purpose to the same address', async () => {
      const reset = dispatch({
        purpose: MailPurpose.PasswordReset,
        budgetClass: MailBudgetClass.Reserved,
      });
      await guarded.send(reset);
      jest.advanceTimersByTime(COOLDOWN_MS - 1);
      await guarded.send(reset);
      expect(inner.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('tiered budget', () => {
    it('drops sends once the attacker-triggerable ceiling is hit, without touching the reserved allowance', async () => {
      const ceiling = BUDGET_CEILINGS[MailBudgetClass.AttackerTriggerable];
      for (let i = 0; i < ceiling; i++) {
        await guarded.send(
          dispatch({
            to: `attacker-${i}@corp.com`,
            budgetClass: MailBudgetClass.AttackerTriggerable,
          }),
        );
      }
      expect(inner.send).toHaveBeenCalledTimes(ceiling);

      // The ceiling is exhausted: one more attacker-class recipient is dropped.
      await guarded.send(
        dispatch({
          to: 'one-more-attacker@corp.com',
          budgetClass: MailBudgetClass.AttackerTriggerable,
        }),
      );
      expect(inner.send).toHaveBeenCalledTimes(ceiling);

      // Reserved-class mail for a genuine user-requested action still goes out.
      await guarded.send(
        dispatch({
          to: 'real-user@corp.com',
          budgetClass: MailBudgetClass.Reserved,
        }),
      );
      expect(inner.send).toHaveBeenCalledTimes(ceiling + 1);
    });

    it('ages entries out of the rolling 24h window', async () => {
      const ceiling = BUDGET_CEILINGS[MailBudgetClass.AttackerTriggerable];
      for (let i = 0; i < ceiling; i++) {
        await guarded.send(
          dispatch({
            to: `attacker-${i}@corp.com`,
            budgetClass: MailBudgetClass.AttackerTriggerable,
          }),
        );
      }
      // Past 24h: the whole first batch ages out, so the class has headroom again.
      jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      await guarded.send(
        dispatch({
          to: 'fresh-after-24h@corp.com',
          budgetClass: MailBudgetClass.AttackerTriggerable,
        }),
      );
      expect(inner.send).toHaveBeenCalledTimes(ceiling + 1);
    });

    it('raises an alarm (logger.error), not a debug line, when a ceiling is hit', async () => {
      const ceiling = BUDGET_CEILINGS[MailBudgetClass.AttackerTriggerable];
      for (let i = 0; i < ceiling; i++) {
        await guarded.send(
          dispatch({
            to: `attacker-${i}@corp.com`,
            budgetClass: MailBudgetClass.AttackerTriggerable,
          }),
        );
      }
      logSpies.error.mockClear();
      await guarded.send(
        dispatch({
          to: 'one-more@corp.com',
          budgetClass: MailBudgetClass.AttackerTriggerable,
        }),
      );
      expect(logSpies.error).toHaveBeenCalled();
    });
  });

  describe('mail content and logging never leak', () => {
    it('never passes subject/body/header construction responsibility to the caller — the guard forwards the dispatch unmodified', async () => {
      const d = dispatch();
      await guarded.send(d);
      expect(inner.send).toHaveBeenCalledWith(d);
    });

    it('rejects a recipient carrying a control character without calling the inner sender', async () => {
      await guarded.send(
        dispatch({ to: 'a@corp.com\r\nBcc:everyone@corp.com' }),
      );
      expect(inner.send).not.toHaveBeenCalled();
    });

    it('no log line contains the link, a token, or the plaintext recipient', async () => {
      const to = 'jane.doe@corp.com';
      const link =
        'https://app.example.com/reset-password?token=super-secret-token';
      await guarded.send(dispatch({ to, link }));

      const allCalls: unknown[] = [
        ...(logSpies.log.mock.calls as unknown[]),
        ...(logSpies.warn.mock.calls as unknown[]),
        ...(logSpies.error.mock.calls as unknown[]),
      ];
      const allLoggedText = allCalls
        .flat()
        .filter((arg): arg is string => typeof arg === 'string')
        .join('\n');

      expect(allLoggedText).not.toContain(to);
      expect(allLoggedText).not.toContain(link);
      expect(allLoggedText).not.toContain('super-secret-token');
    });
  });

  describe('maskEmail', () => {
    it('keeps the domain and masks the local part beyond its first character', () => {
      expect(maskEmail('jane.doe@corp.com')).toBe('j***@corp.com');
    });

    it('falls back to a fixed mask for an address with no local part', () => {
      expect(maskEmail('@corp.com')).toBe('***');
    });
  });
});
