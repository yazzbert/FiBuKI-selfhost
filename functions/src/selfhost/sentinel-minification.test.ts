/**
 * Regression test — FieldValue sentinels must survive a minified build.
 *
 * The shim used to identify sentinels by `constructor.name`. That works in the
 * API container and in this test process, and fails silently in the web
 * container, whose Next production build mangles class names to things like
 * "t". An unrecognised sentinel is not an error: it falls through to the
 * generic object branch and serialises to `{}`, so
 * `createdAt: FieldValue.serverTimestamp()` was stored as an empty object.
 * Reaching the browser as a "timestamp" with no toDate(), a single such row
 * crashed every page in the app.
 *
 * These tests mangle the real transform classes' `name` the way a minifier
 * would, so a name-based implementation fails them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FieldValue } from "@google-cloud/firestore";
import { getFirestore, Timestamp, __resetFirestoreShim } from "./firestore-shim";

const db = getFirestore();

/** Rename the sentinel classes in place, as a minifier would. */
function mangleSentinelClassNames(): () => void {
  const probes = [
    FieldValue.serverTimestamp(),
    FieldValue.delete(),
    FieldValue.increment(1),
    FieldValue.arrayUnion("probe"),
    FieldValue.arrayRemove("probe"),
  ];

  const restores: Array<() => void> = [];
  probes.forEach((probe, i) => {
    const ctor = (probe as object).constructor;
    const original = Object.getOwnPropertyDescriptor(ctor, "name");
    Object.defineProperty(ctor, "name", { value: `t${i}`, configurable: true });
    restores.push(() => {
      if (original) Object.defineProperty(ctor, "name", original);
    });
  });

  return () => restores.forEach((r) => r());
}

describe("FieldValue sentinels under minified class names", () => {
  let restore: () => void;

  beforeEach(async () => {
    await __resetFirestoreShim();
    restore = mangleSentinelClassNames();
  });

  afterEach(() => {
    restore();
  });

  it("resolves serverTimestamp() to a real Timestamp, not {}", async () => {
    await db.collection("notifications").doc("n1").set({
      type: "worker_activity",
      createdAt: FieldValue.serverTimestamp(),
    });

    const snap = await db.collection("notifications").doc("n1").get();
    const createdAt = snap.data()?.createdAt;

    // The exact failure that reached production: an empty object.
    expect(createdAt).not.toEqual({});
    expect(createdAt).toBeInstanceOf(Timestamp);
    expect(typeof (createdAt as Timestamp).toDate().getTime()).toBe("number");
  });

  it("resolves a nested serverTimestamp() inside a map value", async () => {
    await db.collection("notifications").doc("n2").set({
      context: { startedAt: FieldValue.serverTimestamp() },
    });

    const nested = (await db.collection("notifications").doc("n2").get()).data()
      ?.context as { startedAt: unknown };
    expect(nested.startedAt).toBeInstanceOf(Timestamp);
  });

  it("still applies increment()", async () => {
    await db.collection("counters").doc("c1").set({ hits: 1 });
    await db.collection("counters").doc("c1").update({ hits: FieldValue.increment(4) });

    expect((await db.collection("counters").doc("c1").get()).data()?.hits).toBe(5);
  });

  it("still applies arrayUnion() and arrayRemove()", async () => {
    await db.collection("docs2").doc("d1").set({ tags: ["a"] });
    await db.collection("docs2").doc("d1").update({ tags: FieldValue.arrayUnion("b") });
    expect((await db.collection("docs2").doc("d1").get()).data()?.tags).toEqual(["a", "b"]);

    await db.collection("docs2").doc("d1").update({ tags: FieldValue.arrayRemove("a") });
    expect((await db.collection("docs2").doc("d1").get()).data()?.tags).toEqual(["b"]);
  });

  it("still applies delete()", async () => {
    await db.collection("docs2").doc("d2").set({ keep: 1, drop: 2 });
    await db.collection("docs2").doc("d2").update({ drop: FieldValue.delete() });

    const data = (await db.collection("docs2").doc("d2").get()).data();
    expect(data).toHaveProperty("keep");
    expect(data).not.toHaveProperty("drop");
  });

  it("leaves ordinary objects alone", async () => {
    await db.collection("docs2").doc("d3").set({ meta: { a: 1 }, empty: {} });

    const data = (await db.collection("docs2").doc("d3").get()).data();
    expect(data?.meta).toEqual({ a: 1 });
    expect(data?.empty).toEqual({});
  });
});
