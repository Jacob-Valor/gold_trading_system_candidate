export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // The walker imports Node-only Prisma/pg code; keep it out of Edge bundles.
  const { startPriceWalker } = await import("./services/price-walker");
  startPriceWalker();
}
