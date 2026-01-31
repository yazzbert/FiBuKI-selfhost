/**
 * Plaid API Client
 *
 * Wraps the Plaid API for use in this application.
 * Uses /transactions/sync for cursor-based incremental updates.
 */

// Environment URLs
const PLAID_ENVIRONMENTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
} as const;

export type PlaidEnvironment = keyof typeof PLAID_ENVIRONMENTS;

export interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
}

// =========================================
// RESPONSE TYPES
// =========================================

export interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

export interface PlaidExchangeResponse {
  access_token: string;
  item_id: string;
  request_id: string;
}

export interface PlaidInstitution {
  institution_id: string;
  name: string;
  products: string[];
  country_codes: string[];
  url?: string;
  logo?: string;
  primary_color?: string;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string;
  type: "depository" | "credit" | "loan" | "investment" | "other";
  subtype?: string;
  mask?: string;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code?: string;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  /** Positive = money leaving account (debit), Negative = money entering (credit) */
  amount: number;
  iso_currency_code?: string;
  date: string;
  name: string;
  merchant_name?: string;
  pending: boolean;
  payment_channel: "online" | "in store" | "other";
  personal_finance_category?: {
    primary: string;
    detailed: string;
  };
  counterparties?: Array<{
    name: string;
    type: string;
  }>;
  payment_meta?: {
    reference_number?: string;
    ppd_id?: string;
  };
}

export interface PlaidSyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: Array<{ transaction_id: string }>;
  next_cursor: string;
  has_more: boolean;
  request_id: string;
}

export interface PlaidItem {
  item_id: string;
  institution_id?: string;
  webhook?: string;
  error?: {
    error_code: string;
    error_message: string;
  };
  consent_expiration_time?: string;
}

export interface PlaidError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message?: string;
  request_id: string;
}

// =========================================
// CLIENT CLASS
// =========================================

export class PlaidClient {
  private baseUrl: string;

  constructor(private config: PlaidConfig) {
    this.baseUrl = PLAID_ENVIRONMENTS[config.environment];
  }

  private async request<T>(
    path: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PLAID-CLIENT-ID": this.config.clientId,
        "PLAID-SECRET": this.config.secret,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data as PlaidError;
      throw new Error(
        error.display_message ||
          error.error_message ||
          `Plaid API error: ${response.status}`
      );
    }

    return data as T;
  }

  /**
   * Create a link token for Plaid Link initialization
   */
  async createLinkToken(options: {
    userId: string;
    countryCodes: string[];
    language?: string;
    redirectUri?: string;
    products?: string[];
  }): Promise<PlaidLinkTokenResponse> {
    return this.request("/link/token/create", {
      client_name: "FiBuKI",
      user: { client_user_id: options.userId },
      products: options.products || ["transactions"],
      country_codes: options.countryCodes,
      language: options.language || "en",
      ...(options.redirectUri && { redirect_uri: options.redirectUri }),
    });
  }

  /**
   * Exchange public_token from Plaid Link for access_token
   */
  async exchangePublicToken(publicToken: string): Promise<PlaidExchangeResponse> {
    return this.request("/item/public_token/exchange", {
      public_token: publicToken,
    });
  }

  /**
   * Get item info (connection status)
   */
  async getItem(accessToken: string): Promise<{ item: PlaidItem }> {
    return this.request("/item/get", { access_token: accessToken });
  }

  /**
   * Get accounts for an item
   */
  async getAccounts(accessToken: string): Promise<{ accounts: PlaidAccount[] }> {
    return this.request("/accounts/get", { access_token: accessToken });
  }

  /**
   * Get institution by ID
   */
  async getInstitution(
    institutionId: string,
    countryCodes: string[]
  ): Promise<{ institution: PlaidInstitution }> {
    return this.request("/institutions/get_by_id", {
      institution_id: institutionId,
      country_codes: countryCodes,
      options: { include_optional_metadata: true },
    });
  }

  /**
   * Search institutions by name
   */
  async searchInstitutions(
    query: string,
    countryCodes: string[]
  ): Promise<{ institutions: PlaidInstitution[] }> {
    return this.request("/institutions/search", {
      query,
      country_codes: countryCodes,
      products: ["transactions"],
      options: { include_optional_metadata: true },
    });
  }

  /**
   * Get institutions for countries
   */
  async getInstitutions(
    countryCodes: string[],
    count = 100,
    offset = 0
  ): Promise<{ institutions: PlaidInstitution[]; total: number }> {
    return this.request("/institutions/get", {
      count,
      offset,
      country_codes: countryCodes,
      options: {
        include_optional_metadata: true,
        products: ["transactions"],
      },
    });
  }

  /**
   * Sync transactions using cursor-based pagination
   * This is the recommended method for incremental updates
   */
  async syncTransactions(
    accessToken: string,
    cursor?: string
  ): Promise<PlaidSyncResponse> {
    const body: Record<string, unknown> = { access_token: accessToken };
    if (cursor) {
      body.cursor = cursor;
    }
    return this.request("/transactions/sync", body);
  }

  /**
   * Remove an item (revoke access)
   */
  async removeItem(accessToken: string): Promise<{ request_id: string }> {
    return this.request("/item/remove", { access_token: accessToken });
  }

  /**
   * Create a sandbox public token for testing
   * Only works in sandbox environment
   */
  async createSandboxPublicToken(
    institutionId: string,
    initialProducts: string[] = ["transactions"]
  ): Promise<{ public_token: string }> {
    return this.request("/sandbox/public_token/create", {
      institution_id: institutionId,
      initial_products: initialProducts,
    });
  }
}
