import { QueryCache } from "./Query.js";

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GENERATION_MASK = 0xfff;

const extractIndex = (id) => id & INDEX_MASK;
const extractGeneration = (id) => id >>> INDEX_BITS;

export class World {
  /**
   * @param {{ components?: Array<{ name: string, defaults: object, _id: number }> }} [options]
   */
  constructor({ components } = {}) {
    /** @type {number[]} per-slot generation counter */
    this._generations = [];
    /** @type {number[]} recycled slot stack */
    this._freeIndices = [];
    /** @type {Set<number>} live entity IDs */
    this._alive = new Set();
    /** @type {number[]} deferred destruction queue */
    this._pendingDestroy = [];
    /** @type {number} next fresh slot index */
    this._nextIndex = 0;

    /** @type {Map<number, Map<number, object>>} componentId → entityId → data */
    this._stores = new Map();

    /** @type {QueryCache} */
    this._queries = new QueryCache();

    /** @type {Array<{ name: string|null, fn: function }>} */
    this._systems = [];

    /** @type {Map<string, { name: string, defaults: object, _id: number }>} name → ComponentType */
    this._registry = new Map();

    if (components) {
      for (const type of components) {
        this._registry.set(type.name, type);
      }
    }
  }

  // --- Entity lifecycle ---

  /**
   * Create a new entity.
   * @returns {number} entity ID
   */
  create() {
    let index, generation;
    if (this._freeIndices.length > 0) {
      index = this._freeIndices.pop();
      generation = this._generations[index];
    } else {
      index = this._nextIndex++;
      generation = 0;
      this._generations[index] = 0;
    }
    const id = (generation << INDEX_BITS) | index;
    this._alive.add(id);
    return id;
  }

  /**
   * Create an entity at a specific ID (for deserialization).
   * @param {number} id
   */
  _createWithId(id) {
    const index = extractIndex(id);
    const generation = extractGeneration(id);

    // Ensure generations array is large enough
    while (this._generations.length <= index) {
      this._generations.push(0);
    }
    this._generations[index] = generation;

    // Ensure _nextIndex is past this slot
    if (index >= this._nextIndex) {
      this._nextIndex = index + 1;
    }

    // Remove from free list if present
    const freeIdx = this._freeIndices.indexOf(index);
    if (freeIdx !== -1) {
      this._freeIndices.splice(freeIdx, 1);
    }

    this._alive.add(id);
    return id;
  }

  /**
   * Queue an entity for deferred destruction (flushed at end of step()).
   * @param {number} id
   */
  destroy(id) {
    if (!this._alive.has(id)) return;
    this._pendingDestroy.push(id);
  }

  /**
   * Check if an entity is alive.
   * @param {number} id
   * @returns {boolean}
   */
  has(id) {
    return this._alive.has(id);
  }

  /**
   * Flush pending destroys — remove entities and their components.
   */
  _flushDestroy() {
    for (const id of this._pendingDestroy) {
      if (!this._alive.has(id)) continue;
      this._alive.delete(id);

      // Remove from all component stores
      for (const [componentId, store] of this._stores) {
        if (store.delete(id)) {
          this._queries.invalidate(componentId);
        }
      }

      // Recycle the slot with incremented generation
      const index = extractIndex(id);
      this._generations[index] = (this._generations[index] + 1) & GENERATION_MASK;
      this._freeIndices.push(index);
    }
    this._pendingDestroy.length = 0;
  }

  // --- Component operations ---

  /**
   * Add a component to an entity.
   * @param {number} entity
   * @param {{ name: string, defaults: object, _id: number }} componentType
   * @param {object} [overrides]
   */
  add(entity, componentType, overrides) {
    if (!this._alive.has(entity)) return;

    let store = this._stores.get(componentType._id);
    if (!store) {
      store = new Map();
      this._stores.set(componentType._id, store);
    }

    store.set(entity, { ...componentType.defaults, ...overrides });

    // Register type if not already known
    if (!this._registry.has(componentType.name)) {
      this._registry.set(componentType.name, componentType);
    }

    this._queries.invalidate(componentType._id);
  }

  /**
   * Remove a component from an entity.
   * @param {number} entity
   * @param {{ _id: number }} componentType
   */
  remove(entity, componentType) {
    const store = this._stores.get(componentType._id);
    if (!store) return;
    if (store.delete(entity)) {
      this._queries.invalidate(componentType._id);
    }
  }

  /**
   * Get a component's data for an entity (mutable reference).
   * @param {number} entity
   * @param {{ _id: number }} componentType
   * @returns {object|undefined}
   */
  get(entity, componentType) {
    const store = this._stores.get(componentType._id);
    return store ? store.get(entity) : undefined;
  }

  // --- Queries ---

  /**
   * Query for entities having all listed component types.
   * @param {...{ _id: number }} componentTypes
   * @returns {number[]}
   */
  query(...componentTypes) {
    return this._queries.resolve(componentTypes, this._stores);
  }

  // --- Systems ---

  /**
   * Register a system. Runs in insertion order during step().
   * @param {string|function} nameOrFn
   * @param {function} [fn]
   */
  addSystem(nameOrFn, fn) {
    if (typeof nameOrFn === "function") {
      this._systems.push({ name: null, fn: nameOrFn });
    } else {
      this._systems.push({ name: nameOrFn, fn });
    }
  }

  /**
   * Remove a system by name or function reference.
   * @param {string|function} nameOrFn
   */
  removeSystem(nameOrFn) {
    const idx =
      typeof nameOrFn === "string"
        ? this._systems.findIndex((s) => s.name === nameOrFn)
        : this._systems.findIndex((s) => s.fn === nameOrFn);
    if (idx !== -1) this._systems.splice(idx, 1);
  }

  /**
   * Run all systems in order, then flush deferred destroys.
   * @param {object} ctx — passed to each system as second argument
   */
  step(ctx) {
    for (const system of this._systems) {
      system.fn(this, ctx);
    }
    this._flushDestroy();
  }

  // --- Serialization ---

  /**
   * Serialize the entire world to a plain object.
   * @returns {{ entities: Array<{ id: number, components: Record<string, object> }> }}
   */
  serialize() {
    const entities = [];
    for (const id of this._alive) {
      const components = {};
      for (const [componentId, store] of this._stores) {
        const data = store.get(id);
        if (data) {
          // Find name for this componentId
          for (const [name, type] of this._registry) {
            if (type._id === componentId) {
              components[name] = { ...data };
              break;
            }
          }
        }
      }
      entities.push({ id, components });
    }
    return { entities };
  }

  /**
   * Clear the world and recreate all entities/components from serialized data.
   * @param {{ entities: Array<{ id: number, components: Record<string, object> }> }} data
   */
  deserialize(data) {
    // Clear everything
    this._alive.clear();
    this._stores.clear();
    this._queries.clear();
    this._pendingDestroy.length = 0;
    this._freeIndices.length = 0;
    this._nextIndex = 0;
    this._generations.length = 0;

    for (const entry of data.entities) {
      this._createWithId(entry.id);
      for (const [name, compData] of Object.entries(entry.components)) {
        const type = this._registry.get(name);
        if (type) {
          this.add(entry.id, type, compData);
        }
      }
    }
  }
}
