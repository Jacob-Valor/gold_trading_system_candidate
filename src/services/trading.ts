import { Prisma, TradeType, TransactionType } from "@/lib/prisma";
import type { Currency } from "@/lib/prisma";
import Decimal from "decimal.js";

import { withTransactionRetry } from "@/lib/prisma";
import { UnprocessableError } from "@/lib/errors";
import { changeWalletBalance, lockActiveUser } from "@/services/wallet";

export type TradeResult = {
  tradeId: string;
  pricePerGram: Decimal;
  totalCost: Decimal;
  goldBalanceAfter: Decimal;
  walletBalanceAfter: Decimal;
};

/**
 * Execute a gold trade atomically:
 * - locks the user's wallet row (serializes concurrent trades/withdrawals)
 * - buy: debits money before crediting gold
 * - sell: atomically decrements gold (guarded UPDATE ... RETURNING), then credits money
 * - writes Trade + Transaction rows; any failure rolls back the whole unit.
 */
export async function executeTrade(
  userId: string,
  type: TradeType,
  goldAmount: Decimal,
  pricePerGram: Decimal,
  currency: Currency,
): Promise<TradeResult> {
  if (
    !goldAmount.isFinite() ||
    goldAmount.lt("0.00000001") ||
    goldAmount.gt(1_000_000) ||
    goldAmount.decimalPlaces() > 8
  ) {
    throw new UnprocessableError(
      "goldAmount must be between 0.00000001 and 1000000 with at most 8 decimal places",
    );
  }

  const settlementPrice = pricePerGram.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!pricePerGram.isFinite() || settlementPrice.lte(0)) {
    throw new UnprocessableError("Rounded settlement price must be at least 0.01");
  }

  const totalCost = goldAmount
    .mul(settlementPrice)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (totalCost.lte(0)) {
    throw new UnprocessableError("Rounded trade total must be at least 0.01");
  }

  return withTransactionRetry(async (tx) => {
    await lockActiveUser(tx, userId);
    const holding = await tx.goldHolding.upsert({
      where: { userId },
      create: { userId, grams: "0" },
      update: {},
    });
    const goldNow = new Decimal(holding.grams.toString());

    let goldAfter: Decimal;
    let walletBalanceAfter: Decimal;
    let tradeId: string;

    if (type === TradeType.buy) {
      // Debit money first (locks wallet row), then credit gold. The wallet
      // service writes the `trade_buy` transaction row (no duplicate `withdraw`).
      const { walletId, balanceAfter } = await changeWalletBalance(
        tx,
        userId,
        currency,
        totalCost.negated(),
        `Buy ${goldAmount.toFixed(8)}g gold @ ${settlementPrice.toFixed(2)}`,
        TransactionType.trade_buy,
      );
      walletBalanceAfter = balanceAfter;

      // Credit gold atomically: `grams = grams + $amt ... RETURNING` locks the
      // row, so concurrent buys accumulate instead of overwriting each other
      // (read-then-write here silently lost gold — fixed).
      const rows = await tx.$queryRaw<Array<{ grams: string }>>(
        Prisma.sql`UPDATE "GoldHolding" SET "grams" = "grams" + ${goldAmount.toFixed(8)}::numeric
                   WHERE "userId" = ${userId}
                   RETURNING "grams"`,
      );
      goldAfter = new Decimal(rows[0].grams.toString());

      const trade = await tx.trade.create({
        data: {
          userId,
          type,
          goldAmount: goldAmount.toFixed(8),
          pricePerGram: settlementPrice.toFixed(2),
          currency,
          totalCost: totalCost.toFixed(2),
          goldBalanceAfter: goldAfter.toFixed(8),
        },
      });
      tradeId = trade.id;
    } else {
      // Sell: atomically decrement gold. `grams = grams - $amt ... RETURNING`
      // locks the row and evaluates the guard against the CURRENT value, so two
      // concurrent sells can never both pass the "have enough gold" check.
      const rows = await tx.$queryRaw<Array<{ grams: string }>>(
        Prisma.sql`UPDATE "GoldHolding" SET "grams" = "grams" - ${goldAmount.toFixed(8)}::numeric
                   WHERE "userId" = ${userId} AND "grams" >= ${goldAmount.toFixed(8)}::numeric
                   RETURNING "grams"`,
      );
      if (rows.length !== 1) {
        throw new UnprocessableError(
          `Insufficient gold: have ${goldNow.toFixed(8)}g, need ${goldAmount.toFixed(8)}g`,
        );
      }
      goldAfter = new Decimal(rows[0].grams.toString());

      // Credit money. The wallet service writes the `trade_sell` row (no
      // duplicate `deposit`), so history shows exactly one row per trade.
      const { walletId, balanceAfter } = await changeWalletBalance(
        tx,
        userId,
        currency,
        totalCost,
        `Sell ${goldAmount.toFixed(8)}g gold @ ${settlementPrice.toFixed(2)}`,
        TransactionType.trade_sell,
      );
      walletBalanceAfter = balanceAfter;

      const trade = await tx.trade.create({
        data: {
          userId,
          type,
          goldAmount: goldAmount.toFixed(8),
          pricePerGram: settlementPrice.toFixed(2),
          currency,
          totalCost: totalCost.toFixed(2),
          goldBalanceAfter: goldAfter.toFixed(8),
        },
      });
      tradeId = trade.id;
    }

    return {
      tradeId,
      pricePerGram: settlementPrice,
      totalCost,
      goldBalanceAfter: goldAfter,
      walletBalanceAfter,
    };
  });
}