/**
 * Self-check: remote membership sync (local wins fields). Run: node selfcheck.js
 */
function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const remote = [
  { code: "111", seats: 1, createdAt: "2026-01-01" },
  { code: "222", seats: 2, createdAt: "2026-01-02" },
];
const local = [
  { code: "222", seats: 4, createdAt: "2026-01-03" },
  { code: "333", seats: 3, createdAt: "2026-01-04" },
];

const merged = mergeRemoteMembership(local, remote);
const byCode = Object.fromEntries(merged.map((c) => [c.code, c]));

assert(merged.length === 2, "expected 2 codes (remote membership)");
assert(byCode["111"].seats === 1, "remote-only code kept");
assert(byCode["222"].seats === 4, "local wins on conflict");
assert(!byCode["333"], "local-only code dropped (treated as deleted elsewhere)");

const emptyRemote = mergeRemoteMembership(local, []);
assert(emptyRemote.length === 0, "empty remote clears local (no migrate)");

console.log("selfcheck ok");
