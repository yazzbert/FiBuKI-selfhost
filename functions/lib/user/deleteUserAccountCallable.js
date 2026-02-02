"use strict";
/**
 * Complete account deletion callable.
 *
 * Deletes all user data across all collections, revokes OAuth tokens,
 * and deletes the Firebase Auth user.
 *
 * This is an irreversible operation.
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
exports.deleteUserAccountCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const auth_1 = require("firebase-admin/auth");
const storage_1 = require("firebase-admin/storage");
const firestore_1 = require("firebase-admin/firestore");
const crypto = __importStar(require("crypto"));
const BATCH_SIZE = 500;
// Google OAuth revoke endpoint
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/**
 * Delete all documents in a collection for a user
 */
async function deleteCollection(db, collectionName, userId) {
    let deleted = 0;
    while (true) {
        const snapshot = await db
            .collection(collectionName)
            .where("userId", "==", userId)
            .limit(BATCH_SIZE)
            .get();
        if (snapshot.empty)
            break;
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        deleted += snapshot.size;
    }
    return deleted;
}
/**
 * Delete a single document by ID
 */
async function deleteDocById(db, collection, docId) {
    const doc = await db.collection(collection).doc(docId).get();
    if (doc.exists) {
        await doc.ref.delete();
        return true;
    }
    return false;
}
/**
 * Delete all documents in a subcollection
 */
async function deleteSubcollection(db, path) {
    let deleted = 0;
    while (true) {
        const snapshot = await db.collection(path).limit(BATCH_SIZE).get();
        if (snapshot.empty)
            break;
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        deleted += snapshot.size;
    }
    return deleted;
}
/**
 * Anonymize records instead of deleting (for analytics/compliance)
 */
async function anonymizeCollection(db, collectionName, userId, anonymizedId) {
    let anonymized = 0;
    while (true) {
        const snapshot = await db
            .collection(collectionName)
            .where("userId", "==", userId)
            .limit(BATCH_SIZE)
            .get();
        if (snapshot.empty)
            break;
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.update(doc.ref, {
                userId: anonymizedId,
                anonymizedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        anonymized += snapshot.size;
    }
    return anonymized;
}
/**
 * Delete all files in a storage folder
 */
async function deleteStorageFolder(storage, folderPath) {
    const bucket = storage.bucket();
    let deleted = 0;
    try {
        const [files] = await bucket.getFiles({ prefix: folderPath });
        for (const file of files) {
            try {
                await file.delete();
                deleted++;
            }
            catch (err) {
                console.error(`[DeleteAccount] Failed to delete file ${file.name}:`, err);
            }
        }
    }
    catch (err) {
        console.error(`[DeleteAccount] Failed to list files in ${folderPath}:`, err);
    }
    return deleted;
}
/**
 * Revoke Gmail OAuth tokens
 */
async function revokeGmailTokens(db, userId) {
    let revoked = 0;
    // Get all email integrations for this user
    const integrations = await db
        .collection("emailIntegrations")
        .where("userId", "==", userId)
        .get();
    for (const integrationDoc of integrations.docs) {
        const integrationId = integrationDoc.id;
        // Get the token document
        const tokenDoc = await db.collection("emailTokens").doc(integrationId).get();
        if (!tokenDoc.exists)
            continue;
        const tokenData = tokenDoc.data();
        const accessToken = tokenData?.accessToken;
        if (accessToken) {
            try {
                // Revoke the access token (this also invalidates the refresh token)
                const response = await fetch(GOOGLE_REVOKE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ token: accessToken }),
                });
                if (response.ok) {
                    console.log(`[DeleteAccount] Revoked OAuth token for integration ${integrationId}`);
                    revoked++;
                }
                else {
                    const errorText = await response.text();
                    console.error(`[DeleteAccount] Failed to revoke token: ${errorText}`);
                }
            }
            catch (err) {
                console.error(`[DeleteAccount] Error revoking token:`, err);
            }
        }
        // Delete the token document
        await tokenDoc.ref.delete();
    }
    return revoked;
}
exports.deleteUserAccountCallable = (0, createCallable_1.createCallable)({
    name: "deleteUserAccount",
    memory: "1GiB",
    timeoutSeconds: 540, // 9 minutes for large accounts
}, async (ctx, request) => {
    const { confirmationPhrase } = request;
    // Require exact confirmation phrase
    if (confirmationPhrase !== "DELETE MY ACCOUNT") {
        throw new createCallable_1.HttpsError("invalid-argument", "Invalid confirmation phrase. Please type 'DELETE MY ACCOUNT' exactly.");
    }
    const { userId, db } = ctx;
    const storage = (0, storage_1.getStorage)();
    const auth = (0, auth_1.getAuth)();
    console.log(`[DeleteAccount] Starting account deletion for user ${userId}`);
    // Generate anonymized ID for analytics records
    const anonymizedId = `deleted_${crypto.createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
    const deletedCollections = [];
    let deletedStorageFiles = 0;
    let anonymizedRecords = 0;
    // === 1. Revoke OAuth tokens and delete token documents ===
    console.log("[DeleteAccount] Revoking OAuth tokens...");
    await revokeGmailTokens(db, userId);
    // === 2. Delete user data collections ===
    const collectionsToDelete = [
        "fileConnections",
        "files",
        "transactions",
        "partners",
        "categories",
        "noReceiptCategories",
        "sources",
        "emailIntegrations",
        "gmailSyncQueue",
        "gmailSyncHistory",
        "userImports",
        "userExports",
        "chatSessions",
    ];
    for (const collection of collectionsToDelete) {
        console.log(`[DeleteAccount] Deleting ${collection}...`);
        const count = await deleteCollection(db, collection, userId);
        if (count > 0) {
            console.log(`[DeleteAccount] Deleted ${count} ${collection}`);
            deletedCollections.push(collection);
        }
    }
    // === 3. Delete user subcollections ===
    console.log("[DeleteAccount] Deleting user settings and notifications...");
    await deleteSubcollection(db, `users/${userId}/notifications`);
    await deleteDocById(db, `users/${userId}/settings`, "userData");
    await db.collection("users").doc(userId).delete();
    deletedCollections.push("users");
    // === 4. Anonymize analytics records (keep for billing/usage tracking) ===
    console.log("[DeleteAccount] Anonymizing analytics records...");
    const aiUsageAnonymized = await anonymizeCollection(db, "aiUsage", userId, anonymizedId);
    const functionCallsAnonymized = await anonymizeCollection(db, "functionCalls", userId, anonymizedId);
    anonymizedRecords = aiUsageAnonymized + functionCallsAnonymized;
    console.log(`[DeleteAccount] Anonymized ${anonymizedRecords} analytics records`);
    // === 5. Delete storage files ===
    console.log("[DeleteAccount] Deleting storage files...");
    const foldersToDelete = [
        `files/${userId}/`,
        `exports/${userId}/`,
        `imports/${userId}/`,
        `thumbnails/${userId}/`,
    ];
    for (const folder of foldersToDelete) {
        const count = await deleteStorageFolder(storage, folder);
        deletedStorageFiles += count;
    }
    console.log(`[DeleteAccount] Deleted ${deletedStorageFiles} storage files`);
    // === 6. Log deletion for compliance ===
    await db.collection("accountDeletions").add({
        anonymizedUserId: anonymizedId,
        deletedAt: firestore_1.Timestamp.now(),
        deletedCollections,
        deletedStorageFiles,
        anonymizedRecords,
    });
    // === 7. Delete Firebase Auth user (MUST BE LAST) ===
    console.log("[DeleteAccount] Deleting Firebase Auth user...");
    try {
        await auth.deleteUser(userId);
        console.log(`[DeleteAccount] Deleted Firebase Auth user ${userId}`);
    }
    catch (err) {
        // Log but don't fail - user might have been deleted already
        console.error(`[DeleteAccount] Failed to delete Auth user:`, err);
    }
    console.log(`[DeleteAccount] Account deletion complete for ${anonymizedId}`);
    return {
        success: true,
        deletedCollections,
        deletedStorageFiles,
        anonymizedRecords,
    };
});
//# sourceMappingURL=deleteUserAccountCallable.js.map