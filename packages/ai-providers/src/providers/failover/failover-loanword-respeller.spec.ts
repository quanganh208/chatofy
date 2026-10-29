import { describe, expect, it, vi } from 'vitest';

import { ProviderResponseError } from '../../errors/provider-errors.js';
import type { LoanwordRespeller } from '../../interfaces/loanword-respeller.js';
import { FailoverLoanwordRespeller } from './failover-loanword-respeller.js';
import { HostCircuit } from './host-circuit.js';

function fake(name: string, fail?: Error) {
  const answer = <T>(value: T) =>
    vi.fn(async () => {
      if (fail) throw fail;
      return value;
    });
  return {
    name,
    respell: answer({}),
    repairHomophones: answer([] as unknown[]),
    fuseRecognizers: answer<unknown>({ text: 'x' }),
  } satisfies LoanwordRespeller;
}

const request = {} as never;

describe('FailoverLoanwordRespeller', () => {
  it('makes exactly one call and rethrows when the primary fails', async () => {
    const circuit = new HostCircuit();
    const primary = fake('primary', new ProviderResponseError('busy', 503));
    const secondary = fake('secondary');
    const respeller = new FailoverLoanwordRespeller({ name: 'cc', primary, secondary, circuit });

    await expect(respeller.repairHomophones(request)).rejects.toThrow('busy');
    await expect(respeller.fuseRecognizers(request)).rejects.toThrow('busy');
    await expect(respeller.respell(request)).rejects.toThrow('busy');
    expect(secondary.repairHomophones).not.toHaveBeenCalled();
    expect(secondary.fuseRecognizers).not.toHaveBeenCalled();
    expect(secondary.respell).not.toHaveBeenCalled();
    expect(circuit.isOpen()).toBe(false);
  });

  it('opens the shared circuit on a spent usage window', async () => {
    const circuit = new HostCircuit();
    const primary = fake(
      'primary',
      new ProviderResponseError('answered 429: 5-hour usage limit RATE_LIMITED', 429),
    );
    const respeller = new FailoverLoanwordRespeller({
      name: 'cc',
      primary,
      secondary: fake('secondary'),
      circuit,
    });
    await expect(respeller.repairHomophones(request)).rejects.toThrow();
    expect(circuit.isOpen()).toBe(true);
  });

  it('goes straight to the secondary while the circuit is open', async () => {
    const circuit = new HostCircuit();
    circuit.trip('usage limit');
    const primary = fake('primary');
    const secondary = fake('secondary');
    const respeller = new FailoverLoanwordRespeller({ name: 'cc', primary, secondary, circuit });

    await respeller.fuseRecognizers(request);
    expect(secondary.fuseRecognizers).toHaveBeenCalledTimes(1);
    expect(primary.fuseRecognizers).not.toHaveBeenCalled();
  });
});
