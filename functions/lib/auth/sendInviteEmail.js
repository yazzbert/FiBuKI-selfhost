"use strict";
/**
 * Send invite notification email via SendGrid.
 * Follows the same pattern as sendUsageWarning.ts.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendInviteEmail = sendInviteEmail;
const inviteEmail_1 = require("./inviteEmail");
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = "noreply@fibuki.com";
const FROM_NAME = "FiBuKI";
async function sendInviteEmail(email) {
    if (!email) {
        console.warn("[InviteEmail] No email provided");
        return;
    }
    if (!SENDGRID_API_KEY) {
        console.warn("[InviteEmail] SENDGRID_API_KEY not configured, skipping email");
        return;
    }
    const sgMail = (await Promise.resolve().then(() => __importStar(require("@sendgrid/mail")))).default;
    sgMail.setApiKey(SENDGRID_API_KEY);
    await sgMail.send({
        to: email,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject: (0, inviteEmail_1.buildInviteSubject)(),
        text: (0, inviteEmail_1.buildInviteText)(),
        html: (0, inviteEmail_1.buildInviteHtml)(),
    });
    console.log(`[InviteEmail] Sent invite to ${email}`);
}
//# sourceMappingURL=sendInviteEmail.js.map