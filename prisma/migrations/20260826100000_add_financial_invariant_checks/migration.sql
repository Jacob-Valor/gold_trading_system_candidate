-- Defense in depth for direct SQL or future code paths. The drops make the
-- migration recoverable after a partially applied attempt.
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_balance_nonnegative";
ALTER TABLE "GoldHolding" DROP CONSTRAINT IF EXISTS "GoldHolding_grams_nonnegative";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_amount_positive";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_amount_nonnegative";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_balanceAfter_nonnegative";
ALTER TABLE "Trade" DROP CONSTRAINT IF EXISTS "Trade_goldAmount_positive";
ALTER TABLE "Trade" DROP CONSTRAINT IF EXISTS "Trade_price_positive";
ALTER TABLE "Trade" DROP CONSTRAINT IF EXISTS "Trade_totalCost_positive";
ALTER TABLE "Trade" DROP CONSTRAINT IF EXISTS "Trade_goldBalanceAfter_nonnegative";

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_balance_nonnegative" CHECK ("balance" >= 0);

ALTER TABLE "GoldHolding"
  ADD CONSTRAINT "GoldHolding_grams_nonnegative" CHECK ("grams" >= 0);

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amount_nonnegative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "Transaction_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0);

ALTER TABLE "Trade"
  ADD CONSTRAINT "Trade_goldAmount_positive" CHECK ("goldAmount" > 0),
  ADD CONSTRAINT "Trade_price_positive" CHECK ("pricePerGram" > 0),
  ADD CONSTRAINT "Trade_totalCost_positive" CHECK ("totalCost" > 0),
  ADD CONSTRAINT "Trade_goldBalanceAfter_nonnegative" CHECK ("goldBalanceAfter" >= 0);
