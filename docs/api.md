# API Reference

## Exports

```js
import { defineComponent, World } from "node-game-ecs";
```

---

## `defineComponent(name, defaults?)`

Creates a reusable component type.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Unique name, used as serialization key and for debugging |
| `defaults` | `object` | Default field values (optional, defaults to `{}`) |

**Returns:** `ComponentType` — `{ name, defaults, _id }`

- `defaults` is frozen (shallow). Spread when adding: `{ ...defaults, ...overrides }`.
- `_id` is an auto-incrementing integer from a module-level counter.
- ComponentTypes are global value objects — multiple Worlds can share the same types.

```js
const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Tag = defineComponent("Tag"); // no data, just a marker
```

---

## `World`

Core ECS container. Manages entities, components, queries, and systems.

### `new World(options?)`

| Option | Type | Description |
|--------|------|-------------|
| `components` | `ComponentType[]` | Component types for `deserialize()` to look up by name |

Components used with `add()` are auto-registered. The `components` option is only needed if you call `deserialize()` before any `add()`.

---

### Entity Lifecycle

#### `world.create()` → `number`

Create a new entity. Returns an entity ID (generation-based 32-bit integer).

Reuses slots from destroyed entities. The generation counter ensures stale IDs from previous occupants fail `has()`.

#### `world.destroy(id)`

Queue an entity for deferred destruction. The entity remains alive until `step()` flushes the queue.

For immediate removal outside of `step()` (e.g. in game event handlers), call `world._flushDestroy()` after `destroy()`.

#### `world.has(id)` → `boolean`

Check if an entity is alive. Returns `false` for destroyed entities and stale IDs with old generations.

---

### Component Operations

#### `world.add(entity, componentType, overrides?)`

Attach a component to an entity. Data is created as `{ ...componentType.defaults, ...overrides }`.

No-op if the entity is not alive. Auto-registers the component type in the internal registry. Invalidates cached queries involving this component type.

#### `world.remove(entity, componentType)`

Detach a component from an entity. Invalidates cached queries involving this component type.

#### `world.get(entity, componentType)` → `object | undefined`

Get a component's data for an entity. Returns a **mutable reference** to the internal data object — mutations are reflected immediately.

Returns `undefined` if the entity doesn't have the component.

```js
const pos = world.get(entity, Position);
pos.x += 10; // mutates in place
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

Component data is shallow-copied (`{ ...data }`) — the returned object is detached from the world.

#### `world.deserialize(data)`

Clear the world and recreate all entities and components from serialized data. Entity IDs are restored exactly (including generation), so references remain valid.

Requires component types to be registered — either via the `components` constructor option or by having previously used `add()` with those types.

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

## Design Notes

- **Mutable data.** `get()` returns a mutable reference. Systems mutate component data in place for performance. Immutable snapshots are created via `serialize()` or game-specific `toState()` helpers.
- **Deferred destruction.** `destroy()` queues; `step()` flushes. This prevents iterator invalidation during system execution. Outside `step()`, call `_flushDestroy()` explicitly.
- **Flat component data.** Component data should be flat objects with primitive values. Nested objects are not deep-copied by `serialize()` or `add()`.
- **No bitmasks.** With <1,000 entities and <30 component types, `Map.has()` is negligible vs network I/O. The query API is designed so bitmasks can be added internally later without changing the public surface.
