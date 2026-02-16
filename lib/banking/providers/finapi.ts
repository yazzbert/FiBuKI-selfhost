/**
 * finAPI Banking Provider
 *
 * Implements BankingProvider interface for finAPI.
 *
 * Key characteristics:
 * - Uses Web Form 2.0 for bank authentication (redirect flow)
 * - Creates finAPI users per app user (auto-managed)
 * - Supports EU banks (plus Switzerland)
 * - XS2A (PSD2) compliant
 */

import { Timestamp } from "firebase/firestore";
import {
  BankingProviderId,
  BankingProviderInfo,
  BankingInstitution,
  BankingAccount,
  BankingTransaction,
  BankingConfig,
  FinapiBankingConfig,
  BankingError,
} from "../types";
import {
  BaseBankingProvider,
  CreateConnectionOptions,
  CreateConnectionResult,
  CallbackOptions,
  CallbackResult,
  FetchTransactionsOptions,
} from "../provider";
import {
  FinapiClient,
  FinapiBank,
  FinapiAccount,
  FinapiTransaction,
  FinapiEnvironment,
} from "@/lib/finapi/client";
import { FINAPI_SUPPORTED_COUNTRY_CODES } from "@/lib/banking/finapi-countries";

const FINAPI_COUNTRIES = FINAPI_SUPPORTED_COUNTRY_CODES;

/**
 * finAPI Provider Implementation
 */
export class FinapiProvider extends BaseBankingProvider {
  readonly id: BankingProviderId = "finapi";

  private client: FinapiClient | null = null;

  constructor() {
    super();
    this.initializeClient();
  }

  private initializeClient(): void {
    const clientId = process.env.FINAPI_CLIENT_ID;
    const clientSecret = process.env.FINAPI_CLIENT_SECRET;
    const environment = (process.env.FINAPI_ENVIRONMENT || "sandbox") as FinapiEnvironment;

    if (clientId && clientSecret) {
      this.client = new FinapiClient({
        clientId,
        clientSecret,
        environment,
      });
    }
  }

  getInfo(): BankingProviderInfo {
    return {
      id: "finapi",
      name: "finAPI",
      description: "Connect to European banks via finAPI.",
      supportedCountries: [...FINAPI_COUNTRIES],
      logoUrl: "/images/providers/finapi-logo.svg",
      isEnabled: this.isConfigured(),
      requiresReauth: true,
      reauthDays: 90, // PSD2 XS2A consent period
    };
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private getClient(): FinapiClient {
    if (!this.client) {
      throw new BankingError(
        "finAPI is not configured. Set FINAPI_CLIENT_ID and FINAPI_CLIENT_SECRET.",
        "finapi",
        "NOT_CONFIGURED"
      );
    }
    return this.client;
  }

  async listInstitutions(countryCode: string): Promise<BankingInstitution[]> {
    const client = this.getClient();
    const upperCountry = countryCode.toUpperCase();

    if (!FINAPI_COUNTRIES.includes(upperCountry)) {
      return [];
    }

    try {
      const response = await client.getBanks({
        location: upperCountry,
        isTestBank: process.env.FINAPI_ENVIRONMENT === "sandbox" ? undefined : false,
        perPage: 500,
      });

      return response.banks.map((bank) => this.transformInstitution(bank));
    } catch (error) {
      console.error("[finAPI] Error listing institutions:", error);
      return [];
    }
  }

  async getInstitution(institutionId: string): Promise<BankingInstitution> {
    const client = this.getClient();
    const bankId = parseInt(institutionId, 10);

    if (isNaN(bankId)) {
      throw new BankingError(`Invalid bank ID: ${institutionId}`, "finapi", "INVALID_ID");
    }

    const bank = await client.getBank(bankId);
    return this.transformInstitution(bank);
  }

  /**
   * Create a bank connection via Web Form 2.0
   */
  async createConnection(
    options: CreateConnectionOptions
  ): Promise<CreateConnectionResult> {
    const client = this.getClient();

    // Extract user ID from reference (format: conn_userId_timestamp)
    const parts = options.reference?.split("_") || [];
    const appUserId = parts[1] || "unknown";

    // Generate finAPI user credentials
    // Password is deterministic based on userId so we can recover it for existing users
    // finAPI user ID must be max 36 chars, so use short prefix + truncated app user ID
    const finapiUserId = `fb_${appUserId.slice(0, 32)}`;
    const finapiPassword = this.generatePassword(finapiUserId);

    // Try to create finAPI user (or get token if exists)
    let userToken: string;
    let refreshToken: string;
    let tokenExpiresAt: Date;

    let tokenResponse;

    // First verify client credentials work by getting client token
    try {
      await client.getClientToken();
      console.log("[finAPI] Client credentials valid");
    } catch (clientError) {
      console.error("[finAPI] Client credentials error:", clientError);
      throw new BankingError(
        "finAPI client credentials are invalid. Check FINAPI_CLIENT_ID and FINAPI_CLIENT_SECRET.",
        "finapi",
        "INVALID_CLIENT_CREDENTIALS"
      );
    }

    try {
      // Try to create user first
      await client.createUser(finapiUserId, finapiPassword);
      console.log("[finAPI] Created new user:", finapiUserId);
    } catch (createError) {
      const errorMsg = createError instanceof Error ? createError.message : String(createError);
      if (errorMsg.includes("already") || errorMsg.includes("exists")) {
        console.log("[finAPI] User already exists:", finapiUserId);
      } else {
        console.error("[finAPI] User creation error:", errorMsg);
        throw createError;
      }
    }

    // Get user token (password is deterministic so this should always work for v2 users)
    try {
      tokenResponse = await client.getUserToken(finapiUserId, finapiPassword);
      console.log("[finAPI] Got user token for:", finapiUserId);
    } catch (tokenError) {
      const errorMsg = tokenError instanceof Error ? tokenError.message : String(tokenError);
      console.error("[finAPI] User token error:", errorMsg, "for user:", finapiUserId);
      // If password mismatch, user might be from old random-password era - try v3
      throw new BankingError(
        `Failed to authenticate finAPI user. Error: ${errorMsg}`,
        "finapi",
        "USER_AUTH_FAILED"
      );
    }
    userToken = tokenResponse.access_token;
    refreshToken = tokenResponse.refresh_token || "";
    tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Create web form for bank connection
    // Note: Web Form 2.0 requires HTTPS callback URLs - skip callback for localhost
    const bankId = parseInt(options.institutionId, 10);
    const isHttps = options.redirectUrl?.startsWith("https://");
    const webForm = await client.createBankConnectionWebForm(userToken, bankId, {
      redirectUrl: isHttps ? options.redirectUrl : undefined,
      maxDaysForDownload: options.maxHistoryDays || 90,
    });

    // Return web form URL for redirect
    return {
      connectionId: webForm.id,
      authUrl: webForm.url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry for web form
      providerData: {
        finapiUserId,
        finapiPassword,
        userAccessToken: userToken,
        userRefreshToken: refreshToken,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        webFormToken: webForm.token,
      },
    };
  }

  /**
   * Handle callback after Web Form completion
   */
  async handleCallback(options: CallbackOptions): Promise<CallbackResult> {
    const client = this.getClient();

    if (options.error) {
      return {
        success: false,
        status: "rejected",
        error: options.errorDescription || options.error,
      };
    }

    // Get stored provider data to retrieve user token
    // This would typically come from the connection document
    // For now, we assume the connection has providerData with tokens

    // The callback typically includes the webFormId in the URL
    // We need to check the web form status
    try {
      // Note: In real implementation, we'd get the user token from stored providerData
      // For now, return success - the actual status check happens in handleCallback
      // which is called with the full connection object

      return {
        success: true,
        status: "linked",
        accountIds: [], // Will be populated after checking web form
        providerData: {
          // Preserve existing provider data
        },
      };
    } catch (error) {
      return {
        success: false,
        status: "rejected",
        error: error instanceof Error ? error.message : "Callback handling failed",
      };
    }
  }

  /**
   * Check web form status and get bank connection details
   */
  async checkWebFormStatus(
    webFormId: string,
    userToken: string
  ): Promise<{
    status: "pending" | "linked" | "rejected";
    bankConnectionId?: number;
    accountIds?: number[];
    error?: string;
  }> {
    const client = this.getClient();

    const webForm = await client.getWebForm(webFormId, userToken);

    switch (webForm.status) {
      case "NOT_YET_OPENED":
      case "IN_PROGRESS":
        return { status: "pending" };

      case "COMPLETED":
        if (webForm.payload?.bankConnectionId) {
          // Get accounts for the connection
          const connection = await client.getBankConnection(
            webForm.payload.bankConnectionId,
            userToken
          );
          return {
            status: "linked",
            bankConnectionId: webForm.payload.bankConnectionId,
            accountIds: connection.accountIds,
          };
        }
        return { status: "linked" };

      case "ABORTED":
      case "TIMED_OUT":
        return {
          status: "rejected",
          error: webForm.payload?.errorMessage || `Web form ${webForm.status.toLowerCase()}`,
        };

      default:
        return { status: "pending" };
    }
  }

  async getConnectionStatus(connectionId: string): Promise<{
    status: "pending" | "authorizing" | "linked" | "expired" | "rejected" | "suspended";
    accountIds?: string[];
  }> {
    // For finAPI, connectionId is the webFormId
    // Status is checked via checkWebFormStatus with proper user token
    return { status: "pending" };
  }

  async getAccounts(connectionId: string): Promise<BankingAccount[]> {
    // For finAPI, we need the user token and bank connection ID
    // This is typically called via getAccountsWithToken
    throw new BankingError(
      "Use getAccountsWithToken for finAPI provider",
      "finapi",
      "USE_TOKEN_METHOD"
    );
  }

  /**
   * Get accounts with user token
   */
  async getAccountsWithToken(
    userToken: string,
    bankConnectionId: number
  ): Promise<BankingAccount[]> {
    const client = this.getClient();

    const response = await client.getAccounts(userToken, {
      bankConnectionIds: [bankConnectionId],
    });

    return response.accounts.map((account) => this.transformAccount(account));
  }

  /**
   * Fetch transactions
   */
  async fetchTransactions(
    options: FetchTransactionsOptions
  ): Promise<BankingTransaction[]> {
    const client = this.getClient();
    const config = options.config as FinapiBankingConfig;

    if (config.provider !== "finapi") {
      throw new BankingError(
        "Invalid config provider for finAPI",
        "finapi",
        "INVALID_CONFIG"
      );
    }

    // Refresh token if needed
    let userToken = config.userAccessToken;
    const tokenExpiry = config.tokenExpiresAt.toDate();

    if (Date.now() > tokenExpiry.getTime() - 5 * 60 * 1000) {
      // Token expires in < 5 minutes, refresh
      const tokenResponse = await client.refreshUserToken(config.userRefreshToken);
      userToken = tokenResponse.access_token;

      // Store new token in config for caller to save
      (config as FinapiBankingConfig & { _refreshedToken?: string })._refreshedToken =
        userToken;
      (config as FinapiBankingConfig & { _refreshedRefreshToken?: string })._refreshedRefreshToken =
        tokenResponse.refresh_token;
      (config as FinapiBankingConfig & { _tokenExpiresAt?: string })._tokenExpiresAt =
        new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
    }

    const accountId = parseInt(options.accountId, 10);
    const transactions = await client.getAllTransactions(userToken, {
      accountIds: [accountId],
      minBankBookingDate: options.dateFrom,
      maxBankBookingDate: options.dateTo,
    });

    return transactions.map((tx) => this.transformTransaction(tx));
  }

  async revokeConnection(connectionId: string): Promise<void> {
    // For finAPI, we need user token to revoke
    console.log(`[finAPI] Cannot revoke connection without user token: ${connectionId}`);
  }

  /**
   * Revoke connection with user token
   */
  async revokeConnectionWithToken(
    bankConnectionId: number,
    userToken: string
  ): Promise<void> {
    const client = this.getClient();
    await client.deleteBankConnection(bankConnectionId, userToken);
  }

  /**
   * Refresh token if needed
   */
  async refreshTokenIfNeeded(config: BankingConfig): Promise<BankingConfig | null> {
    if (config.provider !== "finapi") return null;

    const finapiConfig = config as FinapiBankingConfig;
    const tokenExpiry = finapiConfig.tokenExpiresAt.toDate();

    // Refresh if token expires in < 5 minutes
    if (Date.now() > tokenExpiry.getTime() - 5 * 60 * 1000) {
      const client = this.getClient();
      const tokenResponse = await client.refreshUserToken(finapiConfig.userRefreshToken);

      return {
        ...finapiConfig,
        userAccessToken: tokenResponse.access_token,
        userRefreshToken: tokenResponse.refresh_token || finapiConfig.userRefreshToken,
        tokenExpiresAt: Timestamp.fromDate(
          new Date(Date.now() + tokenResponse.expires_in * 1000)
        ),
      };
    }

    return null;
  }

  // =========================================
  // Private Helpers
  // =========================================

  private transformInstitution(bank: FinapiBank): BankingInstitution {
    return {
      id: String(bank.id),
      name: bank.name,
      bic: bank.bic,
      logoUrl: bank.logo?.url,
      countries: bank.location ? [bank.location] : [...FINAPI_COUNTRIES],
      maxHistoryDays: 365, // finAPI typically supports 1 year
      providerId: "finapi",
    };
  }

  private transformAccount(account: FinapiAccount): BankingAccount {
    return {
      id: String(account.id),
      iban: account.iban,
      accountNumber: account.accountNumber,
      ownerName: account.accountHolderName || account.accountName,
      currency: account.accountCurrency || "EUR",
      type: this.mapAccountType(account.accountType),
      status: "active",
      providerId: "finapi",
    };
  }

  private transformTransaction(tx: FinapiTransaction): BankingTransaction {
    return {
      id: String(tx.id),
      bookingDate: tx.bankBookingDate,
      valueDate: tx.valueDate,
      amount: tx.amount, // finAPI uses same convention as our system
      currency: tx.currency || "EUR",
      counterpartyName: tx.counterpartName,
      counterpartyIban: tx.counterpartIban,
      description: tx.purpose,
      reference: tx.endToEndReference || tx.mandateReference,
      bankTransactionCode: tx.type,
      rawData: tx as unknown as Record<string, unknown>,
    };
  }

  private mapAccountType(
    type: string
  ): "checking" | "savings" | "credit_card" | "other" {
    switch (type) {
      case "Checking":
        return "checking";
      case "Savings":
        return "savings";
      case "CreditCard":
        return "credit_card";
      default:
        return "other";
    }
  }

  private generatePassword(userId: string): string {
    // Generate a deterministic password for finAPI user
    // This allows us to recreate the password for existing users
    const secret = process.env.FINAPI_USER_PASSWORD_SECRET || "fibuki-finapi-default-secret";

    // Simple deterministic hash-like function
    // Combines secret + userId to create reproducible password
    const combined = `${secret}:${userId}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    // Convert to base64-like string with special chars for password requirements
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let password = "";
    let seed = Math.abs(hash);
    for (let i = 0; i < 20; i++) {
      password += chars.charAt(seed % chars.length);
      seed = Math.floor(seed / chars.length) + combined.charCodeAt(i % combined.length);
    }

    // Ensure password requirements (add special chars and numbers)
    return password + "Aa1!";
  }
}

// =========================================
// Singleton Export
// =========================================

let finapiProvider: FinapiProvider | null = null;

export function getFinapiProvider(): FinapiProvider {
  if (!finapiProvider) {
    finapiProvider = new FinapiProvider();
  }
  return finapiProvider;
}
