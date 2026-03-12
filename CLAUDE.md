# CLAUDE.md

## Project Overview

Lightweight Entity Component System (ECS) library designed for use with `node-game-server` game logic. Provides structured entity/component/system management while remaining compatible with the existing wire protocol — the ECS World is a mutable internal representation, and game logic serializes it into plain state objects for the wire.

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

Produces ESM + IIFE bundles in `dist/` and TypeScript declarations.

## Architecture

### Component (`src/Component.js`)

`defineComponent(name, defaults)` returns a `ComponentType` object with `name`, `defaults` (frozen), and `_id` (auto-incrementing). ComponentTypes are global value objects shared across Worlds.

### World (`src/World.js`)

Core ECS container:
- **Entity IDs** — generation-based 32-bit integers: bits 0–19 = slot index, bits 20–31 = generation
- **Entity lifecycle** — `create()`, `destroy(id)` (deferred), `has(id)`
- **Component ops** — `add(entity, type, overrides?)`, `remove(entity, type)`, `get(entity, type)`, component `has(entity, type)`
- **Queries** — `query(...componentTypes)` returns cached `number[]`, invalidated on add/remove
- **Systems** — `addSystem(name?, fn)`, `removeSystem(nameOrFn)`, `step(ctx)` runs systems then flushes deferred destroys
- **Serialization** — `serialize()` / `deserialize(data)` for snapshots

Storage: `Map<componentId, Map<entityId, data>>` — one sparse map per component type.

### Query Cache (`src/Query.js`)

Internal to World. Cache key = sorted component `_id`s. Iterates smallest store, checks `.has()` on others. Reverse index for efficient invalidation on add/remove.

## Conventions

- ES modules (`"type": "module"`)
- JSDoc for public API documentation
- camelCase for methods/variables, CONSTANT_CASE for module-level constants
- Tests use vitest
- Component data should be flat (primitives only)
