import { describe, it, expect } from "vitest";
import { QueryCache } from "../src/Query.js";
import { Bitset } from "../src/Bitset.js";

const INDEX_BITS = 20;

function makeType(id) {
  return { _id: id, name: `T${id}`, defaults: {} };
}

function makeStores(...entries) {
  const stores = new Map();
  for (const [typeId, entityIds] of entries) {
    const membership = new Bitset(1024);
    for (const eid of entityIds) membership.set(eid);
    stores.set(typeId, { soa: null, membership });
  }
  return stores;
}

// All entity IDs in these tests are small integers with generation 0,
// so (0 << 20) | slot === slot. We use a shared generations array.
const generations = new Uint16Array(1024);

describe("QueryCache", () => {
  it("resolves a single-component query", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const stores = makeStores([0, [1, 2, 3]]);

    const result = cache.resolve([A], stores, generations, INDEX_BITS);
    expect(result.sort()).toEqual([1, 2, 3]);
  });

  it("resolves a multi-component query (intersection)", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const B = makeType(1);
    const stores = makeStores(
      [0, [1, 2, 3]],
      [1, [2, 3, 4]],
    );

    const result = cache.resolve([A, B], stores, generations, INDEX_BITS);
    expect(result.sort()).toEqual([2, 3]);
  });

  it("returns cached result on second call", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const stores = makeStores([0, [1]]);

    const first = cache.resolve([A], stores, generations, INDEX_BITS);
    const second = cache.resolve([A], stores, generations, INDEX_BITS);
    expect(first).toBe(second); // same reference
  });

  it("invalidates cache when component changes", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const stores = makeStores([0, [1]]);

    const first = cache.resolve([A], stores, generations, INDEX_BITS);
    cache.invalidate(0);
    // Add entity 2 to the membership
    stores.get(0).membership.set(2);
    const second = cache.resolve([A], stores, generations, INDEX_BITS);

    expect(first).not.toBe(second);
    expect(second.sort()).toEqual([1, 2]);
  });

  it("returns empty array when a store is missing", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const B = makeType(1);
    const stores = makeStores([0, [1, 2]]);

    const result = cache.resolve([A, B], stores, generations, INDEX_BITS);
    expect(result).toEqual([]);
  });

  it("iterates the smallest store", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const B = makeType(1);
    // B is smaller — should iterate B and check A
    const stores = makeStores(
      [0, [1, 2, 3, 4, 5]],
      [1, [3]],
    );

    const result = cache.resolve([A, B], stores, generations, INDEX_BITS);
    expect(result).toEqual([3]);
  });

  it("clear() removes all cached entries", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const stores = makeStores([0, [1]]);

    const first = cache.resolve([A], stores, generations, INDEX_BITS);
    cache.clear();
    stores.get(0).membership.set(2);
    const second = cache.resolve([A], stores, generations, INDEX_BITS);

    expect(first).not.toBe(second);
    expect(second.sort()).toEqual([1, 2]);
  });

  it("query key is order-independent", () => {
    const cache = new QueryCache();
    const A = makeType(0);
    const B = makeType(1);
    const stores = makeStores(
      [0, [1, 2]],
      [1, [2, 3]],
    );

    const ab = cache.resolve([A, B], stores, generations, INDEX_BITS);
    const ba = cache.resolve([B, A], stores, generations, INDEX_BITS);
    expect(ab).toBe(ba); // same cached reference
  });
});
