/**
 * Boot shim for `firebase-admin/storage` — work item 5 replaces the throwing
 * proxies with a real MinIO/S3 implementation of the bucket().file() surface.
 *
 * `getStorage()` runs at module load in email-inbound/receiveEmail.ts, so it
 * (and `bucket()`) must succeed; every actual operation throws loudly with
 * the accessed method path, so a storage-touching code path can never
 * silently no-op on data.
 */

function throwingProxy(path: string): unknown {
  return new Proxy(function () {} as object, {
    get(_t, prop) {
      if (prop === "name") return path;
      if (typeof prop === "symbol") return undefined;
      return throwingProxy(`${path}.${String(prop)}`);
    },
    apply() {
      throw new Error(
        `selfhost storage-shim: ${path}() not implemented yet (work item 5, MinIO)`,
      );
    },
  });
}

export interface StorageShim {
  bucket(name?: string): unknown;
}

export function getStorage(): StorageShim {
  return {
    bucket(name?: string) {
      return throwingProxy(`bucket(${name ?? ""})`);
    },
  };
}
