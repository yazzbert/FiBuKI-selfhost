/**
 * fibuki-api process entry: boots the index.ts barrel through the selfhost
 * shims and serves every mounted callable/request function.
 *
 * Must run with the module aliases active, which vite-node gets from the
 * same config the tests use:
 *
 *   npx vite-node --config vitest.selfhost.config.ts src/selfhost/server.ts
 *
 * Auth (in precedence order):
 *   1. FIBUKI_DEV_UID=<uid>  — dev bypass, accepts ANY bearer as that uid.
 *   2. OIDC_ISSUER set       — Authentik OIDC: verify id_token via JWKS
 *      (createOidcVerifier), map sub->uid, OIDC_ADMIN_GROUP -> token.admin.
 *   3. neither               — refuse to start rather than guess.
 * Never set FIBUKI_DEV_UID in production; it defeats OIDC.
 */

import { createCronHost } from "./cron-host";
import { createHost, type TokenVerifier } from "./host";
import { createOidcVerifier } from "./oidc-verifier";

function resolveVerifier(): TokenVerifier {
  const devUid = process.env.FIBUKI_DEV_UID;
  if (devUid) {
    console.warn(`fibuki-api: DEV AUTH MODE — every bearer token authenticates as "${devUid}"`);
    return async () => ({ uid: devUid, token: {} });
  }

  const issuer = process.env.OIDC_ISSUER;
  if (issuer) {
    console.log(`fibuki-api: Authentik OIDC verification against issuer ${issuer}`);
    return createOidcVerifier({
      issuer,
      jwksUri: process.env.OIDC_JWKS_URI,
      audience: process.env.OIDC_AUDIENCE,
      adminGroup: process.env.OIDC_ADMIN_GROUP,
      groupsClaim: process.env.OIDC_GROUPS_CLAIM,
    });
  }

  console.error(
    "fibuki-api: no token verifier configured. Set OIDC_ISSUER (+ optional OIDC_AUDIENCE/" +
      "OIDC_ADMIN_GROUP) for production, or FIBUKI_DEV_UID=<uid> for dev mode. Refusing to start.",
  );
  process.exit(1);
}

async function main() {
  const barrel = await import("../index");

  const verifyToken = resolveVerifier();

  const { app, inventory } = createHost(barrel as Record<string, unknown>, {
    verifyToken,
    log: (m) => console.error(m),
  });

  // FIBUKI_NO_CRON=1 runs the HTTP host without schedules (e.g. a second
  // replica, or poking callables without the queue drains firing).
  const cron = createCronHost(barrel as Record<string, unknown>, {
    log: (m) => console.error(m),
  });
  if (process.env.FIBUKI_NO_CRON) {
    console.warn(`fibuki-api: FIBUKI_NO_CRON set — ${cron.jobs.length} scheduled jobs NOT started`);
  } else {
    cron.start();
    for (const job of cron.jobs) {
      console.log(`cron: ${job.name} [${job.schedule} -> ${job.cron} ${job.timezone}]`);
    }
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void cron.stop().finally(() => process.exit(0));
    });
  }

  const port = Number(process.env.PORT ?? 8788);
  app.listen(port, () => {
    console.log(
      `fibuki-api listening on :${port} — ${inventory.callables.length} callables, ` +
        `${inventory.requests.length} request functions, ${cron.jobs.length} scheduled jobs, ` +
        `${inventory.excluded.length} excluded`,
    );
  });
}

void main();
