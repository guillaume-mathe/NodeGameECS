/**
 * Internal query cache for World. Not exported from the package.
 */
export class QueryCache {
  constructor() {
    /** @type {Map<string, number[]>} */
    this._cache = new Map();
    /** @type {Map<number, Set<string>>} reverse index: componentId → query keys */
    this._index = new Map();
  }

  /**
   * Build a cache key from component types.
   * @param {Array<{ _id: number }>} types
   * @returns {string}
   */
  _key(types) {
    return types
      .map((t) => t._id)
      .sort((a, b) => a - b)
      .join(",");
  }

  /**
   * Resolve a query — return cached result or compute.
   * @param {Array<{ _id: number }>} types
   * @param {Map<number, { soa: object, membership: import("./Bitset.js").Bitset }>} stores
   * @param {Uint16Array} generations — per-slot generation values
   * @param {number} indexBits — number of bits for slot index (e.g. 20)
   * @returns {number[]}
   */
  resolve(types, stores, generations, indexBits) {
    const key = this._key(types);
    const cached = this._cache.get(key);
    if (cached) return cached;

    // Collect entries, bail early if any store is missing
    let smallest = null;
    let smallestCount = Infinity;
    const entries = [];
    for (const type of types) {
      const entry = stores.get(type._id);
      if (!entry) {
        // No store for this type → no entities match
        const empty = [];
        this._cache.set(key, empty);
        for (const t of types) {
          let set = this._index.get(t._id);
          if (!set) { set = new Set(); this._index.set(t._id, set); }
          set.add(key);
        }
        return empty;
      }
      const cnt = entry.membership.count();
      entries.push(entry);
      if (cnt < smallestCount) {
        smallestCount = cnt;
        smallest = entry;
      }
    }

    const result = [];
    if (smallest && smallestCount > 0) {
      const others = entries.filter((e) => e !== smallest);
      const words = smallest.membership._words;
      const len = words.length;
      for (let w = 0; w < len; w++) {
        let mask = words[w];
        while (mask !== 0) {
          const lsb = mask & (-mask);
          const bit = 31 - Math.clz32(lsb);
          const slotIndex = (w << 5) + bit;
          if (others.every((e) => e.membership.has(slotIndex))) {
            result.push((generations[slotIndex] << indexBits) | slotIndex);
          }
          mask ^= lsb;
        }
      }
    }

    this._cache.set(key, result);

    // Update reverse index
    for (const type of types) {
      let set = this._index.get(type._id);
      if (!set) {
        set = new Set();
        this._index.set(type._id, set);
      }
      set.add(key);
    }

    return result;
  }

  /**
   * Invalidate all cached queries involving a component type.
   * @param {number} componentId
   */
  invalidate(componentId) {
    const keys = this._index.get(componentId);
    if (!keys) return;
    for (const key of keys) {
      this._cache.delete(key);
    }
    keys.clear();
  }

  /** Clear all cached queries. */
  clear() {
    this._cache.clear();
    this._index.clear();
  }
}
