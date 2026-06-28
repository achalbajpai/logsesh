export function humanizeTokens(n: number | undefined): string {
  if (n === undefined) return "-";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function money(amount: number, opts?: { estimated?: boolean }): string {
  const prefix = opts?.estimated ? "~$" : "$";
  return `${prefix}${amount.toFixed(2)}`;
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function padNum(value: number | string, width: number): string {
  return String(value).padStart(width);
}
