// credits:void <grantId> [--note <text>] [--prod]
//
// Writes off what a grant still holds and marks it voided. Idempotent: voiding
// a voided grant changes nothing and exits 0.
import { CliRefusal } from './cli-prod-guard';
import { runCreditsCli } from './credits-cli.module';

const USAGE = 'Usage: credits:void <grantId> [--note <text>] [--prod]';

runCreditsCli({ note: { type: 'string' } }, USAGE, {
  describe(positionals) {
    if (positionals.length !== 1) throw new CliRefusal(USAGE);
    return {
      action: `void grant ${positionals[0]!}`,
      confirmWith: positionals[0]!,
    };
  },
  async run({ owner, positionals, values, print }) {
    const grantId = positionals[0]!;
    const note = typeof values.note === 'string' ? values.note : null;
    const result = await owner.voidGrant(grantId, note);
    if (result.state === 'not_found') {
      throw new CliRefusal(`No grant ${grantId}.`);
    }
    print(
      result.state === 'already_voided'
        ? `Grant ${grantId} was already voided; nothing changed.`
        : `Voided grant ${grantId}: ${result.amount} credit-seconds written off.`,
    );
  },
});
