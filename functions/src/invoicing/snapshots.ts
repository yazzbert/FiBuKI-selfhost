/**
 * Snapshot helpers for invoices.
 *
 * Issuer / recipient are stored as immutable snapshots on the Invoice so that
 * later edits to the underlying IdentityEntity / Partner do not mutate the
 * historical invoice.
 */

import {
  InvoiceIssuerSnapshot,
  InvoicePartnerAddress,
  InvoiceRecipientSnapshot,
} from "./types";
import { bicFromIban } from "./bicLookup";

// Minimal subset of UserData / IdentityEntity needed here.
// Backend cannot import from /types/, so we redeclare the fields we read.
export interface MinimalIdentityEntity {
  id: string;
  type?: "person" | "company";
  name: string;
  vatId?: string | null;
  ibans?: string[] | null;
  /** Optional structured address (not part of the canonical type, but tolerated). */
  address?: InvoicePartnerAddress | null;
}

export interface MinimalUserData {
  personalEntity?: MinimalIdentityEntity | null;
  companies?: MinimalIdentityEntity[] | null;
}

/**
 * Loads the user's identity data from users/{uid}/settings/userData.
 * Returns null if no doc exists.
 */
export async function loadUserIdentity(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<MinimalUserData | null> {
  const snap = await db.doc(`users/${userId}/settings/userData`).get();
  if (!snap.exists) return null;
  return (snap.data() || null) as MinimalUserData | null;
}

/**
 * Flattens personalEntity + companies into a single array.
 */
function allEntities(userData: MinimalUserData | null): MinimalIdentityEntity[] {
  if (!userData) return [];
  const out: MinimalIdentityEntity[] = [];
  if (userData.personalEntity) out.push(userData.personalEntity);
  if (Array.isArray(userData.companies)) out.push(...userData.companies);
  return out.filter((e): e is MinimalIdentityEntity => !!e && !!e.id && !!e.name);
}

/**
 * Picks an IdentityEntity for issuing.
 * - If `preferredEntityId` is supplied and matches, return that.
 * - Otherwise return the first available entity (personal preferred).
 */
export function pickIssuerEntity(
  userData: MinimalUserData | null,
  preferredEntityId?: string | null,
): MinimalIdentityEntity | null {
  const entities = allEntities(userData);
  if (entities.length === 0) return null;
  if (preferredEntityId) {
    const match = entities.find((e) => e.id === preferredEntityId);
    if (match) return match;
  }
  return entities[0];
}

/**
 * Picks an IBAN from the entity. Prefers `preferredIban` if present and listed.
 */
export function pickIssuerIban(
  entity: MinimalIdentityEntity,
  preferredIban?: string | null,
): string | undefined {
  const ibans = (entity.ibans || []).filter((iban) => typeof iban === "string" && iban.length > 0);
  if (preferredIban && ibans.includes(preferredIban)) return preferredIban;
  return ibans[0];
}

/**
 * Build the issuer snapshot from an IdentityEntity + chosen IBAN.
 */
export function buildIssuerSnapshot(
  entity: MinimalIdentityEntity,
  iban: string,
): InvoiceIssuerSnapshot {
  const snapshot: InvoiceIssuerSnapshot = {
    entityId: entity.id,
    name: entity.name,
    iban,
  };
  if (entity.vatId) snapshot.vatId = entity.vatId;
  if (entity.address) snapshot.address = entity.address;
  const bic = bicFromIban(iban);
  if (bic) snapshot.bic = bic;
  return snapshot;
}

// =============================================================================
// Recipient snapshots
// =============================================================================

interface MinimalPartnerDoc {
  name?: string;
  vatId?: string | null;
  address?: InvoicePartnerAddress | null;
}

/**
 * Loads a partner doc by ID + type and returns a recipient snapshot.
 * Throws if the partner doesn't exist (callers should validate before calling).
 */
export async function buildRecipientSnapshot(
  db: FirebaseFirestore.Firestore,
  partnerId: string,
  partnerType: "user" | "global",
  userId: string,
): Promise<InvoiceRecipientSnapshot | null> {
  const collection = partnerType === "user" ? "partners" : "globalPartners";
  const snap = await db.collection(collection).doc(partnerId).get();
  if (!snap.exists) return null;
  const data = (snap.data() || {}) as MinimalPartnerDoc & { userId?: string };

  // For user partners, enforce ownership
  if (partnerType === "user" && data.userId && data.userId !== userId) {
    return null;
  }

  if (!data.name) return null;

  const recipient: InvoiceRecipientSnapshot = {
    partnerId,
    partnerType,
    name: data.name,
  };
  if (data.vatId) recipient.vatId = data.vatId;
  if (data.address) recipient.address = data.address;
  return recipient;
}
