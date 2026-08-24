import { Prisma, TransactionType } from "@/lib/prisma";
import type { Currency } from "@/lib/prisma";
import Decimal from "decimal.js";

import { withTransactionRetry } from "@/lib/prisma";
import { UnprocessableError } from "@/lib/errors";

/**
 * Apply a signed currency change to a wallet inside the caller's transaction.
 *
 * `delta` is positive for credits (deposit, adjustment, sell proceeds) and
 * negative for debits (withdraw, buy cost).
 *
 * The update is ATOMIC: its non-negative guard and balance change evaluate
 * against the same locked row. The prior balance is derived from the returned
 * post-update value, so no stale pre-read can affect the audit record.
 */
export async function changeWalletBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  currency: Currency,
  delta: Decimal,
  description?: string,
  transactionType?: TransactionType,
): Promise<{ walletId: string; balanceAfter: Decimal; previousBalance: Decimal }> {
  const quantizedDelta = delta.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (quantizedDelta.isZero()) {
    throw new UnprocessableError("Wallet change must be at least 0.01");
  }

  const rows = await tx.$queryRaw<Array<{ id: string; balance: string }>>(
    Prisma.sql`UPDATE "Wallet"
               SET "balance" = "balance" + ${quantizedDelta.toFixed(2)}::numeric,
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE "userId" = ${userId}
                 AND "currency" = ${currency}::"Currency"
                 AND "balance" + ${quantizedDelta.toFixed(2)}::numeric >= 0
               RETURNING "id", "balance"`,
  );
  if (rows.length !== 1) {
    throw new UnprocessableError(`Insufficient ${currency} balance or wallet unavailable`);
  }

  const walletId = rows[0].id;
  const balanceAfter = new Decimal(new Decimal(rows[0].balance.toString()).toFixed(2));
  const previousBalance = new Decimal(balanceAfter.minus(quantizedDelta).toFixed(2));

  await tx.transaction.create({
    data: {
      userId,
      walletId,
      type:
        transactionType ??
        (quantizedDelta.isNegative() ? TransactionType.withdraw : TransactionType.deposit),
      amount: quantizedDelta.abs().toFixed(2),
      currency,
      balanceAfter: balanceAfter.toFixed(2),
      description,
    },
  });

  return { walletId, balanceAfter, previousBalance };
}

/** Convenience wrapper: open a transaction and apply `delta`. */
export async function applyMoneyDelta(
  userId: string,
  currency: Currency,
  delta: Decimal,
  description?: string,
) {
  return withTransactionRetry((tx) =>
    changeWalletBalance(tx, userId, currency, delta, description),
  );
}