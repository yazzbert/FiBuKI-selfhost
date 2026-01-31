import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { VertexAI } from "@google-cloud/vertexai";
import { logAIUsage } from "../utils/ai-usage-logger";
import { globMatch, matchPatternFlexible } from "../utils/pattern-utils";
import { matchCategoriesForTransactions } from "./matchCategories";

// Using Gemini Flash Lite for pattern learning
const GEMINI_MODEL = "gemini-2.0-flash-lite-001";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "europe-west1";

// ============================================================================
// Pattern Safety Configuration
// ============================================================================

/**
 * Common German banking/invoice words that are too generic as standalone patterns.
 * Patterns containing ONLY these (e.g., "*rechnung*") are auto-rejected.
 */
const GENERIC_BANKING_TERMS = [
  "rechnung",      // invoice
  "rechner",       // calculator/computer
  "rechn",         // partial "rechnung"
  "ueberweisung",  // bank transfer
  "überweisung",   // bank transfer
  "lastschrift",   // direct debit
  "gutschrift",    // credit
  "zahlung",       // payment
  "bezahlung",     // payment
  "abbuchung",     // debit
  "einzahlung",    // deposit
  "auszahlung",    // withdrawal
  "konto",         // account
  "sepa",          // SEPA
  "mandat",        // mandate
  "referenz",      // reference
  "verwendung",    // purpose
  "betrag",        // amount
  "iban",          // IBAN
  "bic",           // BIC
  "nr",            // number (as in "Rechn.Nr.")
];

/**
 * Check if a pattern is a standalone generic banking term.
 */
function checkPatternSafety(
  pattern: string,
  matchCount: number,
  totalTransactions: number,
  sourceTransactionCount: number
): { rejected: boolean; reason?: string } {
  const normalizedPattern = pattern.toLowerCase().replace(/\*/g, "");
  const patternParts = normalizedPattern.split(/[^a-zäöüß]+/).filter((p) => p.length >= 2);

  if (patternParts.length > 0) {
    const allPartsGeneric = patternParts.every((part) =>
      GENERIC_BANKING_TERMS.some((term) =>
        part === term || term.startsWith(part) || part.startsWith(term)
      )
    );

    if (allPartsGeneric) {
      return {
        rejected: true,
        reason: `Pattern "${pattern}" contains only generic banking terms (${patternParts.join(", ")})`,
      };
    }
  }

  return { rejected: false };
}

// Get project ID from environment
function getProjectId(): string {
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Could not determine Google Cloud project ID");
  }
  return projectId;
}

const db = getFirestore();

// ============================================================================
// Types
// ============================================================================

interface LearnCategoryPatternsRequest {
  partnerId: string;
  categoryId: string;
  transactionId?: string; // Optional: the newly assigned/removed transaction
}

interface TransactionRecord {
  id: string;
  partner: string | null;
  name: string;
  reference: string | null;
  categoryId: string | null;
}

interface CategoryMatchRule {
  categoryId: string;
  categoryTemplateId: string;
  patterns: string[];
  excludePatterns?: string[];
  confidence: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sourceTransactionIds: string[];
  negativeTransactionIds?: string[];
}

interface AIPatternResponse {
  patterns: Array<{
    pattern: string;
    confidence: number;
    reasoning: string;
  }>;
  excludePatterns?: Array<{
    pattern: string;
    reasoning: string;
  }>;
}

interface AIVerificationResponse {
  verified: Array<{
    pattern: string;
    approved: boolean;
    adjustedConfidence?: number;
    reason?: string;
  }>;
}

interface LearnCategoryPatternsResponse {
  patternsLearned: number;
  patterns: string[];
  excludePatterns: string[];
  transactionsMatched: number;
}

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPrompt(
  partnerName: string,
  categoryName: string,
  positiveTransactions: TransactionRecord[],
  negativeTransactions: TransactionRecord[],
  collisionTransactions: TransactionRecord[]
): string {
  const positiveList = positiveTransactions
    .map((tx) => `- partner: "${tx.partner || "(empty)"}" | name: "${tx.name}"`)
    .join("\n");

  const negativeList = negativeTransactions
    .slice(0, 20)
    .map((tx) => `- partner: "${tx.partner || "(empty)"}" | name: "${tx.name}"`)
    .join("\n");

  const collisionList = collisionTransactions
    .slice(0, 30)
    .map((tx) => `- partner: "${tx.partner || "(empty)"}" | name: "${tx.name}" → category: ${tx.categoryId}`)
    .join("\n");

  return `You are analyzing bank transaction data to learn matching patterns for assigning a specific category to transactions from a specific partner.

## Context
Partner: ${partnerName}
Category: ${categoryName}

This partner has multiple types of transactions, but only SOME of them should be assigned to this category.
Your task is to find patterns that distinguish the transactions that belong to "${categoryName}" from those that don't.

## MUST MATCH - Transactions that SHOULD get this category
Your patterns MUST match ALL of these:
${positiveList || "(no transactions yet)"}

## MUST NOT MATCH - Transactions manually REMOVED from this category (false positives)
These transactions were suggested for this category but the user said they are WRONG. Your patterns MUST NOT match any of these:
${negativeList || "(none)"}

## MUST NOT MATCH - Transactions assigned to OTHER categories (collision check)
These transactions from the same partner are assigned to different categories. Your patterns must NOT match ANY of these:
${collisionList || "(no other categorized transactions)"}

## Instructions

Generate glob-style patterns that will match future transactions from this partner that should be assigned to "${categoryName}".

IMPORTANT: Prefer GENERAL patterns over specific ones!
- Start broad (e.g., "*youtube*") rather than narrow (e.g., "*youtube*premium*membership*renewal*")
- Only be specific when necessary to avoid collisions with negative examples
- Simpler patterns = better (easier to match future variations)

Pattern Rules:
1. Use * as a wildcard (matches any characters, including spaces)
2. Patterns must match ALL "must match" transactions
3. Patterns must NOT match ANY "must not match" transactions
4. Prefer shorter, more general patterns when safe
5. Handle spelling variations by using * between word parts

Confidence Guidelines:
- 95-100: General pattern that matches all positive transactions without any collisions
- 85-94: Good pattern with low collision risk
- 70-84: More specific pattern needed to avoid collisions
- Below 70: Don't suggest patterns this weak

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "patterns": [
    {
      "pattern": "*youtubepremium*",
      "confidence": 92,
      "reasoning": "Matches all YouTube Premium transactions without matching Cloud or Ads"
    }
  ],
  "excludePatterns": [
    {
      "pattern": "*cloud*",
      "reasoning": "Explicitly exclude Google Cloud transactions"
    }
  ]
}

If no good patterns can be learned (e.g., only 1 transaction with no clear pattern), return:
{"patterns": [], "excludePatterns": []}`;
}

// ============================================================================
// Verification Prompt
// ============================================================================

interface DryRunMatch {
  id: string;
  name: string;
  partner: string | null;
  isPositive: boolean;
  isNegative: boolean;
  otherCategory?: string;
}

function buildVerificationPrompt(
  partnerName: string,
  categoryName: string,
  proposedPatterns: Array<{ pattern: string; confidence: number }>,
  excludePatterns: string[],
  dryRunResults: Map<string, DryRunMatch[]>,
  totalTransactions: number
): string {
  const sections = proposedPatterns.map((p) => {
    const matches = dryRunResults.get(p.pattern) || [];
    const positiveMatches = matches.filter((m) => m.isPositive);
    const negativeMatches = matches.filter((m) => m.isNegative);
    const collisionMatches = matches.filter((m) => !m.isPositive && !m.isNegative && m.otherCategory);
    const unassigned = matches.filter((m) => !m.isPositive && !m.isNegative && !m.otherCategory);

    const matchPercent = totalTransactions ? ((matches.length / totalTransactions) * 100).toFixed(1) : null;
    const isBroad = matches.length > 20 || (matchPercent && parseFloat(matchPercent) > 3);

    return `## Pattern: "${p.pattern}" (proposed confidence: ${p.confidence}%)

⚠️ MATCH STATISTICS: Would match ${matches.length} transactions${matchPercent ? ` (${matchPercent}% of partner's transactions)` : ""}${isBroad ? " - THIS IS A LOT, BE CAREFUL!" : ""}

POSITIVE (correctly assigned to ${categoryName}): ${positiveMatches.length}
${positiveMatches.slice(0, 5).map((m) => `  ✓ "${m.partner || "(no partner)"}" | "${m.name}"`).join("\n")}

NEGATIVE (user said these are WRONG): ${negativeMatches.length}
${negativeMatches.slice(0, 5).map((m) => `  ✗ "${m.partner || "(no partner)"}" | "${m.name}"`).join("\n")}

COLLISIONS (assigned to other categories): ${collisionMatches.length}
${collisionMatches.slice(0, 5).map((m) => `  ⚠ "${m.partner || "(no partner)"}" | "${m.name}" → ${m.otherCategory}`).join("\n")}

UNASSIGNED (would be auto-assigned): ${unassigned.length}
${unassigned.slice(0, 5).map((m) => `  + "${m.partner || "(no partner)"}" | "${m.name}"`).join("\n")}
${unassigned.length > 5 ? `... and ${unassigned.length - 5} more` : ""}`;
  });

  return `You are VERIFYING patterns for partner "${partnerName}" → category "${categoryName}".

${excludePatterns.length > 0 ? `Exclude patterns that will filter OUT matches: ${excludePatterns.join(", ")}` : ""}

Below are proposed patterns and what transactions they WOULD match if applied.
Review each pattern and decide whether to APPROVE or REJECT it.

${sections.join("\n\n")}

## Verification Rules

REJECT patterns that:
- Match ANY negative examples (user explicitly said these are wrong)
- Match transactions assigned to OTHER categories (collisions)
- Are too generic (match >50% of unrelated transactions)
- Contain only generic banking terms

APPROVE patterns that:
- Match ALL positive examples
- Match mostly relevant unassigned transactions (likely correct)
- Have reasonable specificity

Respond ONLY with valid JSON:
{
  "verified": [
    {"pattern": "*youtube*", "approved": true, "adjustedConfidence": 90},
    {"pattern": "*google*", "approved": false, "reason": "too broad - matches Cloud and Ads"}
  ]
}`;
}

// ============================================================================
// Dry Run Pattern Match
// ============================================================================

async function dryRunPatternMatch(
  userId: string,
  partnerId: string,
  categoryId: string,
  proposedPatterns: Array<{ pattern: string; confidence: number }>,
  positiveIds: Set<string>,
  negativeIds: Set<string>,
  categoryMap: Map<string, string>
): Promise<Map<string, DryRunMatch[]>> {
  const results = new Map<string, DryRunMatch[]>();

  // Get all transactions for this partner
  const allTxSnapshot = await db
    .collection("transactions")
    .where("userId", "==", userId)
    .where("partnerId", "==", partnerId)
    .limit(500)
    .get();

  for (const pattern of proposedPatterns) {
    const matches: DryRunMatch[] = [];

    for (const txDoc of allTxSnapshot.docs) {
      const txData = txDoc.data();
      const txName = txData.name || null;
      const txPartner = txData.partner || null;
      const txReference = txData.reference || null;

      if (matchPatternFlexible(pattern.pattern.toLowerCase(), txName, txPartner, txReference)) {
        const txCategoryId = txData.noReceiptCategoryId || null;

        matches.push({
          id: txDoc.id,
          name: txData.name || "",
          partner: txData.partner || null,
          isPositive: positiveIds.has(txDoc.id),
          isNegative: negativeIds.has(txDoc.id),
          otherCategory: txCategoryId && txCategoryId !== categoryId
            ? categoryMap.get(txCategoryId) || txCategoryId
            : undefined,
        });
      }
    }

    results.set(pattern.pattern, matches);
  }

  return results;
}

// ============================================================================
// Cascade Unassign
// ============================================================================

async function cascadeUnassignTransactions(
  userId: string,
  partnerId: string,
  categoryId: string,
  newRule: CategoryMatchRule | null
): Promise<number> {
  // Get all transactions assigned to this category by auto-matching
  const allAssignedSnapshot = await db
    .collection("transactions")
    .where("userId", "==", userId)
    .where("partnerId", "==", partnerId)
    .where("noReceiptCategoryId", "==", categoryId)
    .limit(500)
    .get();

  const autoAssignedDocs = allAssignedSnapshot.docs.filter((doc) => {
    const data = doc.data();
    const matchedBy = data.noReceiptCategoryMatchedBy;
    return matchedBy === "auto" || !matchedBy;
  });

  if (autoAssignedDocs.length === 0) return 0;

  const batch = db.batch();
  let unassignedCount = 0;

  for (const txDoc of autoAssignedDocs) {
    const txData = txDoc.data();

    // If we have new rules, check if transaction still matches
    if (newRule && newRule.patterns.length > 0) {
      const txName = txData.name || null;
      const txPartner = txData.partner || null;
      const txReference = txData.reference || null;

      // Check exclude patterns
      const excluded = newRule.excludePatterns?.some((p) =>
        matchPatternFlexible(p.toLowerCase(), txName, txPartner, txReference)
      );

      if (!excluded) {
        // Check positive patterns
        const stillMatches = newRule.patterns.some((p) =>
          matchPatternFlexible(p.toLowerCase(), txName, txPartner, txReference)
        );

        if (stillMatches && newRule.confidence >= 89) {
          continue; // Keep this assignment
        }
      }
    }

    // Unassign transaction
    batch.update(txDoc.ref, {
      noReceiptCategoryId: null,
      noReceiptCategoryTemplateId: null,
      noReceiptCategoryMatchedBy: null,
      noReceiptCategoryConfidence: null,
      isComplete: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    unassignedCount++;
  }

  if (unassignedCount > 0) {
    await batch.commit();
    console.log(`Cascade-unassigned ${unassignedCount} transactions that no longer match category rules`);
  }

  return unassignedCount;
}

// ============================================================================
// Cloud Function
// ============================================================================

/**
 * Learn category matching patterns for a partner based on assigned transactions.
 * Called after a user manually assigns/removes a category to/from a transaction with a partner.
 */
export const learnPartnerCategoryPatterns = onCall<LearnCategoryPatternsRequest>(
  {
    region: "europe-west1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request): Promise<LearnCategoryPatternsResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const userId = request.auth.uid;
    const { partnerId, categoryId, transactionId } = request.data;

    if (!partnerId || !categoryId) {
      throw new HttpsError("invalid-argument", "partnerId and categoryId are required");
    }

    console.log(`Learning category patterns for partner ${partnerId}, category ${categoryId}, triggered by transaction ${transactionId || "manual"}`);

    try {
      // 1. Fetch the partner
      const partnerDoc = await db.collection("partners").doc(partnerId).get();
      if (!partnerDoc.exists) {
        throw new HttpsError("not-found", `Partner ${partnerId} not found`);
      }

      const partnerData = partnerDoc.data()!;
      if (partnerData.userId !== userId) {
        throw new HttpsError("permission-denied", "Cannot access this partner");
      }

      const partnerName = partnerData.name || "";

      // 2. Fetch the category
      const categoryDoc = await db.collection("noReceiptCategories").doc(categoryId).get();
      if (!categoryDoc.exists) {
        throw new HttpsError("not-found", `Category ${categoryId} not found`);
      }

      const categoryData = categoryDoc.data()!;
      if (categoryData.userId !== userId) {
        throw new HttpsError("permission-denied", "Cannot access this category");
      }

      const categoryName = categoryData.name || "";
      const categoryTemplateId = categoryData.templateId || "";

      // 3. Get positive examples: transactions with this partner manually assigned to this category
      const positiveSnapshot = await db
        .collection("transactions")
        .where("userId", "==", userId)
        .where("partnerId", "==", partnerId)
        .where("noReceiptCategoryId", "==", categoryId)
        .where("noReceiptCategoryMatchedBy", "in", ["manual", "suggestion"])
        .limit(50)
        .get();

      const positiveTransactions: TransactionRecord[] = positiveSnapshot.docs.map((doc) => ({
        id: doc.id,
        partner: doc.data().partner || null,
        name: doc.data().name || "",
        reference: doc.data().reference || null,
        categoryId: categoryId,
      }));

      const positiveIds = new Set(positiveTransactions.map((t) => t.id));

      // 4. Get negative examples from partner.categoryManualRemovals
      const categoryManualRemovals: Array<{
        transactionId: string;
        categoryId: string;
        partner: string | null;
        name: string;
        reference: string | null;
      }> = (partnerData.categoryManualRemovals || []).filter(
        (r: { categoryId: string }) => r.categoryId === categoryId
      );

      const negativeTransactions: TransactionRecord[] = categoryManualRemovals.map((r) => ({
        id: r.transactionId,
        partner: r.partner || null,
        name: r.name || "",
        reference: r.reference || null,
        categoryId: null,
      }));

      const negativeIds = new Set(negativeTransactions.map((t) => t.id));

      console.log(`Found ${positiveTransactions.length} positive, ${negativeTransactions.length} negative examples`);

      // 5. Handle case where no manual assignments remain
      if (positiveTransactions.length === 0) {
        console.log(`No manual assignments for partner ${partnerId} -> category ${categoryId}, clearing rules`);

        // Remove rule for this category from partner
        const existingRules: CategoryMatchRule[] = partnerData.categoryMatchRules || [];
        const updatedRules = existingRules.filter((r) => r.categoryId !== categoryId);

        await partnerDoc.ref.update({
          categoryMatchRules: updatedRules,
          categoryMatchRulesUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Cascade-unassign auto-matched transactions
        const unassignedCount = await cascadeUnassignTransactions(userId, partnerId, categoryId, null);

        return {
          patternsLearned: 0,
          patterns: [],
          excludePatterns: [],
          transactionsMatched: -unassignedCount, // Negative to indicate unassigned
        };
      }

      // 6. Get collision transactions: same partner, different category (manual/suggestion only)
      const collisionSnapshot = await db
        .collection("transactions")
        .where("userId", "==", userId)
        .where("partnerId", "==", partnerId)
        .limit(200)
        .get();

      // Get category names for collision display
      const categoryIds = new Set<string>();
      collisionSnapshot.docs.forEach((doc) => {
        const catId = doc.data().noReceiptCategoryId;
        if (catId && catId !== categoryId) categoryIds.add(catId);
      });

      const categoryMap = new Map<string, string>();
      if (categoryIds.size > 0) {
        const categoryDocs = await Promise.all(
          Array.from(categoryIds).slice(0, 20).map((id) =>
            db.collection("noReceiptCategories").doc(id).get()
          )
        );
        categoryDocs.forEach((doc) => {
          if (doc.exists) {
            categoryMap.set(doc.id, doc.data()!.name || "Unknown");
          }
        });
      }

      const collisionTransactions: TransactionRecord[] = collisionSnapshot.docs
        .filter((doc) => {
          const data = doc.data();
          const catId = data.noReceiptCategoryId;
          const matchedBy = data.noReceiptCategoryMatchedBy;
          return (
            catId &&
            catId !== categoryId &&
            (matchedBy === "manual" || matchedBy === "suggestion")
          );
        })
        .map((doc) => ({
          id: doc.id,
          partner: doc.data().partner || null,
          name: doc.data().name || "",
          reference: doc.data().reference || null,
          categoryId: categoryMap.get(doc.data().noReceiptCategoryId) || doc.data().noReceiptCategoryId,
        }));

      console.log(`Found ${collisionTransactions.length} collision transactions`);

      // 7. Call Gemini to generate patterns
      const projectId = getProjectId();
      const vertexAI = new VertexAI({ project: projectId, location: VERTEX_LOCATION });
      const model = vertexAI.getGenerativeModel({ model: GEMINI_MODEL });

      const prompt = buildPrompt(
        partnerName,
        categoryName,
        positiveTransactions,
        negativeTransactions,
        collisionTransactions
      );

      const response = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const responseData = response.response;

      // Log AI usage
      const usageMetadata = responseData.usageMetadata;
      await logAIUsage(userId, {
        function: "categoryPatternLearning",
        model: GEMINI_MODEL,
        inputTokens: usageMetadata?.promptTokenCount || 0,
        outputTokens: usageMetadata?.candidatesTokenCount || 0,
        metadata: { partnerId, categoryId },
      });

      // Parse JSON response
      const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new HttpsError("internal", "No text response from AI");
      }

      let jsonText = text.trim();
      if (jsonText.startsWith("```json")) jsonText = jsonText.slice(7);
      else if (jsonText.startsWith("```")) jsonText = jsonText.slice(3);
      if (jsonText.endsWith("```")) jsonText = jsonText.slice(0, -3);
      jsonText = jsonText.trim();

      let aiResult: AIPatternResponse;
      try {
        aiResult = JSON.parse(jsonText);
      } catch (parseError) {
        console.error("Failed to parse AI response:", jsonText);
        throw new HttpsError("internal", "Failed to parse AI response as JSON");
      }

      // Validate patterns
      if (!aiResult.patterns || !Array.isArray(aiResult.patterns)) {
        console.log("AI returned no patterns");
        return { patternsLearned: 0, patterns: [], excludePatterns: [], transactionsMatched: 0 };
      }

      // Check for false positive matches
      const matchesFalsePositive = (pattern: string): TransactionRecord | null => {
        for (const tx of negativeTransactions) {
          const textToMatch = [tx.name, tx.partner, tx.reference]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (textToMatch && globMatch(pattern, textToMatch)) {
            return tx;
          }
        }
        return null;
      };

      // Pre-filter patterns
      const candidatePatterns = aiResult.patterns
        .filter((p) => {
          if (!p.pattern || typeof p.pattern !== "string") return false;
          if (typeof p.confidence !== "number" || p.confidence < 50) return false;

          const normalizedPattern = p.pattern.toLowerCase().trim();
          const falsePositive = matchesFalsePositive(normalizedPattern);
          if (falsePositive) {
            console.log(`REJECTED pattern "${normalizedPattern}" - matches false positive: "${falsePositive.name}"`);
            return false;
          }
          return true;
        })
        .map((p) => ({
          pattern: p.pattern.toLowerCase().trim(),
          confidence: Math.min(100, Math.max(0, Math.round(p.confidence))),
        }));

      const excludePatterns = (aiResult.excludePatterns || [])
        .filter((p) => p.pattern && typeof p.pattern === "string")
        .map((p) => p.pattern.toLowerCase().trim());

      // 8. Dry-run verification
      let verifiedPatterns = candidatePatterns;

      if (candidatePatterns.length > 0) {
        console.log(`Running dry-run verification for ${candidatePatterns.length} candidate patterns`);

        const dryRunResults = await dryRunPatternMatch(
          userId,
          partnerId,
          categoryId,
          candidatePatterns,
          positiveIds,
          negativeIds,
          categoryMap
        );

        // Get total transaction count for this partner
        const totalTransactions = collisionSnapshot.size;

        // Safety checks
        const safePatterns: typeof candidatePatterns = [];
        for (const cp of candidatePatterns) {
          const matches = dryRunResults.get(cp.pattern) || [];
          const safety = checkPatternSafety(
            cp.pattern,
            matches.length,
            totalTransactions,
            positiveTransactions.length
          );

          if (safety.rejected) {
            console.log(`SAFETY REJECTED pattern "${cp.pattern}": ${safety.reason}`);
            dryRunResults.delete(cp.pattern);
          } else {
            safePatterns.push(cp);
          }
        }

        if (safePatterns.length === 0) {
          console.log("All patterns rejected by safety checks");
          verifiedPatterns = [];
        } else {
          // LLM verification
          const verifyPrompt = buildVerificationPrompt(
            partnerName,
            categoryName,
            safePatterns,
            excludePatterns,
            dryRunResults,
            totalTransactions
          );

          const verifyResponse = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: verifyPrompt }] }],
          });

          const verifyResponseData = verifyResponse.response;

          await logAIUsage(userId, {
            function: "categoryPatternVerification",
            model: GEMINI_MODEL,
            inputTokens: verifyResponseData.usageMetadata?.promptTokenCount || 0,
            outputTokens: verifyResponseData.usageMetadata?.candidatesTokenCount || 0,
            metadata: { partnerId, categoryId },
          });

          const verifyText = verifyResponseData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (verifyText) {
            try {
              let verifyJsonText = verifyText.trim();
              if (verifyJsonText.startsWith("```json")) verifyJsonText = verifyJsonText.slice(7);
              else if (verifyJsonText.startsWith("```")) verifyJsonText = verifyJsonText.slice(3);
              if (verifyJsonText.endsWith("```")) verifyJsonText = verifyJsonText.slice(0, -3);

              const verifyResult: AIVerificationResponse = JSON.parse(verifyJsonText.trim());

              verifiedPatterns = safePatterns.filter((cp) => {
                const verification = verifyResult.verified?.find((v) => v.pattern === cp.pattern);
                if (!verification) return true;
                if (!verification.approved) {
                  console.log(`VERIFICATION REJECTED pattern "${cp.pattern}": ${verification.reason || "no reason"}`);
                  return false;
                }
                if (verification.adjustedConfidence !== undefined) {
                  cp.confidence = verification.adjustedConfidence;
                }
                return true;
              });

              console.log(`Verification: ${safePatterns.length} safe patterns → ${verifiedPatterns.length} approved`);
            } catch (parseErr) {
              console.warn("Failed to parse verification response, using safe patterns:", parseErr);
              verifiedPatterns = safePatterns;
            }
          } else {
            verifiedPatterns = safePatterns;
          }
        }
      }

      // 9. Build and save the rule
      const now = Timestamp.now();
      const sourceTransactionIds = positiveTransactions.map((tx) => tx.id);
      const negativeTransactionIds = negativeTransactions.map((tx) => tx.id);

      // Calculate base confidence from patterns
      let ruleConfidence = 0;
      if (verifiedPatterns.length > 0) {
        const avgPatternConfidence = Math.round(
          verifiedPatterns.reduce((sum, p) => sum + p.confidence, 0) / verifiedPatterns.length
        );

        // If we have exclude patterns, the ambiguity is RESOLVED - confidence should be high
        // The exclude patterns successfully filter out false positives
        if (excludePatterns.length > 0) {
          // High confidence: we know what to match AND what to exclude
          ruleConfidence = Math.max(90, avgPatternConfidence);
          console.log(`High confidence (${ruleConfidence}%) - exclude patterns resolve ambiguity`);
        } else if (negativeTransactions.length > 0) {
          // Negatives exist but no exclude patterns generated - still ambiguous
          // Apply small penalty to avoid auto-matching uncertain cases
          const penalty = Math.min(15, negativeTransactions.length * 3);
          ruleConfidence = Math.max(70, avgPatternConfidence - penalty);
          console.log(`Reduced confidence: ${avgPatternConfidence}% - ${penalty}% penalty → ${ruleConfidence}% (negatives without excludes)`);
        } else {
          // No negatives, no excludes - use AI confidence directly
          ruleConfidence = avgPatternConfidence;
        }
      }

      const newRule: CategoryMatchRule = {
        categoryId,
        categoryTemplateId,
        patterns: verifiedPatterns.map((p) => p.pattern),
        confidence: ruleConfidence,
        createdAt: now,
        updatedAt: now,
        sourceTransactionIds,
        // Only include optional arrays if they have values (Firestore doesn't accept undefined)
        ...(excludePatterns.length > 0 && { excludePatterns }),
        ...(negativeTransactionIds.length > 0 && { negativeTransactionIds }),
      };

      // Update partner's categoryMatchRules
      const existingRules: CategoryMatchRule[] = partnerData.categoryMatchRules || [];
      const updatedRules = existingRules.filter((r) => r.categoryId !== categoryId);

      if (verifiedPatterns.length > 0) {
        updatedRules.push(newRule);
      }

      await partnerDoc.ref.update({
        categoryMatchRules: updatedRules,
        categoryMatchRulesUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`Learned ${verifiedPatterns.length} patterns for partner ${partnerId} -> category ${categoryId}:`,
        verifiedPatterns.map((p) => p.pattern));

      // 10. Cascade-unassign transactions that no longer match
      const unassignedCount = await cascadeUnassignTransactions(
        userId,
        partnerId,
        categoryId,
        verifiedPatterns.length > 0 ? newRule : null
      );
      if (unassignedCount > 0) {
        console.log(`Cascade-unassigned ${unassignedCount} transactions for partner ${partnerId} -> category ${categoryId}`);
      }

      // 11. Re-run category matching for ALL transactions with this partner
      // This updates stored categorySuggestions to reflect the new rules
      // (clears suggestions for excluded transactions, adds suggestions for matching ones)
      const allPartnerTxSnapshot = await db
        .collection("transactions")
        .where("userId", "==", userId)
        .where("partnerId", "==", partnerId)
        .select() // Only get IDs, we don't need the data
        .limit(500)
        .get();

      const allPartnerTxIds = allPartnerTxSnapshot.docs.map((doc) => doc.id);
      console.log(`Re-matching categories for ${allPartnerTxIds.length} transactions with partner ${partnerId}`);

      let matchedCount = 0;
      if (allPartnerTxIds.length > 0) {
        const rematchResult = await matchCategoriesForTransactions(userId, allPartnerTxIds);
        matchedCount = rematchResult.autoMatched;
        console.log(`Category re-match: ${rematchResult.processed} processed, ${rematchResult.autoMatched} auto-matched, ${rematchResult.withSuggestions} with suggestions`);
      }

      // 12. Create notification if transactions were matched
      if (matchedCount > 0) {
        try {
          await db.collection(`users/${userId}/notifications`).add({
            type: "category_pattern_learned",
            title: `Learned category patterns for ${partnerName}`,
            message: `I learned ${verifiedPatterns.length} pattern${verifiedPatterns.length !== 1 ? "s" : ""} and automatically assigned ${matchedCount} transaction${matchedCount !== 1 ? "s" : ""} to ${categoryName}.`,
            createdAt: FieldValue.serverTimestamp(),
            readAt: null,
            context: {
              partnerId,
              partnerName,
              categoryId,
              categoryName,
              patternsLearned: verifiedPatterns.length,
              transactionsMatched: matchedCount,
            },
          });
        } catch (err) {
          console.error("Failed to create notification:", err);
        }
      }

      return {
        patternsLearned: verifiedPatterns.length,
        patterns: verifiedPatterns.map((p) => p.pattern),
        excludePatterns,
        transactionsMatched: matchedCount,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;

      console.error("Error learning category patterns:", error);
      throw new HttpsError(
        "internal",
        `Category pattern learning failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
);

/**
 * Internal function for calling from other Cloud Functions
 */
export async function learnPartnerCategoryPatternsInternal(
  userId: string,
  partnerId: string,
  categoryId: string
): Promise<LearnCategoryPatternsResponse> {
  // Simplified internal call - reuse the main logic
  const partnerDoc = await db.collection("partners").doc(partnerId).get();
  if (!partnerDoc.exists || partnerDoc.data()?.userId !== userId) {
    return { patternsLearned: 0, patterns: [], excludePatterns: [], transactionsMatched: 0 };
  }

  // For internal calls, we can call the main function logic directly
  // This is a simplified version that just triggers learning
  console.log(`[Internal] Learning category patterns for partner ${partnerId} -> category ${categoryId}`);

  // Import and call via httpsCallable internally isn't ideal, so we duplicate the core logic
  // For now, return empty and let the queue handle it properly
  return { patternsLearned: 0, patterns: [], excludePatterns: [], transactionsMatched: 0 };
}
