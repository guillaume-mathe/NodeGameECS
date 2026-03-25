# API Reference

## Exports

```js
import { defineComponent, definePrefab, World, createComponentRegistry, Bitset, SoAStore } from "node-game-ecs";
```

---

## `defineComponent(name, defaults?, options?)`

Creates a reusable component type.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Unique name, used as serialization key and for debugging |
| `defaults` | `object` | Default field values (optional, defaults to `{}`) |
| `options` | `object` | Optional configuration (see below) |

**Options:**

| Field | Type | Description |
|-------|------|-------------|
| `schema` | `Record<string, string>` | Per-field type overrides for SoA storage. Keys are field names, values are type strings: `"f32"` (`Float32Array`), `"f64"` (`Float64Array`), `"i32"` (`Int32Array`), `"u8"` (`Uint8Array`), `"i16"` (`Int16Array`), `"u16"` (`Uint16Array`), `"string"` (plain Array). When omitted, types are inferred from defaults: `number` → `f64`, `boolean` → `u8`, `string` → `string`. |

**Returns:** `ComponentType` — `{ name, defaults, _id, _fields, _schema }`

- `defaults` is frozen (shallow). Spread when adding: `{ ...defaults, ...overrides }`.
- `_id` is an auto-incrementing integer from a module-level counter.
- `_fields` is an array of field name strings.
- `_schema` maps each field to `{ type, Ctor, jsType }` where `type` is the storage type string, `Ctor` is the TypedArray constructor (or `null` for strings), and `jsType` is the original JavaScript type.
- ComponentTypes are global value objects — multiple Worlds can share the same types.

```js
const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Tag = defineComponent("Tag"); // no data, just a marker

// Explicit schema: use Float32Array instead of the default Float64Array
const CompactPos = defineComponent("CompactPos", { x: 0, y: 0 }, { schema: { x: "f32", y: "f32" } });
```

---

## `definePrefab(components)`

Creates a reusable entity template (archetype).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `components` | `[ComponentType, object?][]` | Array of `[componentType, overrides?]` pairs |

**Returns:** `Prefab` — `{ components }`

```js
const PlayerPrefab = definePrefab([
  [Position, { x: 0, y: 0 }],
  [Velocity],
  [Player],
]);

const BombPrefab = definePrefab([
  [Position],
  [Bomb, { timer: 3, range: 2 }],
]);
```

Prefabs are used with `world.spawn()` to create entities from templates. See [Prefabs](#prefabs) below.

---

## `createComponentRegistry()`

Creates a component registry for controlling serialization and diff policies.

**Returns:** `ComponentRegistry`

```js
const registry = createComponentRegistry();
registry.register(Position, {
  id: 0,
  serialize: (data) => ({ x: data.x, y: data.y }),
  deserialize: (raw) => ({ x: raw.x, y: raw.y }),
  diffPolicy: "always",
});
```

See [Component Registry](#component-registry) below for full API.

---

## `World`

Core ECS container. Manages entities, components, queries, systems, dirty tracking, and diffs.

### `new World(options?)`

| Option | Type | Description |
|--------|------|-------------|
| `components` | `ComponentType[]` | Component types for `deserialize()`/`applyDiff()` to look up by name |
| `registry` | `ComponentRegistry` | Optional component registry for diff policies and custom serialization |

Components used with `add()` are auto-registered. The `components` option is only needed if you call `deserialize()` or `applyDiff()` before any `add()`.

---

### Entity Lifecycle

#### `world.create()` → `number`

Create a new entity. Returns an entity ID (generation-based 32-bit integer). Marks the entity as dirty (tracked by `flushDiffs()`).

Reuses slots from destroyed entities. The generation counter ensures stale IDs from previous occupants fail `has()`.

#### `world.destroy(id)`

Queue an entity for deferred destruction. The entity remains alive until `step()` flushes the queue. Destroyed entities appear in `flushDiffs()` with `op: "remove"`.

For immediate removal outside of `step()` (e.g. in game event handlers), call `world._flushDestroy()` after `destroy()`.

#### `world.has(id)` → `boolean`

Check if an entity is alive. Returns `false` for destroyed entities and stale IDs with old generations.

---

### Component Operations

#### `world.add(entity, componentType, overrides?)`

Attach a component to an entity. Data is created as `{ ...componentType.defaults, ...overrides }`.

No-op if the entity is not alive. Auto-registers the component type in the internal registry. Invalidates cached queries involving this component type. Marks the entity+component as dirty.

#### `world.remove(entity, componentType)`

Detach a component from an entity. Invalidates cached queries involving this component type. Tracks the removal for `flushDiffs()`.

#### `world.get(entity, componentType)` → `Proxy | undefined`

Get a component's data for an entity. Returns a **Proxy** that reads and writes directly to the underlying SoA (Struct-of-Arrays) typed arrays. Property access and assignment work like a normal object, preserving the mutable-reference API while storing data in cache-friendly columnar layout.

Returns `undefined` if the entity doesn't have the component.

The proxy supports:
- Property get/set for all fields defined in the component type
- `ownKeys` / spread (`{ ...proxy }`) — returns all field names
- `toJSON()` — returns a detached plain object (used by `JSON.stringify`)
- Boolean fields are coerced from the underlying `Uint8Array` (0/1) to `true`/`false`

**Note:** Direct mutations via `get()` are not automatically tracked. Use `set()` for tracked mutations, or call `markDirty()` after mutating via `get()`.

```js
const pos = world.get(entity, Position);
pos.x += 10; // mutates in place, but NOT tracked
world.markDirty(entity, Position); // explicitly mark dirty
```

#### `world.set(entity, componentType, changes)`

Partial update of a component's data with automatic dirty tracking. Writes only the provided fields to the underlying SoA arrays.

No-op if the entity doesn't have the component. When a registry with `"transition"` diff policy is configured, checks the `equals` function before marking dirty.

```js
world.set(entity, Position, { x: 42 }); // tracked automatically
```

#### `world.markDirty(entity, componentType)`

Explicitly mark an entity+component as dirty. Use this after mutating data obtained via `get()`.

No-op if the entity is not alive or if dirty tracking is disabled.

```js
const pos = world.get(entity, Position);
pos.x += vel.vx * dt;
pos.y += vel.vy * dt;
world.markDirty(entity, Position);
```

---

### Prefabs

#### `world.spawn(prefab, overrides?)` → `number`

Create an entity from a prefab template. Returns the new entity ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prefab` | `Prefab` | Prefab created by `definePrefab()` |
| `overrides` | `Record<string, object>` | Optional per-component overrides keyed by component name |

Overrides are merged with the prefab's defaults: `{ ...prefabDefaults, ...overrides[name] }`.

```js
const PlayerPrefab = definePrefab([
  [Position, { x: 0, y: 0 }],
  [Player, { id: "", hue: 0 }],
]);

const e = world.spawn(PlayerPrefab, {
  Position: { x: 100, y: 200 },
  Player: { id: "alice", hue: 42 },
});
```

---

### Queries

#### `world.query(...componentTypes)` → `number[]`

Returns an array of entity IDs that have **all** listed component types.

Results are cached — the same array reference is returned until a relevant component is added or removed. The query iterates the smallest component store and checks `.has()` on the others.

```js
for (const entity of world.query(Position, Velocity)) {
  const pos = world.get(entity, Position);
  const vel = world.get(entity, Velocity);
  pos.x += vel.vx;
  pos.y += vel.vy;
}
```

---

### Systems

#### `world.addSystem(fn)` / `world.addSystem(name, fn)`

Register a system function. Systems run in insertion order during `step()`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Optional name for removal by name |
| `fn` | `(world: World, ctx: object) => void` | System function |

```js
world.addSystem("movement", (world, ctx) => {
  for (const e of world.query(Position, Velocity)) {
    const pos = world.get(e, Position);
    const vel = world.get(e, Velocity);
    pos.x += vel.vx * ctx.dtMs;
    pos.y += vel.vy * ctx.dtMs;
  }
});
```

#### `world.removeSystem(nameOrFn)`

Remove a system by its name (string) or function reference.

#### `world.step(ctx)`

Run all registered systems in order, passing `ctx` as the second argument to each. After all systems have run, flushes deferred entity destroys.

---

### Serialization

#### `world.serialize()` → `object`

Serialize the entire world to a plain object:

```js
{
  entities: [
    { id: 42, components: { Position: { x: 10, y: 20 }, Player: { id: "alice", hue: 42 } } },
    // ...
  ]
}
```

Component data is extracted from SoA stores into detached plain objects — the returned object is independent of the world.

#### `world.deserialize(data)`

Clear the world and recreate all entities and components from serialized data. Entity IDs are restored exactly (including generation), so references remain valid.

Requires component types to be registered — either via the `components` constructor option or by having previously used `add()` with those types.

---

### Snapshots

#### `world.snapshot()` → `object`

Returns a full serializable state of all entities and components. Same format as `serialize()`.

When a component registry is attached, respects diff policies: `"client-only"` components are excluded. Uses custom `serialize` functions if registered.

#### `world.applySnapshot(data)`

Replace the entire world state from a snapshot. Clears all existing entities and components, then recreates from the data. Clears dirty tracking — a subsequent `flushDiffs()` returns an empty diff.

Does not trigger dirty tracking during application.

---

### Diffs

#### `world.flushDiffs()` → `object`

Build a structured diff from all mutations since the last `flushDiffs()` call, then clear the dirty state.

**Diff format:**

```js
{
  entities: [
    { id: 7, op: "add", components: { Position: { x: 100, y: 200 }, Player: { ... } } },
    { id: 3, op: "update", components: { Position: { x: 105, y: 200 } }, removed: ["Velocity"] },
    { id: 12, op: "remove" },
  ]
}
```

**Operations:**

| `op` | Meaning | Fields |
|------|---------|--------|
| `"add"` | Entity created this frame | `components` — all components on the entity |
| `"update"` | Entity had components added, changed, or removed | `components` — changed component data; `removed` — removed component names (optional) |
| `"remove"` | Entity destroyed this frame | (none) |

**Special cases:**
- Entities created and destroyed in the same frame are excluded (no diff entry).
- A second `flushDiffs()` call with no intervening mutations returns `{ entities: [] }`.

**Registry integration:** When a component registry is attached, `flushDiffs()` respects diff policies (`"snapshot-only"` and `"client-only"` components are excluded), uses custom `serialize` functions, and applies `"transition"` policy equality checks.

#### `world.applyDiff(diff)`

Apply a diff to the world. Used for client-side reconciliation.

- `op: "add"` — creates the entity at the specified ID and adds all components.
- `op: "update"` — updates existing component data via `Object.assign`; adds new components; removes listed components.
- `op: "remove"` — immediately destroys the entity (not deferred).

Does not trigger dirty tracking during application — a subsequent `flushDiffs()` will not include changes from `applyDiff()`.

When a component registry is attached, uses custom `deserialize` functions.

---

## Component Registry

Created via `createComponentRegistry()`. Passed to `World` constructor as the `registry` option.

### `registry.register(componentType, config?)`

Register a component type with optional serialization and diff policy config.

| Config field | Type | Default | Description |
|-------------|------|---------|-------------|
| `id` | `number` | `componentType._id` | Numeric ID for codec use (e.g. Cap'n Proto) |
| `serialize` | `(data) => object` | `null` (shallow copy) | Custom serialization function |
| `deserialize` | `(raw) => object` | `null` (pass-through) | Custom deserialization function |
| `diffPolicy` | `string` | `"always"` | Diff behavior — see [Diff Policies](#diff-policies) |
| `equals` | `(a, b) => boolean` | `null` | Equality check for `"transition"` policy |

### `registry.get(componentType)` → `entry | undefined`

Look up by component type object.

### `registry.getById(numericId)` → `entry | undefined`

Look up by the numeric `id` from `register()`.

### `registry.getByName(name)` → `entry | undefined`

Look up by component name string.

### `registry[Symbol.iterator]()`

Iterate all registered entries.

```js
for (const entry of registry) {
  console.log(entry.componentType.name, entry.diffPolicy);
}
```

### Diff Policies

| Policy | Behavior |
|--------|----------|
| `"always"` | Include in diff whenever the component is dirty (default) |
| `"transition"` | Include only when `equals(prev, curr)` returns `false`. Requires an `equals` function. `set()` checks equality before marking dirty; `flushDiffs()` compares against last-flushed values for components marked dirty via `markDirty()` |
| `"snapshot-only"` | Excluded from per-tick diffs (`flushDiffs()`), included in snapshots (`snapshot()`) |
| `"client-only"` | Never serialized — excluded from both diffs and snapshots. The component exists only in the local ECS world |

---

## Entity IDs

Entity IDs encode a slot index and generation in a single 32-bit integer:

| Bits | Field | Range |
|------|-------|-------|
| 0–19 | Slot index | 0 – 1,048,575 |
| 20–31 | Generation | 0 – 4,095 |

When an entity is destroyed and its slot recycled, the generation increments. Code holding a stale ID with an old generation will see `has()` return `false`.

```js
const e1 = world.create();  // slot 0, gen 0 → id 0
world.destroy(e1);
world.step({});
const e2 = world.create();  // slot 0, gen 1 → id 1048576
world.has(e1);               // false (gen mismatch)
world.has(e2);               // true
```

---

## Storage Architecture

Component data is stored in **Struct-of-Arrays (SoA)** layout. Each component type gets one TypedArray per numeric/boolean field and one plain Array per string field, all indexed by entity slot index. This provides cache-friendly memory access patterns for systems iterating over many entities.

Entity membership is tracked with **Bitsets** — fixed-capacity bit arrays backed by `Uint32Array`. There is one global "alive" bitset and one per-component-type membership bitset. Queries iterate the smallest membership bitset (by popcount) and check `.has()` on the rest.

The `get()` method returns a `Proxy` that reads/writes directly to the underlying typed arrays, preserving the familiar mutable-object API while keeping the columnar storage layout.

---

## `Bitset`

Fixed-capacity bitset backed by `Uint32Array`. Used internally for entity alive tracking and per-component membership. Exported for advanced use cases.

### `new Bitset(capacity)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `capacity` | `number` | Maximum number of bits |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `set(index)` | — | Set bit at index |
| `clear(index)` | — | Clear bit at index |
| `has(index)` | `boolean` | Test bit at index |
| `grow(newCapacity)` | — | Grow to new capacity, preserving existing bits |
| `clearAll()` | — | Clear all bits |
| `count()` | `number` | Population count (number of set bits) |
| `toArray(generations, indexBits)` | `number[]` | Extract set bit indices as entity IDs using generation lookup |

---

## `SoAStore`

Struct-of-Arrays storage for a single component type. One TypedArray per numeric/boolean field, one plain Array per string field, all indexed by entity slot index. Exported for advanced use cases.

### `new SoAStore(componentType, capacity)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `componentType` | `ComponentType` | The component type (must have `_fields`, `_schema`, `defaults`) |
| `capacity` | `number` | Initial slot capacity |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `set(slotIndex, data)` | — | Write field values from a data object (only writes fields present in `data`) |
| `getField(slotIndex, fieldName)` | `*` | Read a single field value |
| `setField(slotIndex, fieldName, value)` | — | Set a single field value |
| `toObject(slotIndex)` | `object` | Read all fields into a detached plain object |
| `clear(slotIndex)` | — | Reset slot to component defaults |
| `grow(newCapacity)` | — | Grow all arrays, preserving existing data |

---

## Design Notes

- **SoA storage.** Component data is stored in columnar TypedArrays (one per field) rather than as individual objects. This gives better cache locality when systems iterate a single field across many entities, and allows schema control over numeric precision (e.g. `f32` vs `f64`).
- **Proxy access.** `get()` returns a Proxy that reads/writes directly to the SoA arrays. Systems mutate component data in place via the proxy for performance. Use `set()` or `markDirty()` to track mutations for diffing. Immutable snapshots are created via `snapshot()` or `serialize()`.
- **Bitset membership.** Entity aliveness and per-component membership are tracked with Uint32Array-backed bitsets. Queries iterate the smallest bitset and intersect against the rest. This replaces the earlier Map-based approach.
- **Deferred destruction.** `destroy()` queues; `step()` flushes. This prevents iterator invalidation during system execution. Outside `step()`, call `_flushDestroy()` explicitly.
- **Flat component data.** Component data should be flat objects with primitive values. Nested objects are not supported by the SoA storage layer.
- **Backward compatible.** All new features (SoA storage, dirty tracking, diffs, snapshots, registry, prefabs) are additive. Existing code using `create()`/`add()`/`get()`/`serialize()` continues to work unchanged. The dirty tracking runs automatically; call `flushDiffs()` only when you need diffs.
