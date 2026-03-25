# node-game-ecs

Lightweight Entity Component System for [node-game-server](https://github.com) game logic. Provides structured entity/component/system management with Struct-of-Arrays (SoA) storage, built-in dirty tracking, structured diffs, and snapshot/restore for wire protocol integration.

## Install

```bash
npm install node-game-ecs
```

## Quick Start

```js
import { World, defineComponent, definePrefab } from "node-game-ecs";

// Define components (schema inferred from defaults: number → Float64Array, string → Array)
const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });

// Or with explicit schema overrides for compact storage
// const Position = defineComponent("Position", { x: 0, y: 0 }, { schema: { x: "f32", y: "f32" } });

// Define prefabs (entity templates)
const PlayerPrefab = definePrefab([
  [Position, { x: 0, y: 0 }],
  [Velocity, { vx: 0, vy: 0 }],
  [Player],
]);

// Create world and spawn from prefab
const world = new World();
const entity = world.spawn(PlayerPrefab, {
  Player: { id: "alice", hue: 42 },
  Position: { x: 100, y: 200 },
});

// Register systems
world.addSystem("movement", (world, ctx) => {
  for (const e of world.query(Position, Velocity)) {
    const pos = world.get(e, Position);
    const vel = world.get(e, Velocity);
    pos.x += vel.vx * ctx.dtMs;
    pos.y += vel.vy * ctx.dtMs;
  }
});

// Run one step
world.step({ dtMs: 16 });
```

## ECS-Aware Diffing

The World tracks all mutations and produces structured diffs for efficient network sync:

```js
import { World, defineComponent, createComponentRegistry } from "node-game-ecs";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });

// Optional: registry for custom serialization and diff policies
const registry = createComponentRegistry();
registry.register(Position, {
  id: 0,
  serialize: (data) => ({ x: data.x, y: data.y }),
  deserialize: (raw) => ({ x: raw.x, y: raw.y }),
});
registry.register(Player, { id: 1 });

const world = new World({ components: [Position, Player], registry });

// Create entities — automatically tracked
const e = world.create();
world.add(e, Player, { id: "alice", hue: 42 });
world.add(e, Position, { x: 100, y: 200 });

// Flush diff (returns structured diff and clears dirty state)
const diff = world.flushDiffs();
// → { entities: [{ id: 0, op: "add", components: { Position: { x: 100, y: 200 }, Player: { ... } } }] }

// Update with dirty tracking
world.set(e, Position, { x: 110 });
const updateDiff = world.flushDiffs();
// → { entities: [{ id: 0, op: "update", components: { Position: { x: 110, y: 200 } } }] }

// Apply diffs on another world (client-side reconciliation)
const clientWorld = new World({ components: [Position, Player], registry });
clientWorld.applyDiff(diff);
clientWorld.applyDiff(updateDiff);

// Snapshots for rollback
const snap = world.snapshot();
clientWorld.applySnapshot(snap);
```

## Storage

Component data is stored in **Struct-of-Arrays (SoA)** layout — one TypedArray per numeric field, indexed by entity slot. Entity membership is tracked with Uint32Array-backed **Bitsets**. The `get()` method returns a Proxy that reads/writes directly to the typed arrays, so the familiar mutable-object API is preserved.

Schema types are inferred from defaults (`number` → `Float64Array`, `boolean` → `Uint8Array`, `string` → plain Array), or set explicitly via `options.schema` (e.g. `"f32"` → `Float32Array`).

## Usage with node-game-server

The ECS World can be used in two modes:

**Mode 1: Plain state (existing)** — Game logic converts ECS to plain state objects for the wire protocol via a `toState()` helper.

**Mode 2: ECS-aware diffing (new)** — The server consumes `world.flushDiffs()` directly, and clients apply diffs via `world.applyDiff()`. This provides entity-level and component-level granularity without double work.

```js
import { World, defineComponent, definePrefab } from "node-game-ecs";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });

const PlayerPrefab = definePrefab([
  [Position, { x: 400, y: 300 }],
  [Player],
]);

const world = new World({ components: [Position, Player] });

// Spawn players from prefab
const e = world.spawn(PlayerPrefab, {
  Player: { id: "alice", hue: 42 },
});

// Update with dirty tracking
world.set(e, Position, { x: 410, y: 300 });

// Produce diff for the wire
const diff = world.flushDiffs();
```

## API

See [docs/api.md](docs/api.md) for the full API reference.

## License

ISC
