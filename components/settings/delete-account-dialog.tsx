"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/components/auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/config";

const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ScheduleResponse {
  success: boolean;
  scheduledDeletionDate: string;
  gracePeriodDays: number;
}

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: DeleteAccountDialogProps) {
  const { user } = useAuth();
  const [confirmationInput, setConfirmationInput] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ScheduleResponse | null>(null);

  const isConfirmed = confirmationInput === CONFIRMATION_PHRASE;

  const handleClose = () => {
    if (isScheduling) return;
    setConfirmationInput("");
    setError(null);
    setSuccess(null);
    onOpenChange(false);
  };

  const handleSchedule = async () => {
    if (!isConfirmed || !user) return;

    setIsScheduling(true);
    setError(null);

    try {
      const scheduleDeletion = httpsCallable<
        { confirmationPhrase: string },
        ScheduleResponse
      >(functions, "scheduleAccountDeletion");

      const result = await scheduleDeletion({ confirmationPhrase: CONFIRMATION_PHRASE });
      setSuccess(result.data);
    } catch (err) {
      console.error("Error scheduling deletion:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (errorMessage.includes("invalid-argument")) {
        setError("Invalid confirmation phrase. Please type exactly: DELETE MY ACCOUNT");
      } else if (errorMessage.includes("already-exists")) {
        setError("Account deletion is already scheduled.");
        // Close after a moment so user sees the pending status
        setTimeout(handleClose, 2000);
      } else if (errorMessage.includes("unauthenticated")) {
        setError("You must be signed in to delete your account.");
      } else {
        setError("Failed to schedule deletion. Please try again or contact support.");
      }
    } finally {
      setIsScheduling(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
    }).format(new Date(dateString));
  };

  // Success state
  if (success) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Deletion Scheduled
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Your account is scheduled for deletion on{" "}
                <strong>{formatDate(success.scheduledDeletionDate)}</strong>.
              </AlertDescription>
            </Alert>

            <p className="text-sm text-muted-foreground">
              You have {success.gracePeriodDays} days to change your mind. During this time:
            </p>

            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li>• You can continue using your account normally</li>
              <li>• You can cancel the deletion at any time in Settings</li>
              <li>• After {success.gracePeriodDays} days, all data will be permanently deleted</li>
            </ul>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Confirmation state
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Your Account
          </DialogTitle>
          <DialogDescription>
            Your account will be scheduled for deletion with a 30-day grace period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              After 30 days, all your data will be permanently deleted:
            </AlertDescription>
          </Alert>

          <ul className="text-sm text-muted-foreground space-y-1 ml-4">
            <li>• Bank accounts and all transactions</li>
            <li>• Files, receipts, and attachments</li>
            <li>• Gmail connections (OAuth tokens revoked)</li>
            <li>• Partners and categories</li>
            <li>• All usage history and settings</li>
          </ul>

          <p className="text-sm text-muted-foreground">
            You can cancel the deletion anytime during the 30-day period.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="confirmation">
              Type <span className="font-mono font-bold">{CONFIRMATION_PHRASE}</span> to confirm:
            </Label>
            <Input
              id="confirmation"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={CONFIRMATION_PHRASE}
              disabled={isScheduling}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isScheduling}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSchedule}
            disabled={!isConfirmed || isScheduling}
          >
            {isScheduling ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scheduling...
              </>
            ) : (
              "Schedule Deletion"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
