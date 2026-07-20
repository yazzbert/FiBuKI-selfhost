/**
 * Drop-in for `firebase-admin/auth` in the self-host build. Single-user
 * deployment: identity comes from the OIDC front (Authentik) later; for the
 * spike, user lookups return a synthetic record.
 */

export interface UserRecord {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  disabled: boolean;
  customClaims: Record<string, unknown>;
  metadata: { creationTime: string; lastSignInTime: string };
}

function syntheticUser(uid: string): UserRecord {
  return {
    uid,
    email: `${uid}@selfhost.local`,
    emailVerified: true,
    displayName: "Selfhost User",
    disabled: false,
    customClaims: {},
    metadata: {
      creationTime: new Date(0).toISOString(),
      lastSignInTime: new Date().toISOString(),
    },
  };
}

class AuthShim {
  async getUser(uid: string): Promise<UserRecord> {
    return syntheticUser(uid);
  }
  async getUserByEmail(email: string): Promise<UserRecord> {
    return syntheticUser(email.split("@")[0]);
  }
  async verifyIdToken(_token: string): Promise<{ uid: string }> {
    throw new Error("selfhost auth shim: verifyIdToken handled by OIDC layer, not implemented in spike");
  }
  async setCustomUserClaims(_uid: string, _claims: Record<string, unknown>): Promise<void> {}
  async listUsers(): Promise<{ users: UserRecord[] }> {
    return { users: [] };
  }
  async deleteUser(_uid: string): Promise<void> {}
}

const singleton = new AuthShim();

export function getAuth(): AuthShim {
  return singleton;
}
