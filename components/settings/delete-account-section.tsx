"use client";

import { useState, useEffect } from "react";
import { Trash2, AlertTriangle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { useAuth } from "@/components/auth";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { db, functions } from "@/lib/firebase/config";

interface PendingDeletion {
  pendingDeletion: boolean;
  scheduledDeletionDate: { toDate: () => Date };
}

export function DeleteAccountSection() {
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Listen for pending deletion status
  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (doc) => {
        const data = doc.data() as PendingDeletion | undefined;
        if (data?.pendingDeletion && data?.scheduledDeletionDate) {
          setPendingDeletion(data);
        } else {
          setPendingDeletion(null);
        }
      },
      (error) => {
        console.error("Error fetching user data:", error);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const handleCancelDeletion = async () => {
    setIsCancelling(true);
    setCancelError(null);

    try {
      const cancelDeletion = httpsCallable<
        Record<string, never>,
        { success: boolean; message: string }
      >(functions, "cancelAccountDeletion");

      await cancelDeletion({});
      setPendingDeletion(null);
    } catch (err) {
      console.error("Error cancelling deletion:", err);
      setCancelError("Failed to cancel deletion. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(date);
  };

  const getDaysRemaining = (date: Date) => {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  // Show pending deletion status
  if (pendingDeletion) {
    const deletionDate = pendingDeletion.scheduledDeletionDate.toDate();
    const daysRemaining = getDaysRemaining(deletionDate);

    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Account Scheduled for Deletion
          </CardTitle>
          <CardDescription>
            Your account will be permanently deleted on {formatDate(deletionDate)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {daysRemaining > 0 ? (
                <>
                  You have <strong>{daysRemaining} days</strong> to cancel this request.
                  After that, all your data will be permanently deleted.
                </>
              ) : (
                <>Your account will be deleted within the next 24 hours.</>
              )}
            </AlertDescription>
          </Alert>

          {cancelError && (
            <Alert variant="destructive">
              <AlertDescription>{cancelError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Changed your mind?</p>
              <p className="text-sm text-muted-foreground">
                Cancel the deletion to keep your account and all data
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleCancelDeletion}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Cancel Deletion"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Normal state - show delete button
  return (
    <>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that permanently affect your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Delete Account</p>
              <p className="text-sm text-muted-foreground">
                Schedule account deletion with a 30-day grace period
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      <DeleteAccountDialog
        open={showDialog}
        onOpenChange={setShowDialog}
      />
    </>
  );
}
