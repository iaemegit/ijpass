export function formatCurrency(value: string, symbol: '$' | '₹') {
  const clean = value.trim();
  return /^[0-9][0-9,]*(?:\.[0-9]+)?$/.test(clean) ? `${symbol}${clean}` : clean;
}
