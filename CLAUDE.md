# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lightweight Entity Component System (ECS) library designed for use with `node-game-server` game logic. Provides structured entity/component/system management while remaining compatible with the existing wire protocol — the ECS World is a mutable internal representation, and game logic serializes it into plain state objects for the wire.

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

`defineComponent(name, defaults)` returns a `ComponentType` object with `name`, `defaults` (frozen), and `_id` (auto-incrementing module-level counter). ComponentTypes are global value objects — multiple Worlds can share the same types.

### World (`src/World.js`)

Core ECS container. All game state lives here as mutable component data.

- **Entity IDs** — generation-based 32-bit integers: bits 0–19 = slot index (up to 1,048,576), bits 20–31 = generation (4,096 before wrap). Stale IDs with old generations fail `has()`.
- **Entity lifecycle** — `create()` pops from free list or allocates fresh slot; `destroy(id)` queues for deferred removal (flushed at end of `step()`); `has(id)` checks alive set
- **Component ops** — `add(entity, type, overrides?)` attaches `{ ...defaults, ...overrides }`; `remove(entity, type)` detaches; `get(entity, type)` returns mutable data reference
- **Queries** — `query(...componentTypes)` returns cached `number[]` of entity IDs, invalidated on add/remove
- **Systems** — `addSystem(name?, fn)` registers in insertion order; `removeSystem(nameOrFn)`; `step(ctx)` runs all systems then flushes deferred destroys
- **Serialization** — `serialize()` returns detached shallow copies; `deserialize(data)` clears world and recreates entities at their original IDs via `_createWithId(id)`

Storage: `Map<componentId, Map<entityId, data>>` — one sparse map per component type.

### Query Cache (`src/Query.js`)

Internal to World, not exported. Cache key = sorted component `_id`s joined as string. Iterates the smallest store and checks `.has()` on the rest. Reverse index (`Map<componentId, Set<queryKey>>`) for efficient invalidation when components are added or removed.

### Wire Protocol Integration

The ECS doesn't replace the wire protocol state format — it provides a structured way to manage data that gets serialized into it. Game logic implements a `toState()` helper that queries entities and builds the plain `{ frame, timeMs, players }` object the server expects:

```js
function toState(world, ctx) {
  const players = world.query(Player).map((e) => ({
    ...world.get(e, Player),
    ...world.get(e, Position),
  }));
  return { frame: ctx.frame, timeMs: ..., players };
}
```

The server's wire protocol uses:
- **State structure:** `{ frame, timeMs, players: [{ id, ...fields }] }` — players array with `id` field is required
- **Reserved keys** (must not appear in game state): `kind`, `frame`, `baseFrame`, `timeMs`, `added`, `removed`, `updated`, `_removedKeys`
- **Deferred destruction caveat:** `destroy()` is deferred to `step()`, but `onGameEvent` (DISCONNECT) runs outside of `step()`. Call `world._flushDestroy()` explicitly in event handlers that need immediate removal.

## Conventions

- ES modules (`"type": "module"`)
- JSDoc for public API documentation
- camelCase for methods/variables, CONSTANT_CASE for module-level constants
- Private methods prefixed with `_`
- Tests use vitest
- Component data should be flat (primitives only) — nested objects require game-code to handle deep copying
