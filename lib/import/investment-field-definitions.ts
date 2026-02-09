import { FieldDefinition } from "@/types/import";

/**
 * Rich field definitions for AI auto-matching of broker CSV columns.
 */
export const INVESTMENT_FIELDS: FieldDefinition[] = [
  {
    key: "date",
    label: "Trade Date",
    description:
      "The date when the trade was executed. Also known as execution date, settlement date, or trade date.",
    aliases: [
      // German
      "Datum", "Ausführungsdatum", "Handelsdatum", "Buchungsdatum",
      "Valuta", "Abrechnungsdatum",
      // English
      "Date", "Trade Date", "Execution Date", "Settlement Date",
      "Transaction Date", "Open Date", "Close Date",
    ],
    required: true,
    type: "date",
    examples: ["15.03.2024", "2024-03-15", "03/15/2024", "15/03/24"],
  },
  {
    key: "tradeType",
    label: "Trade Type",
    description:
      "The type of trade: buy, sell, dividend, interest, fee, or transfer. Indicates whether the asset was bought, sold, or if this is income (dividends/interest).",
    aliases: [
      // German
      "Typ", "Art", "Aktion", "Transaktionsart", "Handelstyp",
      "Buchungsart", "Vorgang",
      // English
      "Type", "Trade Type", "Action", "Side", "Direction",
      "Transaction Type", "Order Type",
    ],
    required: true,
    type: "text",
    examples: ["Buy", "Sell", "Dividend", "Kauf", "Verkauf", "Dividende", "Open Position", "Close Position"],
  },
  {
    key: "ticker",
    label: "Ticker / Symbol",
    description:
      "The ticker symbol or identifier of the traded asset. For stocks: AAPL, MSFT. For crypto: BTC, ETH. For ETFs: VOO, VWCE.",
    aliases: [
      // German
      "Symbol", "Kürzel", "Instrument", "Wertpapier", "Coin",
      "Ticker", "Münze",
      // English
      "Ticker", "Symbol", "Instrument", "Asset", "Coin",
      "Market", "Pair", "Trading Pair",
    ],
    required: true,
    type: "text",
    examples: ["AAPL", "BTC", "VWCE.DE", "TSLA", "ETH", "AMZN"],
  },
  {
    key: "isin",
    label: "ISIN",
    description:
      "International Securities Identification Number. A 12-character alphanumeric code (e.g. US0378331005). Only for stocks, ETFs, and bonds.",
    aliases: [
      "ISIN", "WKN", "Security ID", "Wertpapierkennnummer",
      "Kennnummer", "Securities ID",
    ],
    required: false,
    type: "text",
    examples: ["US0378331005", "IE00B4L5Y983", "DE0005140008"],
  },
  {
    key: "assetName",
    label: "Asset Name",
    description:
      "Human-readable name of the asset, e.g. 'Apple Inc.', 'Bitcoin', 'Vanguard FTSE All-World'.",
    aliases: [
      // German
      "Name", "Wertpapier", "Bezeichnung", "Beschreibung",
      "Instrumentenname",
      // English
      "Name", "Asset Name", "Security", "Description",
      "Instrument Name", "Details",
    ],
    required: false,
    type: "text",
    examples: ["Apple Inc.", "Bitcoin", "Vanguard FTSE All-World UCITS ETF"],
  },
  {
    key: "quantity",
    label: "Quantity",
    description:
      "Number of units traded. Can be fractional for crypto. Also known as shares, units, or amount of coins.",
    aliases: [
      // German
      "Stück", "Anzahl", "Menge", "Einheiten", "Nominal",
      // English
      "Quantity", "Qty", "Units", "Shares", "Amount",
      "Position Size", "Size", "Volume",
    ],
    required: true,
    type: "amount",
    examples: ["10", "0.5", "100", "1.234", "0.00125"],
  },
  {
    key: "pricePerUnit",
    label: "Price per Unit",
    description:
      "Price per unit/share at execution. Also known as rate, execution price, or fill price.",
    aliases: [
      // German
      "Kurs", "Preis", "Ausführungskurs", "Stückpreis",
      "Einstandspreis", "Rate",
      // English
      "Price", "Price per Unit", "Rate", "Fill Price",
      "Execution Price", "Unit Price", "Price/Share",
    ],
    required: false,
    type: "amount",
    examples: ["150.25", "42,350.00", "1.234,56", "0.0012"],
  },
  {
    key: "grossAmount",
    label: "Total Amount",
    description:
      "Total trade value (quantity * price). The gross amount before fees. May be labeled as 'Total', 'Value', or 'Volume'.",
    aliases: [
      // German
      "Betrag", "Gesamtbetrag", "Volumen", "Wert", "Summe",
      "Kurswert", "Gesamtwert",
      // English
      "Total", "Amount", "Value", "Total Amount", "Gross Amount",
      "Trade Value", "Net Value", "Volume",
    ],
    required: true,
    type: "amount",
    examples: ["-1.502,50", "1234.56", "€500.00", "42350.00"],
  },
  {
    key: "fees",
    label: "Fees",
    description:
      "Trading fees, commissions, or spread costs. May be zero for commission-free brokers.",
    aliases: [
      // German
      "Gebühr", "Gebühren", "Provision", "Spesen", "Kosten",
      "Spread", "Transaktionsgebühr",
      // English
      "Fee", "Fees", "Commission", "Spread", "Costs",
      "Transaction Fee", "Trading Fee", "Brokerage",
    ],
    required: false,
    type: "amount",
    examples: ["1.50", "0.00", "9,90", "0.5%"],
  },
  {
    key: "currency",
    label: "Currency",
    description:
      "Currency of the trade. If not provided, defaults to the source/account currency.",
    aliases: [
      // German
      "Währung", "CCY",
      // English
      "Currency", "CCY", "Cur", "FX",
    ],
    required: false,
    type: "text",
    examples: ["EUR", "USD", "GBP", "CHF"],
  },
];

/**
 * Get investment field definition by key
 */
export function getInvestmentFieldDefinition(key: string): FieldDefinition | undefined {
  return INVESTMENT_FIELDS.find((f) => f.key === key);
}

/**
 * Get all required investment fields
 */
export function getRequiredInvestmentFields(): FieldDefinition[] {
  return INVESTMENT_FIELDS.filter((f) => f.required);
}

/**
 * Find investment field by alias (case-insensitive)
 */
export function findInvestmentFieldByAlias(alias: string): FieldDefinition | undefined {
  const lowerAlias = alias.toLowerCase().trim();
  return INVESTMENT_FIELDS.find((f) =>
    f.aliases.some((a) => a.toLowerCase() === lowerAlias)
  );
}

/**
 * Build the AI prompt context for investment field matching
 */
export function buildInvestmentFieldDescriptionsForAI(): string {
  return INVESTMENT_FIELDS.map(
    (f) =>
      `- **${f.key}** (${f.required ? "required" : "optional"}): ${f.description}\n  Examples: ${f.examples.join(", ")}`
  ).join("\n\n");
}
