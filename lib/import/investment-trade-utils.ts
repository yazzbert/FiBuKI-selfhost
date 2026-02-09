import { TradeType, AssetType } from "@/types/investment-trade";

/**
 * Normalize trade type strings from various broker formats.
 * Client-side mirror of functions/src/investments/fifoUtils.ts
 */
export function normalizeTradeType(raw: string): TradeType {
  const lower = raw.toLowerCase().trim();

  if (
    lower === "buy" || lower === "kauf" || lower === "market buy" ||
    lower === "open position" || lower === "long" ||
    lower === "deposit" || lower === "transfer_in" || lower === "transfer in"
  ) return "buy";

  if (
    lower === "sell" || lower === "verkauf" || lower === "market sell" ||
    lower === "close position" || lower === "short" ||
    lower === "withdrawal" || lower === "transfer_out" || lower === "transfer out"
  ) return "sell";

  if (lower === "dividend" || lower === "dividende" || lower === "distribution") return "dividend";
  if (lower === "interest" || lower === "zinsen" || lower === "staking reward") return "interest";
  if (lower === "fee" || lower === "gebühr" || lower === "rollover fee" || lower === "overnight fee" || lower === "spread") return "fee";
  if (lower.includes("transfer in") || lower.includes("einzahlung")) return "transfer_in";
  if (lower.includes("transfer out") || lower.includes("auszahlung")) return "transfer_out";

  return "buy";
}

/**
 * Detect asset type from ticker/ISIN/name heuristics.
 * Client-side mirror of functions/src/investments/fifoUtils.ts
 */
export function detectAssetType(
  ticker: string,
  isin?: string | null,
  assetName?: string | null
): AssetType {
  const t = ticker.toUpperCase();
  const name = (assetName || "").toLowerCase();

  const cryptoTickers = new Set([
    "BTC", "ETH", "XRP", "ADA", "SOL", "DOT", "DOGE", "MATIC",
    "AVAX", "LINK", "UNI", "SHIB", "LTC", "BCH", "XLM", "ALGO",
    "ATOM", "FIL", "NEAR", "ICP", "APT", "ARB", "OP", "SUI",
  ]);
  if (cryptoTickers.has(t) || name.includes("bitcoin") || name.includes("ethereum")) return "crypto";

  if (
    name.includes("etf") || name.includes("ucits") ||
    name.includes("index fund") || name.includes("vanguard") ||
    name.includes("ishares") || name.includes("spdr") ||
    name.includes("xtrackers") || name.includes("lyxor") ||
    t.endsWith(".DE") || t.endsWith(".AS") || t.endsWith(".L")
  ) return "etf";

  if (name.includes("bond") || name.includes("anleihe") || name.includes("treasury")) return "bond";

  if (isin) return "stock";

  return "other";
}
