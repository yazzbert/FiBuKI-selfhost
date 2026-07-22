/**
 * Server-side authentication helpers
 *
 * Verifies Firebase ID tokens with the Admin SDK. In dev the Admin app is
 * pointed at the Auth emulator (lib/firebase/admin.ts sets
 * FIREBASE_AUTH_EMULATOR_HOST at module load), so emulator tokens verify too.
 *
 * Self-host builds never route auth through these helpers: the browser talks
 * to fibuki-api directly (OIDC), and the Next API routes are not part of the
 * self-host data plane.
 */

import { NextResponse } from "next/server";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase/admin";

/**
 * Thrown by getServerUserIdWithFallback for a missing/invalid token so route
 * catch blocks can answer 401 instead of a generic 500 (W1 decision
 * 2026-07-21, docs/decisions.md: 401 shaping approved).
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized: Missing or invalid Authorization header");
    this.name = "UnauthorizedError";
  }
}

/**
 * The one 401 shape every route answers with — returns the response for an
 * UnauthorizedError and null for anything else, so a route catch can open
 * with:
 *
 *   const unauthorized = unauthorizedResponse(error);
 *   if (unauthorized) return unauthorized;
 *
 * Never includes internal error text (two routes used to echo it).
 */
export function unauthorizedResponse(error: unknown): NextResponse | null {
  return error instanceof UnauthorizedError
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : null;
}

// Strip CR/LF so request-derived values cannot forge log lines
function sanitizeForLog(value: unknown): string {
  const raw = value instanceof Error ? value.stack || value.message : String(value);
  return raw.replace(/\n|\r/g, "");
}

async function verifyRequestToken(request: Request): Promise<DecodedIdToken | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    return await getAuth(getAdminApp()).verifyIdToken(token);
  } catch (e) {
    console.warn("[Auth] Token verification failed:", sanitizeForLog(e));
    return null;
  }
}

/**
 * Get the verified user ID from the request's Authorization header.
 * Throws if the header is missing or the token does not verify.
 */
export async function getServerUserIdWithFallback(
  request: Request
): Promise<string> {
  const decoded = await verifyRequestToken(request);
  if (decoded?.uid) {
    return decoded.uid;
  }
  throw new UnauthorizedError();
}

/**
 * Check the verified `admin` custom claim on the request's token.
 */
export async function isServerUserAdmin(request: Request): Promise<boolean> {
  const decoded = await verifyRequestToken(request);
  return decoded?.admin === true;
}
