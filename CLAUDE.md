# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lightweight Entity Component System (ECS) library designed for use with `node-game-server` game logic. Provides structured entity/component/system management with built-in dirty tracking, structured diffs, and snapshot/restore for wire protocol integration.

Part of a four-project game stack:
- **NodeGameServer** (sibling) — authoritative game server with tick-based simulation
- **NodeGameClient** (sibling) — browser client library (connection, interpolation, input, prediction)
- **NodeGameInputManager** (sibling) — intent-based input abstraction (keyboard/gamepad → MOVE_X, MOVE_Y)
- **NodeGameECS** (this repo) — lightweight ECS for game logic

Requires Node.js >= 22.

## Commands

### Run tests

```bash
npm test
```

Runs `vitest run` — all tests in `test/`.

### Build

```bash
npm run build
```

Produces ESM + IIFE bundles in `dist/` and TypeScript declarations via esbuild + tsc.

## Architecture

### Component (`src/Component.js`)

`defineComponent(name, defaults, options?)` returns a `ComponentType` object with `name`, `defaults` (frozen), `_id` (auto-incrementing module-level counter), `_fields` (field name array), and `_schema` (per-field type/TypedArray constructor mapping). Schema is inferred from defaults: `number` → `Float64Array`, `boolean` → `Uint8Array`, `string` → plain Array. Explicit schema overrides via `options.schema` (e.g. `{ x: "f32" }` → `Float32Array`). ComponentTypes are global value objects — multiple Worlds can share the same types.

### Prefab (`src/Prefab.js`)

`definePrefab(components)` creates a reusable entity template. `components` is an array of `[ComponentType, overrides?]` pairs. Used with `world.spawn(prefab, overrides?)` to create entities from templates.

### Component Registry (`src/ComponentRegistry.js`)

`createComponentRegistry()` creates a registry for controlling serialization and diff policies per component type. Supports `register()`, `get()`, `getById()`, `getByName()`, and `[Symbol.iterator]()`. Diff policies: `"always"` (default), `"transition"`, `"snapshot-only"`, `"client-only"`.

### World (`src/World.js`)

Core ECS container. All game state lives here as mutable component data.

- **Entity IDs** — generation-based 32-bit integers: bits 0–19 = slot index (up to 1,048,576), bits 20–31 = generation (4,096 before wrap). Stale IDs with old generations fail `has()`.
- **Entity lifecycle** — `create()` pops from free list or allocates fresh slot; `destroy(id)` queues for deferred removal (flushed at end of `step()`); `has(id)` checks alive set
- **Prefabs** — `spawn(prefab, overrides?)` creates an entity from a `definePrefab()` template with optional per-component overrides
- **Component ops** — `add(entity, type, overrides?)` writes `{ ...defaults, ...overrides }` to SoA store; `remove(entity, type)` clears slot and membership; `get(entity, type)` returns a Proxy that reads/writes through to SoA arrays; `set(entity, type, changes)` partial update with dirty tracking; `markDirty(entity, type)` explicit dirty marking
- **Dirty tracking** — all mutations (`create`, `add`, `remove`, `set`, `destroy`) are tracked automatically. `_dirtyCreated`, `_dirtyDestroyed`, `_dirtyComponents`, `_dirtyRemovedComponents` sets/maps. Tracking is suppressed during `applyDiff()`/`applySnapshot()` via `_trackingEnabled` flag.
- **Diffs** — `flushDiffs()` returns structured diff (`{ entities: [{ id, op, components?, removed? }] }`) and clears dirty state; `applyDiff(diff)` applies diffs to the world (for client reconciliation)
- **Snapshots** — `snapshot()` returns full serializable state (respects registry policies); `applySnapshot(data)` replaces world state and clears dirty tracking
- **Queries** — `query(...componentTypes)` returns cached `number[]` of entity IDs, invalidated on add/remove
- **Systems** — `addSystem(name?, fn)` registers in insertion order; `removeSystem(nameOrFn)`; `step(ctx)` runs all systems then flushes deferred destroys
- **Serialization** — `serialize()` returns detached shallow copies; `deserialize(data)` clears world and recreates entities at their original IDs via `_createWithId(id)`

Storage: Struct-of-Arrays (SoA) — `Map<componentId, { soa: SoAStore, membership: Bitset }>`. Each `SoAStore` holds one TypedArray per numeric field and one plain Array per string field, indexed by entity slot index. Entity aliveness tracked by a `Bitset`, generations by `Uint16Array`. The `get()` method returns a `Proxy` that reads/writes directly to the underlying typed arrays — this preserves the mutable-reference API while storing data in cache-friendly columnar layout.

### Bitset (`src/Bitset.js`)

Fixed-capacity bitset backed by `Uint32Array`. Used for entity alive tracking and per-component membership. Supports `set`, `clear`, `has`, `grow`, `clearAll`, `count` (popcount), and `toArray(generations, indexBits)` to reconstruct entity IDs from set bits.

### SoAStore (`src/SoAStore.js`)

Struct-of-Arrays storage for a single component type. One TypedArray per numeric/boolean field, one plain Array per string field, all indexed by entity slot index. Supports `set(slot, data)`, `getField`, `setField`, `toObject` (detached copy), `clear` (reset to defaults), and `grow`.

### Query Cache (`src/Query.js`)

Internal to World, not exported. Cache key = sorted component `_id`s joined as string. Iterates the smallest membership Bitset (by popcount) and checks `.has()` on the rest. Reconstructs entity IDs from slot indices and generation array. Reverse index (`Map<componentId, Set<queryKey>>`) for efficient invalidation when components are added or removed.

### Wire Protocol Integration

The ECS supports two integration modes with the server wire protocol:

**Mode 1: Plain state (legacy)** — Game logic implements a `toState()` helper that queries entities and builds the plain `{ frame, timeMs, players }` object the server expects.

**Mode 2: ECS-aware diffing** — The server consumes `world.flushDiffs()` directly, and clients apply diffs via `world.applyDiff()`. Snapshots via `world.snapshot()`/`world.applySnapshot()` for rollback. Component registry controls serialization and diff policies per component type.

Notes:
- **Deferred destruction caveat:** `destroy()` is deferred to `step()`, but `onGameEvent` (DISCONNECT) runs outside of `step()`. Call `world._flushDestroy()` explicitly in event handlers that need immediate removal.

## Conventions

- ES modules (`"type": "module"`)
- JSDoc for public API documentation
- camelCase for methods/variables, CONSTANT_CASE for module-level constants
- Private methods prefixed with `_`
- Tests use vitest
- Component data should be flat (primitives only) — nested objects require game-code to handle deep copying
