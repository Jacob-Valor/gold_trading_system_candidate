/** Decimal quantize helper: round to N decimal places using ROUND_HALF_UP. */
export function roundMoney(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundGrams(value: number): number {
  return roundMoney(value, 8);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}