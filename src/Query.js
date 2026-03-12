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
   * @param {Map<number, Map<number, object>>} stores
   * @returns {number[]}
   */
  resolve(types, stores) {
    const key = this._key(types);
    const cached = this._cache.get(key);
    if (cached) return cached;

    // Find the smallest store to iterate
    let smallest = null;
    let smallestSize = Infinity;
    for (const type of types) {
      const store = stores.get(type._id);
      const size = store ? store.size : 0;
      if (size < smallestSize) {
        smallestSize = size;
        smallest = store;
      }
    }

    const result = [];
    if (smallest) {
      const others = types
        .map((t) => stores.get(t._id))
        .filter((s) => s !== smallest);
      for (const entity of smallest.keys()) {
        if (others.every((s) => s && s.has(entity))) {
          result.push(entity);
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
