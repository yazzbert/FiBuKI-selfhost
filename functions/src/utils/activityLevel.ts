/**
 * Derive the activity level for an automation history entry.
 *
 * Duplicated from types/transaction.ts (functions rootDir restriction
 * prevents importing from ../../types/).
 *
 * KEEP IN SYNC with the frontend version.
 */

type ActivityLevel = "decision" | "outcome" | "info";

interface ActivityLevelInput {
  type: string;
  actor?: string;
}

export function deriveActivityLevel(entry: ActivityLevelInput): ActivityLevel {
  const { type, actor } = entry;

  // Process telemetry types are always info
  if (
    type === "receipt_search" ||
    type === "file_matching" ||
    type === "partner_matching" ||
    type === "company_check"
  ) {
    return "info";
  }

  // category_matched is always an automation outcome
  if (type === "category_matched") {
    return "outcome";
  }

  // Removal types are always user decisions
  if (type === "partner_removed" || type === "file_disconnected" || type === "category_removed") {
    return "decision";
  }

  // Assignment types: decision if manual/suggestion, outcome if auto/ai
  if (actor === "auto" || actor === "ai") {
    return "outcome";
  }

  return "decision";
}
