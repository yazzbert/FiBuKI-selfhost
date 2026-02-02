/**
 * AES-256-GCM encryption utilities for sensitive credentials
 *
 * Used for encrypting OAuth refresh tokens that need to be stored
 * and later retrieved for token refresh operations.
 *
 * Note: This is a copy of functions/src/utils/encryption.ts for use
 * in Next.js API routes. Keep both in sync if changes are needed.
 */

import * as crypto from "crypto";

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
export function encrypt(
  plaintext: string,
  key: string
): { encrypted: string; iv: string } {
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
export function decrypt(encrypted: string, iv: string, key: string): string {
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
 * Get the encryption key from environment variable
 * Throws if not configured
 */
export function getEncryptionKey(): string {
  const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY environment variable is not set"
    );
  }
  if (key.length !== 64) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"
    );
  }
  return key;
}
