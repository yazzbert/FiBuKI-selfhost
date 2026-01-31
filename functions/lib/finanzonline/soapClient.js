"use strict";
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
exports.RETURN_CODES = void 0;
exports.sessionLogin = sessionLogin;
exports.sessionLogout = sessionLogout;
exports.uploadFile = uploadFile;
exports.testConnection = testConnection;
exports.isSuccess = isSuccess;
exports.getErrorMessage = getErrorMessage;
const soap = __importStar(require("soap"));
// ============================================================================
// Constants
// ============================================================================
const SESSION_WSDL = "https://finanzonline.bmf.gv.at/fonws/ws/sessionService.wsdl";
const FILEUPLOAD_WSDL = "https://finanzonline.bmf.gv.at/fonws/ws/fileUploadService.wsdl";
// Manufacturer ID for FiBuKI (your VAT ID or a registered ID)
// This identifies your software to FinanzOnline
// TODO: Register with BMF to get an official Hersteller-ID if needed
const HERSTELLER_ID = "ATU00000000"; // Placeholder - replace with actual
// ============================================================================
// SOAP Client Functions
// ============================================================================
/**
 * Login to FinanzOnline Session WebService
 *
 * @param params Login credentials
 * @returns Session ID and result info
 */
async function sessionLogin(params) {
    const { teilnehmerId, benutzerId, pin } = params;
    console.log(`[FinanzOnline] Attempting login for Teilnehmer ${teilnehmerId}, Benutzer ${benutzerId}`);
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
        console.log(`[FinanzOnline] Login result: rc=${returnCode}, hasSession=${!!sessionId}`);
        if (returnCode !== 0 && !sessionId) {
            throw new Error(`Login failed: ${message || `Return code ${returnCode}`}`);
        }
        return {
            sessionId,
            returnCode,
            message,
        };
    }
    catch (error) {
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
async function sessionLogout(sessionId, teilnehmerId, benutzerId) {
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
    }
    catch (error) {
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
async function uploadFile(params) {
    const { sessionId, teilnehmerId, benutzerId, art, uebermittlung, xmlData } = params;
    console.log(`[FinanzOnline] Uploading ${art} declaration (mode: ${uebermittlung})`);
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
        console.log(`[FinanzOnline] Upload result: rc=${returnCode}, ref=${referenceNumber || "none"}`);
        return {
            returnCode,
            message,
            referenceNumber: referenceNumber || undefined,
        };
    }
    catch (error) {
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
async function testConnection(params) {
    let sessionId = null;
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
    }
    catch (error) {
        // Ensure cleanup
        if (sessionId) {
            await sessionLogout(sessionId, params.teilnehmerId, params.benutzerId).catch(() => { });
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
exports.RETURN_CODES = {
    SUCCESS: 0,
    GENERAL_ERROR: -1,
    INVALID_CREDENTIALS: -2,
    SESSION_EXPIRED: -3,
    PERMISSION_DENIED: -4,
    INVALID_FORMAT: -5,
    SERVICE_UNAVAILABLE: -6,
};
/**
 * Check if a return code indicates success
 */
function isSuccess(returnCode) {
    return returnCode === 0;
}
/**
 * Get human-readable error message for return code
 */
function getErrorMessage(returnCode) {
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
//# sourceMappingURL=soapClient.js.map