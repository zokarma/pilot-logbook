// Unique id minting. Ids used to be Date.now() plus 4 random base-36 chars,
// which can collide when many ids are minted in the same millisecond (e.g. a
// large CSV import). A per-session counter guarantees uniqueness within a
// session; the random suffix guards across sessions and devices.

let counter = 0;

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return buf[0].toString(36) + buf[1].toString(36);
  }
  return Math.random().toString(36).slice(2, 10);
}

export function uid(prefix: string): string {
  counter = (counter + 1) % 36 ** 4;
  return prefix + Date.now().toString(36) + counter.toString(36).padStart(4, "0") + randomSuffix();
}
