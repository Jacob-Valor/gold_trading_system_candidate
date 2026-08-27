import Decimal from "decimal.js";

import { CONFIG, priceServiceInterval, priceServicePaused } from "@/lib/config";
import { prisma } from "@/lib/prisma";

let timer: NodeJS.Timeout | undefined;

async function updatePrice(): Promise<void> {
  if (priceServicePaused()) return;

  const current = await prisma.price.findUnique({ where: { id: "singleton" } });
  if (!current) return;

  const phase = Date.now() / priceServiceInterval();
  const movement = new Decimal(Math.sin(phase)).mul("0.01");
  const nextPrice = new Decimal(CONFIG.goldBasePriceUsd())
    .mul(new Decimal(1).plus(movement))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  await prisma.price.update({
    where: { id: "singleton" },
    data: { currency: "USD", pricePerGram: nextPrice.toFixed(2) },
  });
}

/** Start the opt-in mock price service once per Node.js process. */
export function startPriceWalker(): void {
  if (process.env.PRICE_WALKER_ENABLED !== "true" || timer) return;

  const run = () => {
    void updatePrice().catch((error: unknown) => {
      console.error("Gold price walker update failed", error);
    });
  };

  run();
  timer = setInterval(run, priceServiceInterval());
  timer.unref?.();
}
