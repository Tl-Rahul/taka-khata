import type { AccountType } from "@/lib/finance/types";

export const ACCOUNT_COLORS: Record<AccountType, string> = {
  cash: "#0b6e4f",
  bank: "#2b67a6",
  bkash: "#e2136e",
  nagad: "#f26522",
  rocket: "#8c3494",
  mfs_other: "#1f9d8b",
  savings: "#3e9a74",
  fixed_deposit: "#b8862b",
  credit_card: "#c9372b",
  investment: "#7c5cc4",
  other: "#7a8580",
};

export const accountColor = (a: { color: string | null; type: AccountType }) => a.color || ACCOUNT_COLORS[a.type];
