# node-game-ecs

Lightweight Entity Component System for [node-game-server](https://github.com) game logic. Provides structured entity/component/system management while remaining compatible with the existing wire protocol.

## Install

```bash
npm install node-game-ecs
```

## Quick Start

```js
import { World, defineComponent } from "node-game-ecs";

// Define components
const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });

// Create world and entities
const world = new World();

const entity = world.create();
world.add(entity, Player, { id: "alice", hue: 42 });
world.add(entity, Position, { x: 100, y: 200 });
world.add(entity, Velocity, { vx: 1, vy: -1 });

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

## Usage with node-game-server

The ECS World is a mutable internal representation. Game logic uses it for organization, but `tick()` and `onGameEvent()` still return plain state objects for the wire protocol:

```js
import { World, defineComponent } from "node-game-ecs";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });

const world = new World();

function toState(state, ctx) {
  const players = world.query(Player).map((e) => ({
    ...world.get(e, Player),
    ...world.get(e, Position),
  }));
  return { frame: ctx.frame, timeMs: state.timeMs + ctx.dtMs, players };
}

const logic = {
  createInitialState() {
    return { frame: 0, timeMs: 0, players: [] };
  },

  tick(state, actions, ctx) {
    for (const a of actions) {
      if (a.type === "MOVE") {
        const entity = findPlayer(a.playerId);
        if (entity === undefined) continue;
        const pos = world.get(entity, Position);
        pos.x += a.dx ?? 0;
        pos.y += a.dy ?? 0;
      }
    }
    return toState(state, ctx);
  },

  onGameEvent(state, event) {
    if (event.type === "CONNECT") {
      const e = world.create();
      world.add(e, Player, { id: event.playerId, hue: Math.random() * 360 });
      world.add(e, Position, { x: 400, y: 300 });
    }
    if (event.type === "DISCONNECT") {
      const e = findPlayer(event.playerId);
      if (e !== undefined) {
        world.destroy(e);
        world._flushDestroy();
      }
    }
    return toState(state, { frame: state.frame, dtMs: 0 });
  },
};

function findPlayer(playerId) {
  for (const e of world.query(Player)) {
    if (world.get(e, Player).id === playerId) return e;
  }
  return undefined;
}
```

## API

See [docs/api.md](docs/api.md) for the full API reference.

## License

ISC
