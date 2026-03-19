export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function formatUsd(value: number | null | undefined): string {
  const amount = value ?? 0;
  if (amount === 0) {
    return "$0";
  }

  return `$${amount.toFixed(amount < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatCompactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 3).trimEnd()}...`;
}
