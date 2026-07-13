/**
 * fibuki-api process entry: boots the index.ts barrel through the selfhost
 * shims and serves every mounted callable/request function.
 *
 * Must run with the module aliases active, which vite-node gets from the
 * same config the tests use:
 *
 *   npx vite-node --config vitest.selfhost.config.ts src/selfhost/server.ts
 *
 * Auth: production fronting is Authentik OIDC — the verifier for it lands
 * with the deployment work. Until then the only supported mode is the
 * explicit dev bypass FIBUKI_DEV_UID=<uid>, which accepts ANY bearer token
 * as that uid. Refuses to start without it rather than guessing.
 */

import { createHost, type TokenVerifier } from "./host";

async function main() {
  const barrel = await import("../index");

  const devUid = process.env.FIBUKI_DEV_UID;
  if (!devUid) {
    console.error(
      "fibuki-api: no token verifier configured. Set FIBUKI_DEV_UID=<uid> for dev mode " +
        "(accepts any bearer token as that uid). Authentik OIDC verification lands with deployment.",
    );
    process.exit(1);
  }
  console.warn(`fibuki-api: DEV AUTH MODE — every bearer token authenticates as "${devUid}"`);
  const verifyToken: TokenVerifier = async () => ({ uid: devUid, token: {} });

  const { app, inventory } = createHost(barrel as Record<string, unknown>, {
    verifyToken,
    log: (m) => console.error(m),
  });

  const port = Number(process.env.PORT ?? 8788);
  app.listen(port, () => {
    console.log(
      `fibuki-api listening on :${port} — ${inventory.callables.length} callables, ` +
        `${inventory.requests.length} request functions, ${inventory.scheduled.length} scheduled ` +
        `(cron host pending), ${inventory.excluded.length} excluded`,
    );
  });
}

void main();
