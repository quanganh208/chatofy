// The respeller over two hosts, with a stricter rule than the translator's.
//
// Its callers run inside budgets of 1.2–2.5 s and already read a thrown error
// as "no correction this turn". A primary that failed has usually spent most of
// that budget doing it, so a second round-trip would land after the caller had
// stopped waiting, while still holding a connection. So a failure is rethrown —
// one network call per check, always — and the secondary is asked only while
// the circuit says the primary is out.
import type {
  HomophoneRepairRequest,
  LoanwordProposal,
  LoanwordRespellRequest,
  LoanwordRespeller,
  RecognizerFusionRequest,
} from '../../interfaces/loanword-respeller.js';
import { type HostCircuit, tripOnPersistentFailure } from './host-circuit.js';

export interface FailoverLoanwordRespellerConfig {
  name: string;
  primary: LoanwordRespeller;
  secondary: LoanwordRespeller;
  /** Shared with the translator on the same host. */
  circuit: HostCircuit;
}

export class FailoverLoanwordRespeller implements LoanwordRespeller {
  readonly name: string;
  private readonly primary: LoanwordRespeller;
  private readonly secondary: LoanwordRespeller;
  private readonly circuit: HostCircuit;

  constructor(config: FailoverLoanwordRespellerConfig) {
    this.name = config.name;
    this.primary = config.primary;
    this.secondary = config.secondary;
    this.circuit = config.circuit;
  }

  respell(request: LoanwordRespellRequest): Promise<Record<string, LoanwordProposal>> {
    return this.call((host) => host.respell(request));
  }

  repairHomophones(request: HomophoneRepairRequest): Promise<unknown[]> {
    return this.call((host) => host.repairHomophones(request));
  }

  fuseRecognizers(request: RecognizerFusionRequest): Promise<unknown> {
    return this.call((host) => host.fuseRecognizers(request));
  }

  private async call<T>(run: (host: LoanwordRespeller) => Promise<T>): Promise<T> {
    if (this.circuit.isOpen()) return run(this.secondary);
    try {
      return await run(this.primary);
    } catch (err) {
      tripOnPersistentFailure(this.circuit, err);
      throw err;
    }
  }
}
