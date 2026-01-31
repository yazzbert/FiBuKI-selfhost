"use client";

/**
 * Plaid Link Button Component
 *
 * Opens the Plaid Link modal for bank authentication.
 * Handles link token fetching and token exchange automatically.
 */

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { usePlaidLink, PlaidLinkOnSuccess } from "react-plaid-link";

export interface PlaidLinkMetadata {
  institution?: {
    institution_id: string;
    name: string;
  };
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    subtype: string;
    mask: string;
  }>;
  link_session_id: string;
}

interface PlaidLinkButtonProps {
  /** Called after successful Plaid Link + token exchange */
  onSuccess: (data: {
    connectionId: string;
    itemId: string;
    accounts: Array<{
      accountId: string;
      name: string;
      officialName?: string;
      type: string;
      subtype?: string;
      mask?: string;
      currency: string;
    }>;
  }) => void;
  /** Called when user exits Plaid Link */
  onExit?: (error: Error | null) => void;
  /** Existing source ID for re-auth flow */
  sourceId?: string;
  /** Button content */
  children?: React.ReactNode;
  /** Additional button classes */
  className?: string;
  /** Button variant */
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  /** Disable the button */
  disabled?: boolean;
}

export function PlaidLinkButton({
  onSuccess,
  onExit,
  sourceId,
  children = "Connect with Plaid",
  className,
  variant = "default",
  disabled = false,
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch link token on mount
  useEffect(() => {
    let mounted = true;

    async function fetchLinkToken() {
      try {
        setIsLoading(true);
        const response = await fetch("/api/plaid/link-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to get link token");
        }

        const data = await response.json();
        if (mounted) {
          setLinkToken(data.linkToken);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to initialize Plaid");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    fetchLinkToken();

    return () => {
      mounted = false;
    };
  }, []);

  // Handle successful Plaid Link
  const handlePlaidSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      setIsExchanging(true);
      try {
        const response = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id,
            institutionName: metadata.institution?.name,
            sourceId,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Token exchange failed");
        }

        const data = await response.json();
        onSuccess(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Connection failed");
        if (onExit) {
          onExit(err instanceof Error ? err : new Error("Connection failed"));
        }
      } finally {
        setIsExchanging(false);
      }
    },
    [onSuccess, onExit, sourceId]
  );

  // Plaid Link configuration
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handlePlaidSuccess,
    onExit: (exitError) => {
      if (onExit) {
        onExit(exitError ? new Error(exitError.display_message || exitError.error_message) : null);
      }
    },
  });

  const handleClick = useCallback(() => {
    if (ready) {
      setError(null);
      open();
    }
  }, [ready, open]);

  // Error state
  if (error && !isLoading && !isExchanging) {
    return (
      <div className="space-y-2">
        <Button
          variant="destructive"
          disabled
          className={className}
        >
          {error}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setLinkToken(null);
            // Re-fetch link token
            fetch("/api/plaid/link-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            })
              .then((r) => r.json())
              .then((data) => setLinkToken(data.linkToken))
              .catch(() => setError("Failed to retry"));
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleClick}
      disabled={!ready || isLoading || isExchanging || disabled}
      variant={variant}
      className={className}
    >
      {isExchanging ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Connecting...
        </>
      ) : isLoading || !ready ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Loading...
        </>
      ) : (
        children
      )}
    </Button>
  );
}
