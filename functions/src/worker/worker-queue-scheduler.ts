/**
 * Worker Queue Scheduler — pure scheduling logic with no React/Firebase deps.
 *
 * Manages a queue of worker requests with:
 * - Configurable max concurrency
 * - Partner-level locking (1 request per partner at a time)
 * - Batch cancellation (partner_file_batch completion cancels siblings)
 * - Dedup + cancelled-id tracking
 */

export interface SchedulerRequest {
  id: string;
  workerType: string;
  triggerContext?: { partnerId?: string };
}

export interface SchedulerCallbacks<T extends SchedulerRequest> {
  onDispatch: (request: T) => Promise<void>;
  onCancel: (request: T) => void;
  onStateChange: (state: {
    pendingCount: number;
    activeCount: number;
    isProcessing: boolean;
  }) => void;
}

export class WorkerQueueScheduler<T extends SchedulerRequest> {
  private queue: T[] = [];
  private activePartnerIds = new Set<string>();
  private activeCount = 0;
  private cancelledIds = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly callbacks: SchedulerCallbacks<T>;

  constructor(maxConcurrent: number, callbacks: SchedulerCallbacks<T>) {
    this.maxConcurrent = maxConcurrent;
    this.callbacks = callbacks;
  }

  // --- Public API ---

  /** Add new requests to the queue (dedup by id, filter cancelled). */
  enqueue(requests: T[]): void {
    const existingIds = new Set(this.queue.map((r) => r.id));
    const newRequests = requests.filter(
      (r) => !existingIds.has(r.id) && !this.cancelledIds.has(r.id)
    );
    if (newRequests.length > 0) {
      this.queue.push(...newRequests);
      this.notifyState();
    }
  }

  /** Dispatch eligible requests up to maxConcurrent. */
  dispatch(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const pick = this.pickNextRequest();
      if (!pick) break; // all remaining blocked by active partners

      const { request, index } = pick;
      this.queue.splice(index, 1);

      const partnerId = request.triggerContext?.partnerId;
      if (partnerId) this.activePartnerIds.add(partnerId);
      this.activeCount++;

      // Fire-and-forget — completion triggers re-dispatch via onWorkerDone
      this.callbacks
        .onDispatch(request)
        .finally(() => this.onWorkerDone(request));
    }

    this.notifyState();
  }

  /** Cancel all pending requests for a specific partner. */
  cancelPendingForPartner(partnerId: string): void {
    this.queue = this.queue.filter((r) => {
      if (r.triggerContext?.partnerId === partnerId) {
        this.cancelledIds.add(r.id);
        this.callbacks.onCancel(r);
        return false;
      }
      return true;
    });
    this.notifyState();
  }

  // --- Read-only accessors (useful for testing) ---

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeWorkerCount(): number {
    return this.activeCount;
  }

  get isProcessing(): boolean {
    return this.activeCount > 0 || this.queue.length > 0;
  }

  get queueSnapshot(): readonly T[] {
    return this.queue;
  }

  get cancelledIdSet(): ReadonlySet<string> {
    return this.cancelledIds;
  }

  // --- Private ---

  private pickNextRequest(): { request: T; index: number } | null {
    for (let i = 0; i < this.queue.length; i++) {
      const partnerId = this.queue[i].triggerContext?.partnerId;
      if (!partnerId || !this.activePartnerIds.has(partnerId)) {
        return { request: this.queue[i], index: i };
      }
    }
    return null;
  }

  private onWorkerDone(request: T): void {
    const partnerId = request.triggerContext?.partnerId;
    if (partnerId) this.activePartnerIds.delete(partnerId);
    this.activeCount--;

    // After a batch completes, cancel remaining pending workers for that partner
    if (request.workerType === "partner_file_batch" && partnerId) {
      this.cancelPendingForPartner(partnerId);
    }

    // Try to fill freed slot(s)
    this.dispatch();
  }

  private notifyState(): void {
    this.callbacks.onStateChange({
      pendingCount: this.queue.length,
      activeCount: this.activeCount,
      isProcessing: this.activeCount > 0 || this.queue.length > 0,
    });
  }
}
