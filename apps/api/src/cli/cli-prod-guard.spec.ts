import { describe, expect, it, vi } from 'vitest';
import {
  CliRefusal,
  describeDatabase,
  guardDatabase,
  type GuardIo,
} from './cli-prod-guard';

function io(
  answer: string,
  isTTY = true,
): GuardIo & { ask: ReturnType<typeof vi.fn> } {
  return { isTTY, print: vi.fn(), ask: vi.fn(async () => answer) };
}

const prodUrl = 'postgresql://u:p@postgres:5432/chatofy';
const grant = { action: 'grant 10 credits', confirmWith: 'a@b.co' };

describe('describeDatabase', () => {
  it.each([
    ['postgresql://u:p@localhost:5434/db', true],
    ['postgresql://u:p@127.0.0.1:5432/db', true],
    ['postgresql://u:p@localhost:5433/db', false],
    ['postgresql://u:p@postgres:5432/db', false],
    ['postgresql://u:p@postgres/db', false],
  ])('%s is local: %s', (url, local) => {
    expect(describeDatabase(url).local).toBe(local);
  });

  it('refuses a URL it cannot parse', () => {
    expect(() => describeDatabase('not a url')).toThrow(CliRefusal);
  });
});

describe('guardDatabase', () => {
  it('runs a local command without asking', async () => {
    const terminal = io('');
    await guardDatabase(
      {
        databaseUrl: 'postgresql://u:p@localhost:5434/db',
        prod: false,
        ...grant,
      },
      terminal,
    );
    expect(terminal.ask).not.toHaveBeenCalled();
  });

  it('refuses the production container database without --prod', async () => {
    await expect(
      guardDatabase(
        { databaseUrl: prodUrl, prod: false, ...grant },
        io('a@b.co'),
      ),
    ).rejects.toThrow(CliRefusal);
  });

  it('refuses the 5433 tunnel from a dev shell without --prod', async () => {
    await expect(
      guardDatabase(
        {
          databaseUrl: 'postgresql://u:p@localhost:5433/db',
          prod: false,
          action: 'void',
        },
        io(''),
      ),
    ).rejects.toThrow(/not a local development database/);
  });

  it('refuses --prod with no terminal to confirm in', async () => {
    await expect(
      guardDatabase(
        { databaseUrl: prodUrl, prod: true, ...grant },
        io('a@b.co', false),
      ),
    ).rejects.toThrow(/needs a terminal/);
  });

  it('runs with --prod once the subject is typed back, and not on a mismatch', async () => {
    await expect(
      guardDatabase(
        { databaseUrl: prodUrl, prod: true, ...grant },
        io(' a@b.co\n'),
      ),
    ).resolves.toMatchObject({
      host: 'postgres',
    });
    await expect(
      guardDatabase(
        { databaseUrl: prodUrl, prod: true, ...grant },
        io('b@b.co'),
      ),
    ).rejects.toThrow(/Not confirmed/);
  });

  it('lets a read-only command through with --prod and no confirmation', async () => {
    const terminal = io('', false);
    await expect(
      guardDatabase(
        { databaseUrl: prodUrl, prod: true, action: 'list' },
        terminal,
      ),
    ).resolves.toBeDefined();
    expect(terminal.ask).not.toHaveBeenCalled();
  });
});
