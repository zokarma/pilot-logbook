// Simple non-cryptographic hash (djb2). Personal app, not production security.
// Used both for the login gate and for deterministic unknown-airport coordinates.
export function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return String(h >>> 0);
}
