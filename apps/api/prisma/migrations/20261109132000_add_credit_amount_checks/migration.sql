-- Backstops for the ledger's own arithmetic. The application keeps these true
-- under the user's advisory lock; a bug that broke them would otherwise leave a
-- balance silently wrong instead of failing the transaction that caused it.

-- A grant is created for a positive amount and never holds more than it was
-- created with: releases and refunds give back only what was taken from it.
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_remaining_within_amount" CHECK ("remaining" <= "amount");

-- A lease consumes only what it holds; an overshoot grows `held` first.
ALTER TABLE "CreditLease" ADD CONSTRAINT "CreditLease_held_nonnegative" CHECK ("held" >= 0);
ALTER TABLE "CreditLease" ADD CONSTRAINT "CreditLease_consumed_within_held" CHECK ("consumed" >= 0 AND "consumed" <= "held");
