"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendInviteNotificationCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const sendInviteEmail_1 = require("./sendInviteEmail");
exports.sendInviteNotificationCallable = (0, createCallable_1.createCallable)({ name: "sendInviteNotification" }, async (ctx, request) => {
    // Admin only
    if (!ctx.request.auth?.token.admin) {
        throw new createCallable_1.HttpsError("permission-denied", "Admin only");
    }
    const { email } = request;
    if (!email || typeof email !== "string") {
        throw new createCallable_1.HttpsError("invalid-argument", "email is required");
    }
    await (0, sendInviteEmail_1.sendInviteEmail)(email.toLowerCase().trim());
    return { success: true };
});
//# sourceMappingURL=sendInviteNotificationCallable.js.map