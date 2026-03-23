import { createCallable, HttpsError } from "../utils/createCallable";
import { sendInviteEmail } from "./sendInviteEmail";

interface SendInviteNotificationRequest {
  email: string;
}

interface SendInviteNotificationResponse {
  success: boolean;
}

export const sendInviteNotificationCallable = createCallable<
  SendInviteNotificationRequest,
  SendInviteNotificationResponse
>(
  { name: "sendInviteNotification" },
  async (ctx, request) => {
    // Admin only
    if (!ctx.request.auth?.token.admin) {
      throw new HttpsError("permission-denied", "Admin only");
    }

    const { email } = request;

    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "email is required");
    }

    await sendInviteEmail(email.toLowerCase().trim());

    return { success: true };
  }
);
