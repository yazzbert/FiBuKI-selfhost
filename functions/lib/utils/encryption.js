"use strict";
/**
 * AES-256-GCM encryption utilities for sensitive credentials
 *
 * Used for encrypting user passwords/PINs that need to be stored
 * and later retrieved (unlike hashing).
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
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.generateEncryptionKey = generateEncryptionKey;
exports.sha256 = sha256;
const crypto = __importStar(require("crypto"));
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
/**
 * Encrypt a plaintext string using AES-256-GCM
 *
 * @param plaintext - The text to encrypt
 * @param key - 32-byte encryption key (hex string, 64 chars)
 * @returns Object with encrypted data and IV
 */
function encrypt(plaintext, key) {
    // Validate key length (should be 32 bytes = 64 hex chars)
    if (key.length !== 64) {
        throw new Error("Encryption key must be 64 hex characters (32 bytes)");
    }
    const keyBuffer = Buffer.from(key, "hex");
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    // Append auth tag to encrypted data
    const authTag = cipher.getAuthTag();
    encrypted += authTag.toString("hex");
    return {
        encrypted,
        iv: iv.toString("hex"),
    };
}
/**
 * Decrypt an encrypted string using AES-256-GCM
 *
 * @param encrypted - The encrypted hex string (includes auth tag)
 * @param iv - The initialization vector (hex string)
 * @param key - 32-byte encryption key (hex string, 64 chars)
 * @returns The decrypted plaintext
 */
function decrypt(encrypted, iv, key) {
    // Validate key length
    if (key.length !== 64) {
        throw new Error("Encryption key must be 64 hex characters (32 bytes)");
    }
    const keyBuffer = Buffer.from(key, "hex");
    const ivBuffer = Buffer.from(iv, "hex");
    // Extract auth tag from end of encrypted data (16 bytes = 32 hex chars)
    const authTagHex = encrypted.slice(-AUTH_TAG_LENGTH * 2);
    const encryptedData = encrypted.slice(0, -AUTH_TAG_LENGTH * 2);
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, ivBuffer);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
/**
 * Generate a new random 256-bit encryption key
 *
 * Use this to generate a new key for Firebase secrets:
 * firebase functions:secrets:set FINANZONLINE_ENCRYPTION_KEY
 *
 * @returns A 64-character hex string (32 bytes)
 */
function generateEncryptionKey() {
    return crypto.randomBytes(32).toString("hex");
}
/**
 * Hash a string using SHA-256
 *
 * @param data - The data to hash
 * @returns The hex-encoded hash
 */
function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}
//# sourceMappingURL=encryption.js.map