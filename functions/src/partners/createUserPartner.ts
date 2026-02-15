/**
 * Create a new user partner
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

interface PartnerFormData {
  name: string;
  aliases?: string[];
  address?: string | null;
  country?: string | null;
  vatId?: string | null;
  ibans?: string[];
  website?: string | null;
  notes?: string | null;
  defaultCategoryId?: string | null;
  /** Link to global partner if creating from suggestion */
  globalPartnerId?: string;
  /** Mark this partner as "my company" for counterparty extraction */
  isMyCompany?: boolean;
}

interface CreateUserPartnerRequest {
  data: PartnerFormData;
  /**
   * If true, skip automatic matching on partner create.
   * Use this when the partner is being created for immediate manual assignment
   * (to avoid race condition where onPartnerCreate auto-matches before manual assignment).
   */
  skipAutoMatch?: boolean;
}

interface CreateUserPartnerResponse {
  success: boolean;
  partnerId: string;
}

const LEGAL_SUFFIX_ONLY_ALIASES = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "gmbh",
  "ag",
  "kg",
  "ohg",
  "og",
  "mbh",
  "co",
  "sarl",
  "sas",
  "srl",
  "spa",
  "sl",
  "bv",
  "nv",
]);

function normalizeAliasInput(alias: string): string {
  return alias.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
}

function isMeaningfulAlias(alias: string): boolean {
  const normalized = alias
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length < 3) return false;
  if (LEGAL_SUFFIX_ONLY_ALIASES.has(normalized)) return false;
  return /[a-z0-9]/i.test(normalized);
}

function sanitizeAliases(rawAliases: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawAlias of rawAliases) {
    const cleaned = normalizeAliasInput(rawAlias);
    if (!cleaned || !isMeaningfulAlias(cleaned)) continue;

    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    result.push(cleaned);
  }

  return result;
}

/**
 * Normalize IBAN by removing spaces and converting to uppercase
 */
function normalizeIban(iban: string): string {
  return iban.replace(/\s/g, "").toUpperCase();
}

/**
 * Normalize URL by ensuring protocol and lowercasing
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  // Remove trailing slash
  return normalized.replace(/\/+$/, "");
}

/**
 * Internal implementation for creating a user partner.
 * Can be called directly from MCP handlers.
 */
export async function createUserPartnerInternal(
  dbRef: FirebaseFirestore.Firestore,
  userId: string,
  data: PartnerFormData,
  options?: { skipAutoMatch?: boolean }
): Promise<CreateUserPartnerResponse> {
  if (!data?.name?.trim()) {
    throw new HttpsError("invalid-argument", "Partner name is required");
  }

  const now = Timestamp.now();

  const newPartner: Record<string, unknown> = {
    userId,
    name: data.name.trim(),
    aliases: sanitizeAliases(data.aliases || []),
    address: data.address || null,
    country: data.country || null,
    vatId: data.vatId?.toUpperCase().replace(/\s/g, "") || null,
    ibans: (data.ibans || []).map(normalizeIban).filter(Boolean),
    website: data.website ? normalizeUrl(data.website) : null,
    notes: data.notes || null,
    defaultCategoryId: data.defaultCategoryId || null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  if (data.globalPartnerId) {
    newPartner.globalPartnerId = data.globalPartnerId;
  }

  if (data.isMyCompany) {
    newPartner.isMyCompany = true;
  }

  if (options?.skipAutoMatch) {
    newPartner.createdBy = "manual_assignment";
  }

  const docRef = await dbRef.collection("partners").add(newPartner);

  console.log(`[createUserPartner] Created partner ${docRef.id}`, {
    userId,
    name: data.name,
  });

  return {
    success: true,
    partnerId: docRef.id,
  };
}

export const createUserPartnerCallable = createCallable<
  CreateUserPartnerRequest,
  CreateUserPartnerResponse
>(
  { name: "createUserPartner" },
  async (ctx, request) => {
    return createUserPartnerInternal(ctx.db, ctx.userId, request.data, {
      skipAutoMatch: request.skipAutoMatch,
    });
  }
);
