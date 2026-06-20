/**
 * Atomic per-user invoice number allocator.
 * Stores counter at users/{userId}/settings/invoiceCounter.
 * Format: YYYY-#### (e.g., "2026-0001"). Resets on year change.
 */

export async function allocateInvoiceNumber(
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<string> {
  const counterRef = db
    .collection("users")
    .doc(userId)
    .collection("settings")
    .doc("invoiceCounter");

  const currentYear = new Date().getFullYear();

  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    let next = 1;
    let year = currentYear;

    if (snap.exists) {
      const data = snap.data() as { next?: number; year?: number };
      if (data.year === currentYear && typeof data.next === "number") {
        next = data.next;
      } else {
        // New year (or never set) - reset
        next = 1;
        year = currentYear;
      }
    }

    tx.set(
      counterRef,
      {
        next: next + 1,
        year,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    return next;
  });

  return `${currentYear}-${String(seq).padStart(4, "0")}`;
}
