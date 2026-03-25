import { QueryCache } from "./Query.js";
import { SoAStore } from "./SoAStore.js";
import { Bitset } from "./Bitset.js";

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GENERATION_MASK = 0xfff;
const INITIAL_CAPACITY = 1024;

const extractIndex = (id) => id & INDEX_MASK;
const extractGeneration = (id) => id >>> INDEX_BITS;

export class World {
  /**
   * @param {{ components?: Array<{ name: string, defaults: object, _id: number }>, registry?: object }} [options]
   */
  constructor({ components, registry } = {}) {
    /** @type {number} current slot capacity */
    this._capacity = INITIAL_CAPACITY;
    /** @type {Uint16Array} per-slot generation counter */
    this._generations = new Uint16Array(INITIAL_CAPACITY);
    /** @type {number[]} recycled slot stack */
    this._freeIndices = [];
    /** @type {Bitset} live slot tracking */
    this._alive = new Bitset(INITIAL_CAPACITY);
    /** @type {number[]} deferred destruction queue */
    this._pendingDestroy = [];
    /** @type {number} next fresh slot index */
    this._nextIndex = 0;

    /** @type {Map<number, { soa: SoAStore, membership: Bitset }>} componentId → SoA store + membership bitset */
    this._stores = new Map();

    /** @type {QueryCache} */
    this._queries = new QueryCache();

    /** @type {Array<{ name: string|null, fn: function }>} */
    this._systems = [];

    /** @type {Map<string, { name: string, defaults: object, _id: number }>} name → ComponentType */
    this._registry = new Map();

    // --- Dirty tracking ---
    /** @type {Set<number>} entity IDs created since last flushDiffs */
    this._dirtyCreated = new Set();
    /** @type {Set<number>} entity IDs destroyed since last flushDiffs */
    this._dirtyDestroyed = new Set();
    /** @type {Map<number, Set<number>>} entityId → Set<componentId> (updated data) */
    this._dirtyComponents = new Map();
    /** @type {Map<number, Set<number>>} entityId → Set<componentId> (removed components) */
    this._dirtyRemovedComponents = new Map();
    /** @type {boolean} disabled during applyDiff/applySnapshot */
    this._trackingEnabled = true;
    /** @type {Map<string, object>} "entityId:componentId" → last flushed data copy (for transition policy) */
    this._lastFlushed = new Map();

    /** @type {object|null} component registry for diff policies */
    this._componentRegistry = registry || null;

    if (components) {
      for (const type of components) {
        this._registry.set(type.name, type);
      }
    }
  }

  // --- Capacity management ---

  /**
   * Grow all backing arrays if the slot index exceeds current capacity.
   * @param {number} slotIndex
   */
  _ensureCapacity(slotIndex) {
    if (slotIndex < this._capacity) return;
    const newCap = Math.max(this._capacity * 2, slotIndex + 1);
    this._alive.grow(newCap);
    const newGen = new Uint16Array(newCap);
    newGen.set(this._generations);
    this._generations = newGen;
    for (const entry of this._stores.values()) {
      entry.soa.grow(newCap);
      entry.membership.grow(newCap);
    }
    this._capacity = newCap;
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
      this._ensureCapacity(index);
      generation = 0;
      this._generations[index] = 0;
    }
    const id = (generation << INDEX_BITS) | index;
    this._alive.set(index);
    if (this._trackingEnabled) {
      this._dirtyCreated.add(id);
    }
    return id;
  }

  /**
   * Create an entity at a specific ID (for deserialization).
   * @param {number} id
   */
  _createWithId(id) {
    const index = extractIndex(id);
    const generation = extractGeneration(id);

    this._ensureCapacity(index);
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

    this._alive.set(index);
    return id;
  }

  /**
   * Queue an entity for deferred destruction (flushed at end of step()).
   * @param {number} id
   */
  destroy(id) {
    if (!this.has(id)) return;
    this._pendingDestroy.push(id);
  }

  /**
   * Check if an entity is alive.
   * @param {number} id
   * @returns {boolean}
   */
  has(id) {
    const index = extractIndex(id);
    return this._alive.has(index) && this._generations[index] === extractGeneration(id);
  }

  /**
   * Flush pending destroys — remove entities and their components.
   */
  _flushDestroy() {
    for (const id of this._pendingDestroy) {
      const index = extractIndex(id);
      if (!this._alive.has(index) || this._generations[index] !== extractGeneration(id)) continue;
      this._alive.clear(index);

      if (this._trackingEnabled) {
        this._dirtyDestroyed.add(id);
      }

      // Remove from all component stores
      for (const [componentId, entry] of this._stores) {
        if (entry.membership.has(index)) {
          entry.soa.clear(index);
          entry.membership.clear(index);
          this._queries.invalidate(componentId);
        }
      }

      // Recycle the slot with incremented generation
      this._generations[index] = (this._generations[index] + 1) & GENERATION_MASK;
      this._freeIndices.push(index);
    }
    this._pendingDestroy.length = 0;
  }

  // --- Component operations ---

  /**
   * Add a component to an entity.
   * @param {number} entity
   * @param {{ name: string, defaults: object, _id: number, _fields: string[], _schema: object }} componentType
   * @param {object} [overrides]
   */
  add(entity, componentType, overrides) {
    if (!this.has(entity)) return;
    const index = extractIndex(entity);

    let entry = this._stores.get(componentType._id);
    if (!entry) {
      entry = {
        soa: new SoAStore(componentType, this._capacity),
        membership: new Bitset(this._capacity),
      };
      this._stores.set(componentType._id, entry);
    }

    const data = { ...componentType.defaults, ...overrides };
    entry.soa.set(index, data);
    entry.membership.set(index);

    // Register type if not already known
    if (!this._registry.has(componentType.name)) {
      this._registry.set(componentType.name, componentType);
    }

    if (this._trackingEnabled) {
      this._markDirty(entity, componentType._id);
    }

    this._queries.invalidate(componentType._id);
  }

  /**
   * Remove a component from an entity.
   * @param {number} entity
   * @param {{ _id: number }} componentType
   */
  remove(entity, componentType) {
    const entry = this._stores.get(componentType._id);
    if (!entry) return;
    const index = extractIndex(entity);
    if (entry.membership.has(index)) {
      entry.soa.clear(index);
      entry.membership.clear(index);
      if (this._trackingEnabled) {
        this._markComponentRemoved(entity, componentType._id);
      }
      this._queries.invalidate(componentType._id);
    }
  }

  /**
   * Get a component's data for an entity (returns a Proxy that reads/writes through to SoA).
   * @param {number} entity
   * @param {{ _id: number, _fields: string[], _schema: object }} componentType
   * @returns {object|undefined}
   */
  get(entity, componentType) {
    const entry = this._stores.get(componentType._id);
    if (!entry) return undefined;
    const index = extractIndex(entity);
    if (!entry.membership.has(index)) return undefined;

    const soa = entry.soa;
    const fields = componentType._fields;
    const schema = componentType._schema;

    return new Proxy(Object.create(null), {
      get(_, prop) {
        if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
        if (prop === "toJSON") return () => soa.toObject(index);
        if (typeof prop === "symbol") return undefined;
        if (!fields.includes(prop)) return undefined;
        const val = soa.getField(index, prop);
        return schema[prop].jsType === "boolean" ? Boolean(val) : val;
      },
      set(_, prop, value) {
        soa.setField(index, prop, value);
        return true;
      },
      ownKeys() {
        return [...fields];
      },
      has(_, prop) {
        return fields.includes(prop);
      },
      getOwnPropertyDescriptor(_, prop) {
        if (fields.includes(prop)) {
          const val = soa.getField(index, prop);
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: schema[prop].jsType === "boolean" ? Boolean(val) : val,
          };
        }
        return undefined;
      },
    });
  }

  // --- Queries ---

  /**
   * Query for entities having all listed component types.
   * @param {...{ _id: number }} componentTypes
   * @returns {number[]}
   */
  query(...componentTypes) {
    return this._queries.resolve(componentTypes, this._stores, this._generations, INDEX_BITS);
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

  // --- Prefabs ---

  /**
   * Spawn an entity from a prefab template.
   * @param {{ components: Array<[{ name: string, defaults: object, _id: number }, object]> }} prefab
   * @param {Record<string, object>} [overrides] — per-component overrides keyed by component name
   * @returns {number} entity ID
   */
  spawn(prefab, overrides) {
    const entity = this.create();
    for (const [type, defaults] of prefab.components) {
      const merged = overrides && overrides[type.name]
        ? { ...defaults, ...overrides[type.name] }
        : defaults;
      this.add(entity, type, merged);
    }
    return entity;
  }

  // --- Serialization ---

  /**
   * Serialize the entire world to a plain object.
   * @returns {{ entities: Array<{ id: number, components: Record<string, object> }> }}
   */
  serialize() {
    const entities = [];
    const aliveIds = this._alive.toArray(this._generations, INDEX_BITS);
    for (const id of aliveIds) {
      const index = extractIndex(id);
      const components = {};
      for (const [componentId, entry] of this._stores) {
        if (!entry.membership.has(index)) continue;
        const name = this._componentName(componentId);
        if (!name) continue;
        components[name] = entry.soa.toObject(index);
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
    this._alive.clearAll();
    this._stores.clear();
    this._queries.clear();
    this._pendingDestroy.length = 0;
    this._freeIndices.length = 0;
    this._nextIndex = 0;
    this._generations.fill(0);

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

  // --- Dirty tracking internals ---

  /**
   * Mark an entity+component as dirty (data changed).
   * @param {number} entity
   * @param {number} componentId
   */
  _markDirty(entity, componentId) {
    let set = this._dirtyComponents.get(entity);
    if (!set) {
      set = new Set();
      this._dirtyComponents.set(entity, set);
    }
    set.add(componentId);
  }

  /**
   * Track a component removal for dirty tracking.
   * @param {number} entity
   * @param {number} componentId
   */
  _markComponentRemoved(entity, componentId) {
    let set = this._dirtyRemovedComponents.get(entity);
    if (!set) {
      set = new Set();
      this._dirtyRemovedComponents.set(entity, set);
    }
    set.add(componentId);
    // Also remove from dirty components if it was there
    const dirtySet = this._dirtyComponents.get(entity);
    if (dirtySet) {
      dirtySet.delete(componentId);
    }
  }

  /** Clear all dirty tracking state. */
  _clearDirty() {
    this._dirtyCreated.clear();
    this._dirtyDestroyed.clear();
    this._dirtyComponents.clear();
    this._dirtyRemovedComponents.clear();
  }

  /**
   * Reverse lookup: componentId → component name.
   * @param {number} componentId
   * @returns {string|undefined}
   */
  _componentName(componentId) {
    for (const [name, type] of this._registry) {
      if (type._id === componentId) return name;
    }
    return undefined;
  }

  // --- set() and markDirty() ---

  /**
   * Partial update of a component's data with dirty tracking.
   * @param {number} entity
   * @param {{ _id: number }} componentType
   * @param {object} changes
   */
  set(entity, componentType, changes) {
    const entry = this._stores.get(componentType._id);
    if (!entry) return;
    const index = extractIndex(entity);
    if (!entry.membership.has(index)) return;

    // Transition policy: check equals before marking dirty
    if (this._trackingEnabled && this._componentRegistry) {
      const regEntry = this._componentRegistry.get(componentType);
      if (regEntry && regEntry.diffPolicy === "transition" && regEntry.equals) {
        const prev = entry.soa.toObject(index);
        entry.soa.set(index, changes);
        const curr = entry.soa.toObject(index);
        if (!regEntry.equals(prev, curr)) {
          this._markDirty(entity, componentType._id);
        }
        return;
      }
    }

    entry.soa.set(index, changes);
    if (this._trackingEnabled) {
      this._markDirty(entity, componentType._id);
    }
  }

  /**
   * Explicit dirty marking for the get() + direct mutation pattern.
   * @param {number} entity
   * @param {{ _id: number }} componentType
   */
  markDirty(entity, componentType) {
    if (!this._trackingEnabled) return;
    if (!this.has(entity)) return;
    this._markDirty(entity, componentType._id);
  }

  // --- snapshot() / applySnapshot() ---

  /**
   * Returns full serializable state. Respects registry "client-only" policy.
   * @returns {{ entities: Array<{ id: number, components: Record<string, object> }> }}
   */
  snapshot() {
    if (!this._componentRegistry) return this.serialize();

    const entities = [];
    const aliveIds = this._alive.toArray(this._generations, INDEX_BITS);
    for (const id of aliveIds) {
      const index = extractIndex(id);
      const components = {};
      for (const [componentId, entry] of this._stores) {
        if (!entry.membership.has(index)) continue;
        const name = this._componentName(componentId);
        if (!name) continue;
        // Check registry for client-only policy
        const type = this._registry.get(name);
        if (type) {
          const regEntry = this._componentRegistry.get(type);
          if (regEntry && regEntry.diffPolicy === "client-only") continue;
          const data = entry.soa.toObject(index);
          if (regEntry && regEntry.serialize) {
            components[name] = regEntry.serialize(data);
          } else {
            components[name] = data;
          }
        } else {
          components[name] = entry.soa.toObject(index);
        }
      }
      entities.push({ id, components });
    }
    return { entities };
  }

  /**
   * Replace entire world state and clear dirty tracking.
   * @param {{ entities: Array<{ id: number, components: Record<string, object> }> }} data
   */
  applySnapshot(data) {
    this._trackingEnabled = false;
    this.deserialize(data);
    this._trackingEnabled = true;
    this._clearDirty();
    this._lastFlushed.clear();
  }

  // --- flushDiffs() / applyDiff() ---

  /**
   * Build a structured diff from dirty state and clear tracking.
   * @returns {{ entities: Array<{ id: number, op: string, components?: Record<string, object>, removed?: string[] }> }}
   */
  flushDiffs() {
    const entities = [];

    // Entities created AND destroyed in the same frame — skip
    const createdAndDestroyed = new Set();
    for (const id of this._dirtyCreated) {
      if (this._dirtyDestroyed.has(id)) {
        createdAndDestroyed.add(id);
      }
    }

    // op: "add" — created entities (not destroyed)
    for (const id of this._dirtyCreated) {
      if (createdAndDestroyed.has(id)) continue;
      const index = extractIndex(id);
      const components = {};
      for (const [componentId, entry] of this._stores) {
        if (!entry.membership.has(index)) continue;
        const name = this._componentName(componentId);
        if (!name) continue;
        if (this._shouldExcludeFromDiff(name)) continue;
        components[name] = this._serializeComponent(name, entry.soa.toObject(index));
      }
      entities.push({ id, op: "add", components });
    }

    // op: "update" — entities with dirty components or removed components (not created, not destroyed)
    const updatedEntities = new Set();
    for (const entityId of this._dirtyComponents.keys()) {
      if (!this._dirtyCreated.has(entityId) && !this._dirtyDestroyed.has(entityId)) {
        updatedEntities.add(entityId);
      }
    }
    for (const entityId of this._dirtyRemovedComponents.keys()) {
      if (!this._dirtyCreated.has(entityId) && !this._dirtyDestroyed.has(entityId)) {
        updatedEntities.add(entityId);
      }
    }

    for (const id of updatedEntities) {
      const index = extractIndex(id);
      const components = {};
      const removed = [];

      const dirtyCompIds = this._dirtyComponents.get(id);
      if (dirtyCompIds) {
        for (const componentId of dirtyCompIds) {
          const name = this._componentName(componentId);
          if (!name) continue;
          if (this._shouldExcludeFromDiff(name)) continue;

          // Transition policy check
          if (this._componentRegistry) {
            const type = this._registry.get(name);
            if (type) {
              const regEntry = this._componentRegistry.get(type);
              if (regEntry && regEntry.diffPolicy === "transition" && regEntry.equals) {
                const lastKey = `${id}:${componentId}`;
                const last = this._lastFlushed.get(lastKey);
                const entry = this._stores.get(componentId);
                const current = entry && entry.membership.has(index) ? entry.soa.toObject(index) : undefined;
                if (last && current && regEntry.equals(last, current)) continue;
                // Store current as last flushed
                if (current) {
                  this._lastFlushed.set(lastKey, current);
                }
              }
            }
          }

          const entry = this._stores.get(componentId);
          if (entry && entry.membership.has(index)) {
            components[name] = this._serializeComponent(name, entry.soa.toObject(index));
          }
        }
      }

      const removedCompIds = this._dirtyRemovedComponents.get(id);
      if (removedCompIds) {
        for (const componentId of removedCompIds) {
          const name = this._componentName(componentId);
          if (name && !this._shouldExcludeFromDiff(name)) {
            removed.push(name);
          }
        }
      }

      if (Object.keys(components).length > 0 || removed.length > 0) {
        const diffEntry = { id, op: "update", components };
        if (removed.length > 0) diffEntry.removed = removed;
        entities.push(diffEntry);
      }
    }

    // op: "remove" — destroyed entities (not created this frame)
    for (const id of this._dirtyDestroyed) {
      if (createdAndDestroyed.has(id)) continue;
      entities.push({ id, op: "remove" });
    }

    this._clearDirty();
    return { entities };
  }

  /**
   * Check if a component should be excluded from diffs based on registry policy.
   * @param {string} name
   * @returns {boolean}
   */
  _shouldExcludeFromDiff(name) {
    if (!this._componentRegistry) return false;
    const type = this._registry.get(name);
    if (!type) return false;
    const entry = this._componentRegistry.get(type);
    if (!entry) return false;
    return entry.diffPolicy === "snapshot-only" || entry.diffPolicy === "client-only";
  }

  /**
   * Serialize component data using registry or shallow copy.
   * @param {string} name
   * @param {object} data
   * @returns {object}
   */
  _serializeComponent(name, data) {
    if (this._componentRegistry) {
      const type = this._registry.get(name);
      if (type) {
        const entry = this._componentRegistry.get(type);
        if (entry && entry.serialize) {
          return entry.serialize(data);
        }
      }
    }
    return { ...data };
  }

  /**
   * Apply a diff to the world (for client-side reconciliation).
   * Disables dirty tracking during application.
   * @param {{ entities: Array<{ id: number, op: string, components?: Record<string, object>, removed?: string[] }> }} diff
   */
  applyDiff(diff) {
    this._trackingEnabled = false;

    for (const diffEntry of diff.entities) {
      switch (diffEntry.op) {
        case "add": {
          this._createWithId(diffEntry.id);
          if (diffEntry.components) {
            for (const [name, compData] of Object.entries(diffEntry.components)) {
              const type = this._registry.get(name);
              if (type) {
                const deserialized = this._deserializeComponent(name, compData);
                this.add(diffEntry.id, type, deserialized);
              }
            }
          }
          break;
        }

        case "update": {
          if (diffEntry.components) {
            for (const [name, compData] of Object.entries(diffEntry.components)) {
              const type = this._registry.get(name);
              if (!type) continue;
              const storeEntry = this._stores.get(type._id);
              const index = extractIndex(diffEntry.id);
              if (storeEntry && storeEntry.membership.has(index)) {
                const deserialized = this._deserializeComponent(name, compData);
                storeEntry.soa.set(index, deserialized);
              } else {
                // Component is new on this entity
                const deserialized = this._deserializeComponent(name, compData);
                this.add(diffEntry.id, type, deserialized);
              }
            }
          }
          if (diffEntry.removed) {
            for (const name of diffEntry.removed) {
              const type = this._registry.get(name);
              if (type) this.remove(diffEntry.id, type);
            }
          }
          break;
        }

        case "remove": {
          const index = extractIndex(diffEntry.id);
          if (this._alive.has(index) && this._generations[index] === extractGeneration(diffEntry.id)) {
            this._alive.clear(index);
            for (const [componentId, storeEntry] of this._stores) {
              if (storeEntry.membership.has(index)) {
                storeEntry.soa.clear(index);
                storeEntry.membership.clear(index);
                this._queries.invalidate(componentId);
              }
            }
            this._generations[index] = (this._generations[index] + 1) & GENERATION_MASK;
            this._freeIndices.push(index);
          }
          break;
        }
      }
    }

    this._trackingEnabled = true;
  }

  /**
   * Deserialize component data using registry or pass through.
   * @param {string} name
   * @param {object} raw
   * @returns {object}
   */
  _deserializeComponent(name, raw) {
    if (this._componentRegistry) {
      const type = this._registry.get(name);
      if (type) {
        const entry = this._componentRegistry.get(type);
        if (entry && entry.deserialize) {
          return entry.deserialize(raw);
        }
      }
    }
    return raw;
  }
}
