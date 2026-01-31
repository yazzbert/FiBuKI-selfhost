"use client";

import { useState, useCallback } from "react";
import { Institution } from "./use-institutions";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * Connection flow steps
 */
export type ConnectionStep =
  | "select-country"
  | "select-bank"
  | "authorizing"
  | "select-accounts"
  | "creating-source"
  | "complete"
  | "error";

/**
 * Account info from requisition
 */
export interface BankAccount {
  accountId: string;
  iban: string;
  ownerName?: string;
  status: string;
}

/**
 * Connection state
 */
export interface BankConnectionState {
  step: ConnectionStep;
  selectedCountry: string | null;
  selectedInstitution: Institution | null;
  connectionId: string | null;
  authorizationUrl: string | null;
  accounts: BankAccount[];
  createdSourceId: string | null;
  /** Existing source ID when linking/reconnecting */
  linkToSourceId: string | null;
  error: string | null;
}

const initialState: BankConnectionState = {
  step: "select-country",
  selectedCountry: null,
  selectedInstitution: null,
  connectionId: null,
  authorizationUrl: null,
  accounts: [],
  createdSourceId: null,
  linkToSourceId: null,
  error: null,
};

/**
 * Hook for managing the bank connection flow
 *
 * @param sourceId - Optional existing source ID for linking/reconnecting
 */
export function useBankConnection(sourceId?: string | null) {
  const { user } = useAuth();
  const [state, setState] = useState<BankConnectionState>(() => ({
    ...initialState,
    linkToSourceId: sourceId || null,
  }));
  const [isLoading, setIsLoading] = useState(false);

  // Helper to get auth headers
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!user) return {};
    try {
      const token = await user.getIdToken();
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  }, [user]);

  /**
   * Select a country and move to bank selection
   */
  const selectCountry = useCallback((countryCode: string) => {
    setState((s) => ({
      ...s,
      step: "select-bank",
      selectedCountry: countryCode,
      error: null,
    }));
  }, []);

  /**
   * Go back to country selection
   */
  const goBackToCountry = useCallback(() => {
    setState((s) => ({
      ...s,
      step: "select-country",
      selectedCountry: null,
      selectedInstitution: null,
      error: null,
    }));
  }, []);

  /**
   * Start connection to a bank
   */
  const startConnection = useCallback(async (institution: Institution) => {
    setIsLoading(true);
    setState((s) => ({
      ...s,
      selectedInstitution: institution,
      error: null,
    }));

    try {
      const authHeaders = await getAuthHeaders();

      // Use generic banking API (routes to configured provider - finAPI)
      const response = await fetch("/api/banking/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          providerId: institution.providerId || "finapi",
          institutionId: institution.id,
          sourceId: state.linkToSourceId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start bank connection");
      }

      setState((s) => ({
        ...s,
        step: "authorizing",
        connectionId: data.connectionId,
        authorizationUrl: data.authUrl,
      }));

      // Open bank auth in new tab (user completes there, then clicks "I've completed")
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Failed to start connection",
      }));
    } finally {
      setIsLoading(false);
    }
  }, [state.linkToSourceId, getAuthHeaders]);

  /**
   * Check connection status
   */
  const checkStatus = useCallback(async (connectionId: string) => {
    setIsLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/banking/connections/${connectionId}`, {
        headers: authHeaders,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to check connection status");
      }

      // Handle different statuses
      if (data.status === "rejected") {
        setState((s) => ({
          ...s,
          connectionId,
          step: "error",
          error: data.statusMessage || "Bank connection was rejected",
        }));
      } else if (data.status === "linked") {
        setState((s) => ({
          ...s,
          connectionId,
          accounts: data.accounts || [],
          step: "select-accounts",
        }));
      } else {
        // Still pending/authorizing
        setState((s) => ({
          ...s,
          connectionId,
          step: "authorizing",
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        connectionId,
        step: "error",
        error: err instanceof Error ? err.message : "Failed to check status",
      }));
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  /**
   * Create a source from a selected account
   */
  const linkAccount = useCallback(
    async (accountId: string, name: string, connectionId?: string) => {
      const connId = connectionId || state.connectionId;
      if (!connId) {
        setState((s) => ({
          ...s,
          step: "error",
          error: "No connection ID available",
        }));
        return;
      }

      setIsLoading(true);
      setState((s) => ({ ...s, step: "creating-source" }));

      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/banking/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            connectionId: connId,
            accountId,
            name,
            sourceId: state.linkToSourceId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to create source");
        }

        setState((s) => ({
          ...s,
          step: "complete",
          createdSourceId: data.sourceId,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          step: "error",
          error: err instanceof Error ? err.message : "Failed to link account",
        }));
      } finally {
        setIsLoading(false);
      }
    },
    [state.connectionId, state.linkToSourceId, getAuthHeaders]
  );

  /**
   * Reset the connection flow
   */
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  /**
   * Clear error and go back to previous step
   */
  const clearError = useCallback(() => {
    setState((s) => ({
      ...s,
      step: s.selectedInstitution ? "select-bank" : "select-country",
      error: null,
    }));
  }, []);

  return {
    state,
    isLoading,
    selectCountry,
    goBackToCountry,
    startConnection,
    checkStatus,
    linkAccount,
    reset,
    clearError,
  };
}
