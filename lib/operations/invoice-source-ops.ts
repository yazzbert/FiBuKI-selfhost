/**
 * Frequency inference logic for browser recipes / invoice sources.
 * Kept from the original invoice-source-ops after merging InvoiceSource → BrowserRecipe.
 */

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import { UserPartner } from "@/types/partner";
import { TaxFile } from "@/types/file";
import { OperationsContext } from "./types";

const PARTNERS_COLLECTION = "partners";
const FILES_COLLECTION = "files";

// ============ Frequency Inference ============

/**
 * Standard frequency periods in days
 */
const FREQUENCY_PERIODS = [
  { days: 7, label: "weekly" },
  { days: 14, label: "bi-weekly" },
  { days: 30, label: "monthly" },
  { days: 90, label: "quarterly" },
  { days: 180, label: "semi-annually" },
  { days: 365, label: "yearly" },
];

/**
 * Round a number of days to the nearest standard frequency period
 */
function roundToStandardFrequency(days: number): number {
  let closest = FREQUENCY_PERIODS[0];
  let minDiff = Math.abs(days - closest.days);

  for (const period of FREQUENCY_PERIODS) {
    const diff = Math.abs(days - period.days);
    if (diff < minDiff) {
      minDiff = diff;
      closest = period;
    }
  }

  return closest.days;
}

/**
 * Get human-readable label for a frequency in days
 */
export function getFrequencyLabel(days: number): string {
  const period = FREQUENCY_PERIODS.find((p) => p.days === days);
  return period?.label || `every ${days} days`;
}

/**
 * Infer invoice frequency from historical files connected to this partner
 * from the same domain as the recipe/source.
 *
 * Algorithm:
 * 1. Get files for this partner from the same domain
 * 2. Sort by extracted date (or createdAt fallback)
 * 3. Calculate intervals between consecutive invoices
 * 4. Find median interval and round to standard period
 * 5. Require at least 3 invoices (2 intervals) for confidence
 *
 * @param recipeOrSourceId - Can be a browserRecipe ID or an invoiceSource ID (legacy)
 */
export async function inferInvoiceFrequency(
  ctx: OperationsContext,
  partnerId: string,
  recipeOrSourceId: string
): Promise<{ frequencyDays: number; dataPoints: number } | null> {
  // Get the partner
  const partnerRef = doc(ctx.db, PARTNERS_COLLECTION, partnerId);
  const partnerSnap = await getDoc(partnerRef);

  if (!partnerSnap.exists()) {
    throw new Error(`Partner not found: ${partnerId}`);
  }

  const partner = partnerSnap.data() as UserPartner;

  // Verify ownership
  if (partner.userId !== ctx.userId) {
    throw new Error("Access denied: Partner belongs to another user");
  }

  // Find the domain — check browserRecipes first, then legacy invoiceSources
  let domain: string | undefined;

  const recipes = partner.browserRecipes || [];
  const recipe = recipes.find((r) => r.id === recipeOrSourceId);
  if (recipe) {
    domain = recipe.domain;
  }

  if (!domain) {
    const sources = partner.invoiceSources || [];
    const source = sources.find((s) => s.id === recipeOrSourceId);
    if (source) {
      domain = source.domain;
    }
  }

  if (!domain) {
    throw new Error(`Recipe or source not found: ${recipeOrSourceId}`);
  }

  // Get files for this partner
  const filesQuery = query(
    collection(ctx.db, FILES_COLLECTION),
    where("userId", "==", ctx.userId),
    where("partnerId", "==", partnerId)
  );

  const filesSnap = await getDocs(filesQuery);
  const files = filesSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as TaxFile[];

  // Filter to files from the same domain (browser source)
  const domainFiles = files.filter((f) => {
    if (f.sourceType !== "browser") return false;
    if (!f.sourceDomain) return false;
    return (
      f.sourceDomain === domain ||
      f.sourceDomain.endsWith(`.${domain}`) ||
      domain!.endsWith(`.${f.sourceDomain}`)
    );
  });

  // Need at least 3 files for meaningful inference
  if (domainFiles.length < 3) {
    return null;
  }

  // Extract dates and sort
  const dates = domainFiles
    .map((f) => {
      // Prefer extracted date, fall back to created date
      if (f.extractedDate) {
        return f.extractedDate.toDate();
      }
      if (f.createdAt) {
        return f.createdAt.toDate();
      }
      return null;
    })
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  // Need at least 3 dates
  if (dates.length < 3) {
    return null;
  }

  // Calculate intervals between consecutive dates
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const diffMs = dates[i].getTime() - dates[i - 1].getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    // Only include reasonable intervals (1 day to 2 years)
    if (diffDays >= 1 && diffDays <= 730) {
      intervals.push(diffDays);
    }
  }

  // Need at least 2 valid intervals
  if (intervals.length < 2) {
    return null;
  }

  // Find median interval
  intervals.sort((a, b) => a - b);
  const midIndex = Math.floor(intervals.length / 2);
  const medianDays =
    intervals.length % 2 === 0
      ? (intervals[midIndex - 1] + intervals[midIndex]) / 2
      : intervals[midIndex];

  // Round to standard frequency
  const frequencyDays = roundToStandardFrequency(medianDays);

  return {
    frequencyDays,
    dataPoints: dates.length,
  };
}
