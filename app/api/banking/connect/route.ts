export const dynamic = "force-dynamic";
/**
 * Unified Banking Connection API
 *
 * Creates bank connections through any configured provider.
 * Uses Cloud Function for Firestore operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerUserIdWithFallback } from "@/lib/auth/get-server-user";
import {
  getBankingProvider,
  BankingProviderId,
  initializeBankingProviders,
} from "@/lib/banking";
import { callCloudFunction, setAuthToken } from "@/lib/firebase/callable-server";
import {
  CreateBankingConnectionRequest,
  CreateBankingConnectionResponse,
} from "@/types/banking-sync";

// Initialize providers on module load
initializeBankingProviders();

// Get redirect URL for provider callbacks
function getRedirectUrl(providerId: BankingProviderId): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${baseUrl}/api/finapi/callback`;
}

export async function POST(request: NextRequest) {
  // Set auth token for Cloud Function calls
  setAuthToken(request.headers.get("Authorization"));

  try {
    const userId = await getServerUserIdWithFallback(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { providerId, institutionId, sourceId, maxHistoryDays, language } = body;

    // Validate required fields
    if (!providerId) {
      return NextResponse.json(
        { error: "Provider ID is required" },
        { status: 400 }
      );
    }

    if (!institutionId) {
      return NextResponse.json(
        { error: "Institution ID is required" },
        { status: 400 }
      );
    }

    // Validate provider exists and is configured
    let provider;
    try {
      provider = getBankingProvider(providerId as BankingProviderId);
    } catch {
      return NextResponse.json(
        { error: `Unknown provider: ${providerId}` },
        { status: 400 }
      );
    }

    if (!provider.isConfigured()) {
      return NextResponse.json(
        { error: `Provider ${providerId} is not configured` },
        { status: 400 }
      );
    }

    // Get institution info
    const institution = await provider.getInstitution(institutionId);

    // Create connection with provider (external API call)
    const redirectUrl = getRedirectUrl(providerId as BankingProviderId);
    const result = await provider.createConnection({
      institutionId,
      redirectUrl,
      maxHistoryDays,
      language,
      reference: `conn_${userId}_${Date.now()}`,
    });

    // Store connection via Cloud Function
    const connectionResult = await callCloudFunction<
      CreateBankingConnectionRequest,
      CreateBankingConnectionResponse
    >("createBankingConnection", {
      providerId,
      providerConnectionId: result.connectionId,
      institutionId,
      institutionName: institution.name,
      institutionLogo: institution.logoUrl || null,
      authUrl: result.authUrl,
      expiresAt: result.expiresAt.toISOString(),
      providerData: result.providerData || {},
      linkToSourceId: sourceId || null,
    });

    return NextResponse.json({
      connectionId: connectionResult.connectionId,
      authUrl: result.authUrl,
      expiresAt: result.expiresAt.toISOString(),
      provider: providerId,
    });
  } catch (error) {
    console.error("[Banking Connect API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create connection" },
      { status: 500 }
    );
  }
}
