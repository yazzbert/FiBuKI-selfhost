import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkerQueueScheduler,
  SchedulerRequest,
  SchedulerCallbacks,
} from "../worker-queue-scheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 0;

function makeRequest(
  overrides: Partial<SchedulerRequest> = {}
): SchedulerRequest {
  return {
    id: `req-${++nextId}`,
    workerType: "file_matching",
    ...overrides,
  };
}

interface TestCallbacks extends SchedulerCallbacks<SchedulerRequest> {
  dispatched: SchedulerRequest[];
  cancelled: SchedulerRequest[];
  states: { pendingCount: number; activeCount: number; isProcessing: boolean }[];
  /** Map from request-id → resolver function. Calling it resolves the dispatch promise. */
  resolvers: Map<string, () => void>;
}

function makeCallbacks(): TestCallbacks {
  const dispatched: SchedulerRequest[] = [];
  const cancelled: SchedulerRequest[] = [];
  const states: TestCallbacks["states"] = [];
  const resolvers = new Map<string, () => void>();

  const cbs: TestCallbacks = {
    dispatched,
    cancelled,
    states,
    resolvers,

    onDispatch: vi.fn((req: SchedulerRequest) => {
      dispatched.push(req);
      return new Promise<void>((resolve) => {
        resolvers.set(req.id, resolve);
      });
    }),

    onCancel: vi.fn((req: SchedulerRequest) => {
      cancelled.push(req);
    }),

    onStateChange: vi.fn((state) => {
      states.push({ ...state });
    }),
  };

  return cbs;
}

/** Resolve one request and flush microtasks so onWorkerDone runs. */
async function resolve(cbs: TestCallbacks, id: string) {
  const r = cbs.resolvers.get(id);
  if (!r) throw new Error(`No resolver for ${id}`);
  r();
  // Flush the .finally() microtask
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  nextId = 0;
});

describe("WorkerQueueScheduler", () => {
  // =========================================================================
  // A. Concurrency picking
  // =========================================================================
  describe("concurrency picking", () => {
    it("dispatches up to MAX_CONCURRENT simultaneously", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.enqueue([
        makeRequest(),
        makeRequest(),
        makeRequest(),
        makeRequest(),
        makeRequest(),
      ]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(3);
      expect(scheduler.activeWorkerCount).toBe(3);
      expect(scheduler.pendingCount).toBe(2);
    });

    it("requests without partnerId are always eligible", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.enqueue([makeRequest(), makeRequest(), makeRequest()]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(3);
    });

    it("allows only 1 request per partnerId at a time", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.enqueue([
        makeRequest({ triggerContext: { partnerId: "p1" } }),
        makeRequest({ triggerContext: { partnerId: "p1" } }),
      ]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(1);
      expect(scheduler.pendingCount).toBe(1);
    });

    it("skips blocked requests to find eligible ones", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const a1 = makeRequest({ triggerContext: { partnerId: "pA" } });
      const a2 = makeRequest({ triggerContext: { partnerId: "pA" } });
      const a3 = makeRequest({ triggerContext: { partnerId: "pA" } });
      const b1 = makeRequest({ triggerContext: { partnerId: "pB" } });
      const c1 = makeRequest({ triggerContext: { partnerId: "pC" } });

      scheduler.enqueue([a1, a2, a3, b1, c1]);
      scheduler.dispatch();

      const ids = cbs.dispatched.map((r) => r.id);
      expect(ids).toEqual([a1.id, b1.id, c1.id]);
      expect(scheduler.pendingCount).toBe(2); // a2, a3 still queued
    });
  });

  // =========================================================================
  // B. Batch cancellation
  // =========================================================================
  describe("batch cancellation", () => {
    it("partner_file_batch completion cancels pending same-partner requests", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const batch = makeRequest({
        workerType: "partner_file_batch",
        triggerContext: { partnerId: "pX" },
      });
      const sibling1 = makeRequest({ triggerContext: { partnerId: "pX" } });
      const sibling2 = makeRequest({ triggerContext: { partnerId: "pX" } });
      const other = makeRequest({ triggerContext: { partnerId: "pY" } });

      scheduler.enqueue([batch, sibling1, sibling2, other]);
      scheduler.dispatch();

      // batch and other dispatched (sibling1, sibling2 blocked by pX)
      expect(cbs.dispatched.map((r) => r.id)).toEqual([batch.id, other.id]);

      // Complete the batch
      await resolve(cbs, batch.id);

      // siblings cancelled
      expect(cbs.cancelled.map((r) => r.id)).toContain(sibling1.id);
      expect(cbs.cancelled.map((r) => r.id)).toContain(sibling2.id);
      expect(scheduler.cancelledIdSet.has(sibling1.id)).toBe(true);
      expect(scheduler.cancelledIdSet.has(sibling2.id)).toBe(true);
    });

    it("onCancel callback called for each cancelled request", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const batch = makeRequest({
        workerType: "partner_file_batch",
        triggerContext: { partnerId: "pX" },
      });
      scheduler.enqueue([
        batch,
        makeRequest({ triggerContext: { partnerId: "pX" } }),
        makeRequest({ triggerContext: { partnerId: "pX" } }),
      ]);
      scheduler.dispatch();

      await resolve(cbs, batch.id);

      expect(cbs.onCancel).toHaveBeenCalledTimes(2);
    });

    it("non-matching partners are unaffected", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const batch = makeRequest({
        workerType: "partner_file_batch",
        triggerContext: { partnerId: "pX" },
      });
      const other = makeRequest({ triggerContext: { partnerId: "pY" } });
      const otherQueued = makeRequest({ triggerContext: { partnerId: "pY" } });

      scheduler.enqueue([batch, other, otherQueued]);
      scheduler.dispatch();

      await resolve(cbs, batch.id);

      expect(cbs.cancelled).toHaveLength(0);
      // otherQueued should still be in queue (or dispatched after slot freed)
    });

    it("cancelled IDs are tracked — enqueue ignores re-added cancelled IDs", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const batch = makeRequest({
        workerType: "partner_file_batch",
        triggerContext: { partnerId: "pX" },
      });
      const sibling = makeRequest({ triggerContext: { partnerId: "pX" } });

      scheduler.enqueue([batch, sibling]);
      scheduler.dispatch();
      await resolve(cbs, batch.id);

      expect(scheduler.cancelledIdSet.has(sibling.id)).toBe(true);

      // Try to re-enqueue the cancelled request
      scheduler.enqueue([sibling]);
      expect(scheduler.pendingCount).toBe(0);
    });

    it("non-batch worker types do NOT cancel siblings", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const req = makeRequest({
        workerType: "file_matching",
        triggerContext: { partnerId: "pX" },
      });
      const sibling = makeRequest({ triggerContext: { partnerId: "pX" } });

      scheduler.enqueue([req, sibling]);
      scheduler.dispatch();
      await resolve(cbs, req.id);

      expect(cbs.cancelled).toHaveLength(0);
      // sibling should now be dispatched (partner freed + re-dispatch)
      expect(cbs.dispatched.map((r) => r.id)).toContain(sibling.id);
    });
  });

  // =========================================================================
  // C. Max concurrency
  // =========================================================================
  describe("max concurrency", () => {
    it("stops dispatching at limit even with eligible items", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(2, cbs);

      scheduler.enqueue([makeRequest(), makeRequest(), makeRequest()]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(2);
      expect(scheduler.pendingCount).toBe(1);
    });

    it("freed slot via onWorkerDone triggers re-dispatch", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(2, cbs);

      const r1 = makeRequest();
      const r2 = makeRequest();
      const r3 = makeRequest();

      scheduler.enqueue([r1, r2, r3]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(2);

      await resolve(cbs, r1.id);

      expect(cbs.dispatched).toHaveLength(3);
      expect(cbs.dispatched[2].id).toBe(r3.id);
    });

    it("multiple sequential completions fill multiple slots", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(2, cbs);

      const r1 = makeRequest();
      const r2 = makeRequest();
      const r3 = makeRequest();
      const r4 = makeRequest();

      scheduler.enqueue([r1, r2, r3, r4]);
      scheduler.dispatch();
      expect(cbs.dispatched).toHaveLength(2);

      // Complete first → r3 dispatched
      await resolve(cbs, r1.id);
      expect(cbs.dispatched).toHaveLength(3);

      // Complete second → r4 dispatched
      await resolve(cbs, r2.id);
      expect(cbs.dispatched).toHaveLength(4);
    });

    it("maxConcurrent=1 serializes execution", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(1, cbs);

      const r1 = makeRequest();
      const r2 = makeRequest();
      const r3 = makeRequest();

      scheduler.enqueue([r1, r2, r3]);
      scheduler.dispatch();
      expect(cbs.dispatched).toHaveLength(1);

      await resolve(cbs, r1.id);
      expect(cbs.dispatched).toHaveLength(2);

      await resolve(cbs, r2.id);
      expect(cbs.dispatched).toHaveLength(3);
    });
  });

  // =========================================================================
  // D. Edge cases
  // =========================================================================
  describe("edge cases", () => {
    it("empty queue — dispatch is a no-op", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(0);
      expect(scheduler.activeWorkerCount).toBe(0);
    });

    it("all items blocked by active partners — dispatch stops", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.enqueue([
        makeRequest({ triggerContext: { partnerId: "pA" } }),
        makeRequest({ triggerContext: { partnerId: "pA" } }),
        makeRequest({ triggerContext: { partnerId: "pA" } }),
      ]);
      scheduler.dispatch();

      // Only 1 dispatched (partner lock)
      expect(cbs.dispatched).toHaveLength(1);
      expect(scheduler.pendingCount).toBe(2);
    });

    it("worker done for request without partnerId does not crash", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const r = makeRequest(); // no triggerContext
      scheduler.enqueue([r]);
      scheduler.dispatch();

      // Should not throw
      await resolve(cbs, r.id);
      expect(scheduler.activeWorkerCount).toBe(0);
    });

    it("enqueue deduplicates by id", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const r = makeRequest();
      scheduler.enqueue([r]);
      scheduler.enqueue([r]); // same id
      scheduler.enqueue([r]); // same id again

      expect(scheduler.pendingCount).toBe(1);
    });

    it("onStateChange fires on every transition", () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      scheduler.enqueue([makeRequest(), makeRequest()]);
      // enqueue fires once

      scheduler.dispatch();
      // dispatch fires once

      expect(cbs.states.length).toBeGreaterThanOrEqual(2);

      // Last state should reflect dispatched state
      const last = cbs.states[cbs.states.length - 1];
      expect(last.activeCount).toBe(2);
      expect(last.pendingCount).toBe(0);
      expect(last.isProcessing).toBe(true);
    });

    it("isProcessing is false when queue empty and nothing active", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const r = makeRequest();
      scheduler.enqueue([r]);
      scheduler.dispatch();

      await resolve(cbs, r.id);

      expect(scheduler.isProcessing).toBe(false);
      const last = cbs.states[cbs.states.length - 1];
      expect(last.isProcessing).toBe(false);
    });

    it("partner slot is freed after completion, allowing next partner request", async () => {
      const cbs = makeCallbacks();
      const scheduler = new WorkerQueueScheduler(3, cbs);

      const r1 = makeRequest({ triggerContext: { partnerId: "pA" } });
      const r2 = makeRequest({ triggerContext: { partnerId: "pA" } });

      scheduler.enqueue([r1, r2]);
      scheduler.dispatch();

      expect(cbs.dispatched).toHaveLength(1);

      await resolve(cbs, r1.id);

      expect(cbs.dispatched).toHaveLength(2);
      expect(cbs.dispatched[1].id).toBe(r2.id);
    });
  });
});
