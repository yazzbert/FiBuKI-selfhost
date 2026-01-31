/**
 * FinanzOnline SOAP WebService Client
 *
 * Handles communication with Austrian tax authority (BMF) for:
 * - Session authentication (login/logout)
 * - File upload (UVA submission)
 *
 * Documentation:
 * - Session WebService: https://www.bmf.gv.at/dam/jcr:570753b2-d511-4194-a03e-33f0ac7371ec/BMF_Session_Webservice_2.pdf
 * - File Upload: https://www.bmf.gv.at/dam/jcr:7f3258d4-5d58-455d-9bfe-a352a4effd73/BMF_File_Upload_Webservice_2.pdf
 */

import * as soap from "soap";

// ============================================================================
// Constants
// ============================================================================

const SESSION_WSDL =
  "https://finanzonline.bmf.gv.at/fonws/ws/sessionService.wsdl";
const FILEUPLOAD_WSDL =
  "https://finanzonline.bmf.gv.at/fonws/ws/fileUploadService.wsdl";

// Manufacturer ID for FiBuKI (your VAT ID or a registered ID)
// This identifies your software to FinanzOnline
// TODO: Register with BMF to get an official Hersteller-ID if needed
const HERSTELLER_ID = "ATU00000000"; // Placeholder - replace with actual

// ============================================================================
// Types
// ============================================================================

export interface LoginParams {
  /** Teilnehmer-ID (participant ID, 6-12 chars) */
  teilnehmerId: string;
  /** Benutzer-ID (WebService user ID) */
  benutzerId: string;
  /** User PIN/password */
  pin: string;
}

export interface SessionLoginResult {
  /** Session ID for subsequent calls */
  sessionId: string;
  /** Return code (0 = success) */
  returnCode: number;
  /** Error/info message */
  message?: string;
}

export interface FileUploadParams {
  /** Session ID from login */
  sessionId: string;
  /** Teilnehmer-ID */
  teilnehmerId: string;
  /** Benutzer-ID */
  benutzerId: string;
  /** Declaration type (e.g., "U30" for UVA) */
  art: string;
  /** 'P' for Production, 'T' for Test */
  uebermittlung: "P" | "T";
  /** XML content to submit */
  xmlData: string;
}

export interface FileUploadResult {
  /** Return code (0 = success) */
  returnCode: number;
  /** Response message */
  message: string;
  /** Reference number (Eingangsnummer) on success */
  referenceNumber?: string;
}

// ============================================================================
// SOAP Client Functions
// ============================================================================

/**
 * Login to FinanzOnline Session WebService
 *
 * @param params Login credentials
 * @returns Session ID and result info
 */
export async function sessionLogin(
  params: LoginParams
): Promise<SessionLoginResult> {
  const { teilnehmerId, benutzerId, pin } = params;

  console.log(
    `[FinanzOnline] Attempting login for Teilnehmer ${teilnehmerId}, Benutzer ${benutzerId}`
  );

  try {
    const client = await soap.createClientAsync(SESSION_WSDL);

    // Build login request
    const loginArgs = {
      tid: teilnehmerId,
      benid: benutzerId,
      pin: pin,
      herstellerid: HERSTELLER_ID,
    };

    // Call login operation
    const [result] = await client.loginAsync(loginArgs);

    const returnCode = parseInt(result.rc || result.returncode || "0", 10);
    const sessionId = result.id || result.sessionid || "";
    const message = result.msg || result.message || "";

    console.log(
      `[FinanzOnline] Login result: rc=${returnCode}, hasSession=${!!sessionId}`
    );

    if (returnCode !== 0 && !sessionId) {
      throw new Error(`Login failed: ${message || `Return code ${returnCode}`}`);
    }

    return {
      sessionId,
      returnCode,
      message,
    };
  } catch (error) {
    console.error("[FinanzOnline] Login error:", error);

    if (error instanceof Error) {
      // Parse SOAP fault if present
      if (error.message.includes("SOAP")) {
        throw new Error(`FinanzOnline login failed: ${error.message}`);
      }
      throw error;
    }

    throw new Error("FinanzOnline login failed: Unknown error");
  }
}

/**
 * Logout from FinanzOnline Session WebService
 *
 * @param sessionId Session ID to invalidate
 * @param teilnehmerId Participant ID
 * @param benutzerId User ID
 */
export async function sessionLogout(
  sessionId: string,
  teilnehmerId: string,
  benutzerId: string
): Promise<void> {
  if (!sessionId) {
    console.log("[FinanzOnline] No session to logout");
    return;
  }

  console.log(`[FinanzOnline] Logging out session`);

  try {
    const client = await soap.createClientAsync(SESSION_WSDL);

    const logoutArgs = {
      tid: teilnehmerId,
      benid: benutzerId,
      id: sessionId,
    };

    await client.logoutAsync(logoutArgs);
    console.log("[FinanzOnline] Logout successful");
  } catch (error) {
    // Log but don't throw - logout errors are non-critical
    console.error("[FinanzOnline] Logout error (non-critical):", error);
  }
}

/**
 * Upload a file (XML declaration) to FinanzOnline
 *
 * @param params Upload parameters including session and XML data
 * @returns Upload result with reference number on success
 */
export async function uploadFile(
  params: FileUploadParams
): Promise<FileUploadResult> {
  const { sessionId, teilnehmerId, benutzerId, art, uebermittlung, xmlData } =
    params;

  console.log(
    `[FinanzOnline] Uploading ${art} declaration (mode: ${uebermittlung})`
  );

  try {
    const client = await soap.createClientAsync(FILEUPLOAD_WSDL);

    // Build upload request
    const uploadArgs = {
      tid: teilnehmerId,
      benid: benutzerId,
      id: sessionId,
      art: art,
      uebermittlung: uebermittlung,
      data: xmlData,
    };

    // Call upload operation
    const [result] = await client.uploadAsync(uploadArgs);

    const returnCode = parseInt(result.rc || result.returncode || "0", 10);
    const message = result.msg || result.message || "";
    const referenceNumber = result.refnr || result.eingangsnr || "";

    console.log(
      `[FinanzOnline] Upload result: rc=${returnCode}, ref=${referenceNumber || "none"}`
    );

    return {
      returnCode,
      message,
      referenceNumber: referenceNumber || undefined,
    };
  } catch (error) {
    console.error("[FinanzOnline] Upload error:", error);

    if (error instanceof Error) {
      if (error.message.includes("SOAP")) {
        throw new Error(`FinanzOnline upload failed: ${error.message}`);
      }
      throw error;
    }

    throw new Error("FinanzOnline upload failed: Unknown error");
  }
}

/**
 * Test FinanzOnline connection by attempting login and immediate logout
 *
 * @param params Login credentials to test
 * @returns True if credentials are valid
 */
export async function testConnection(
  params: LoginParams
): Promise<{ success: boolean; error?: string }> {
  let sessionId: string | null = null;

  try {
    // Attempt login
    const loginResult = await sessionLogin(params);

    if (loginResult.returnCode !== 0 || !loginResult.sessionId) {
      return {
        success: false,
        error: loginResult.message || `Return code: ${loginResult.returnCode}`,
      };
    }

    sessionId = loginResult.sessionId;

    // Login successful - logout immediately
    await sessionLogout(sessionId, params.teilnehmerId, params.benutzerId);

    return { success: true };
  } catch (error) {
    // Ensure cleanup
    if (sessionId) {
      await sessionLogout(
        sessionId,
        params.teilnehmerId,
        params.benutzerId
      ).catch(() => {});
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Return Code Reference
// ============================================================================

/**
 * Common FinanzOnline return codes:
 *
 * 0    - Success
 * -1   - General error
 * -2   - Invalid credentials
 * -3   - Session expired
 * -4   - Permission denied
 * -5   - Invalid data format
 * -6   - Service unavailable
 *
 * For detailed codes, see BMF documentation.
 */
export const RETURN_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: -1,
  INVALID_CREDENTIALS: -2,
  SESSION_EXPIRED: -3,
  PERMISSION_DENIED: -4,
  INVALID_FORMAT: -5,
  SERVICE_UNAVAILABLE: -6,
} as const;

/**
 * Check if a return code indicates success
 */
export function isSuccess(returnCode: number): boolean {
  return returnCode === 0;
}

/**
 * Get human-readable error message for return code
 */
export function getErrorMessage(returnCode: number): string {
  switch (returnCode) {
    case 0:
      return "Success";
    case -1:
      return "General error";
    case -2:
      return "Invalid credentials - please check Teilnehmer-ID, Benutzer-ID, and PIN";
    case -3:
      return "Session expired - please try again";
    case -4:
      return "Permission denied - WebService user may not have required permissions";
    case -5:
      return "Invalid data format - XML validation failed";
    case -6:
      return "FinanzOnline service unavailable - please try again later";
    default:
      return `Unknown error (code: ${returnCode})`;
  }
}
