/**
 * Property names that must never be written through a dynamic key: assigning
 * `obj["__proto__"]` walks the inherited setter instead of creating an own
 * property, and a path walk THROUGH "__proto__" lands on Object.prototype —
 * global prototype pollution from user-controlled field names.
 * "constructor"/"prototype" are included as the standard defense-in-depth
 * trio (not exploitable through plain assignment here, but refusing them
 * costs nothing — no app data uses these as field names).
 */
export const UNSAFE_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isUnsafePropertyKey(key: string): boolean {
  return UNSAFE_PROPERTY_KEYS.has(key);
}
