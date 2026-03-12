import { describe, it, expect } from "vitest";
import { World } from "../src/World.js";
import { defineComponent } from "../src/Component.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });
const Tag = defineComponent("Tag");

describe("World — entity lifecycle", () => {
  it("create() returns an entity ID", () => {
    const world = new World();
    const e = world.create();
    expect(typeof e).toBe("number");
    expect(world.has(e)).toBe(true);
  });

  it("destroy() + step() removes the entity", () => {
    const world = new World();
    const e = world.create();
    world.destroy(e);
    expect(world.has(e)).toBe(true); // still alive before flush
    world.step({});
    expect(world.has(e)).toBe(false);
  });

  it("destroyed entity ID is no longer valid after slot recycling", () => {
    const world = new World();
    const e1 = world.create();
    world.destroy(e1);
    world.step({});

    const e2 = world.create(); // reuses slot, different generation
    expect(world.has(e1)).toBe(false);
    expect(world.has(e2)).toBe(true);
    expect(e1).not.toBe(e2);
  });

  it("destroy() on a dead entity is a no-op", () => {
    const world = new World();
    const e = world.create();
    world.destroy(e);
    world.step({});
    world.destroy(e); // should not throw
    world.step({});
  });

  it("creates multiple entities with unique IDs", () => {
    const world = new World();
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(world.create());
    }
    expect(ids.size).toBe(100);
  });
});

describe("World — component operations", () => {
  it("add and get a component", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position, { x: 10, y: 20 });
    const pos = world.get(e, Position);
    expect(pos).toEqual({ x: 10, y: 20 });
  });

  it("add uses defaults when no overrides given", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position);
    expect(world.get(e, Position)).toEqual({ x: 0, y: 0 });
  });

  it("get returns undefined for missing component", () => {
    const world = new World();
    const e = world.create();
    expect(world.get(e, Position)).toBeUndefined();
  });

  it("get returns a mutable reference", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    const pos = world.get(e, Position);
    pos.x = 99;
    expect(world.get(e, Position).x).toBe(99);
  });

  it("remove detaches a component", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position);
    world.remove(e, Position);
    expect(world.get(e, Position)).toBeUndefined();
  });

  it("add to a dead entity is a no-op", () => {
    const world = new World();
    const e = world.create();
    world.destroy(e);
    world.step({});
    world.add(e, Position);
    expect(world.get(e, Position)).toBeUndefined();
  });

  it("destroy removes all components", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, Velocity, { vx: 3, vy: 4 });
    world.destroy(e);
    world.step({});
    expect(world.get(e, Position)).toBeUndefined();
    expect(world.get(e, Velocity)).toBeUndefined();
  });
});

describe("World — queries", () => {
  it("query returns entities with all matching components", () => {
    const world = new World();
    const e1 = world.create();
    world.add(e1, Position);
    world.add(e1, Velocity);

    const e2 = world.create();
    world.add(e2, Position);

    const result = world.query(Position, Velocity);
    expect(result).toEqual([e1]);
  });

  it("query returns cached result", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position);

    const first = world.query(Position);
    const second = world.query(Position);
    expect(first).toBe(second);
  });

  it("query cache invalidates on add", () => {
    const world = new World();
    const e1 = world.create();
    world.add(e1, Position);

    const first = world.query(Position);
    expect(first).toEqual([e1]);

    const e2 = world.create();
    world.add(e2, Position);

    const second = world.query(Position);
    expect(second.sort()).toEqual([e1, e2].sort());
    expect(first).not.toBe(second);
  });

  it("query cache invalidates on remove", () => {
    const world = new World();
    const e1 = world.create();
    world.add(e1, Position);
    const e2 = world.create();
    world.add(e2, Position);

    world.query(Position); // populate cache
    world.remove(e1, Position);

    expect(world.query(Position)).toEqual([e2]);
  });

  it("empty query returns empty array", () => {
    const world = new World();
    world.create();
    expect(world.query(Position)).toEqual([]);
  });
});

describe("World — systems", () => {
  it("step() runs systems in order", () => {
    const world = new World();
    const order = [];
    world.addSystem("first", () => order.push(1));
    world.addSystem("second", () => order.push(2));
    world.step({});
    expect(order).toEqual([1, 2]);
  });

  it("systems receive world and ctx", () => {
    const world = new World();
    let captured;
    world.addSystem("test", (w, ctx) => {
      captured = { w, ctx };
    });
    const ctx = { dtMs: 16 };
    world.step(ctx);
    expect(captured.w).toBe(world);
    expect(captured.ctx).toBe(ctx);
  });

  it("removeSystem by name", () => {
    const world = new World();
    let called = false;
    world.addSystem("sys", () => { called = true; });
    world.removeSystem("sys");
    world.step({});
    expect(called).toBe(false);
  });

  it("removeSystem by function reference", () => {
    const world = new World();
    let called = false;
    const fn = () => { called = true; };
    world.addSystem(fn);
    world.removeSystem(fn);
    world.step({});
    expect(called).toBe(false);
  });

  it("step() flushes deferred destroys after systems run", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position);

    world.addSystem("destroyer", (w) => {
      // Entity should still be alive during system execution
      expect(w.has(e)).toBe(true);
      w.destroy(e);
    });

    world.step({});
    expect(world.has(e)).toBe(false);
  });

  it("movement system example works correctly", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, { vx: 10, vy: 5 });

    world.addSystem("movement", (w, ctx) => {
      for (const entity of w.query(Position, Velocity)) {
        const pos = w.get(entity, Position);
        const vel = w.get(entity, Velocity);
        pos.x += vel.vx * ctx.dtMs;
        pos.y += vel.vy * ctx.dtMs;
      }
    });

    world.step({ dtMs: 0.016 });
    const pos = world.get(e, Position);
    expect(pos.x).toBeCloseTo(0.16);
    expect(pos.y).toBeCloseTo(0.08);
  });
});

describe("World — serialization", () => {
  it("serialize produces a snapshot", () => {
    const world = new World({ components: [Position, Player] });
    const e = world.create();
    world.add(e, Position, { x: 5, y: 10 });
    world.add(e, Player, { id: "p1", hue: 180 });

    const data = world.serialize();
    expect(data.entities).toHaveLength(1);
    expect(data.entities[0].id).toBe(e);
    expect(data.entities[0].components.Position).toEqual({ x: 5, y: 10 });
    expect(data.entities[0].components.Player).toEqual({ id: "p1", hue: 180 });
  });

  it("serialize returns detached copies", () => {
    const world = new World();
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });

    const data = world.serialize();
    data.entities[0].components.Position.x = 999;
    expect(world.get(e, Position).x).toBe(1);
  });

  it("deserialize restores world state", () => {
    const world = new World({ components: [Position, Player] });
    const e = world.create();
    world.add(e, Position, { x: 5, y: 10 });
    world.add(e, Player, { id: "p1", hue: 120 });

    const data = world.serialize();

    // Deserialize into a fresh world with the same component registry
    const world2 = new World({ components: [Position, Player] });
    world2.deserialize(data);

    expect(world2.has(e)).toBe(true);
    expect(world2.get(e, Position)).toEqual({ x: 5, y: 10 });
    expect(world2.get(e, Player)).toEqual({ id: "p1", hue: 120 });
  });

  it("deserialize clears existing state", () => {
    const world = new World({ components: [Position] });
    const e1 = world.create();
    world.add(e1, Position, { x: 1, y: 1 });

    // Deserialize empty world
    world.deserialize({ entities: [] });
    expect(world.has(e1)).toBe(false);
    expect(world.query(Position)).toEqual([]);
  });

  it("round-trip preserves entity IDs", () => {
    const world = new World({ components: [Position] });
    const e1 = world.create();
    const e2 = world.create();
    world.add(e1, Position, { x: 1, y: 1 });
    world.add(e2, Position, { x: 2, y: 2 });

    const data = world.serialize();
    const world2 = new World({ components: [Position] });
    world2.deserialize(data);

    expect(world2.has(e1)).toBe(true);
    expect(world2.has(e2)).toBe(true);
    expect(world2.get(e1, Position)).toEqual({ x: 1, y: 1 });
    expect(world2.get(e2, Position)).toEqual({ x: 2, y: 2 });
  });
});

describe("World — integration", () => {
  it("full workflow: create, add, query, step, serialize", () => {
    const world = new World({ components: [Position, Velocity, Player] });

    // Create player entity
    const p = world.create();
    world.add(p, Player, { id: "alice", hue: 42 });
    world.add(p, Position, { x: 100, y: 200 });
    world.add(p, Velocity, { vx: 1, vy: -1 });

    // Create projectile (no Player component)
    const proj = world.create();
    world.add(proj, Position, { x: 50, y: 50 });
    world.add(proj, Velocity, { vx: 10, vy: 0 });

    // Movement system
    world.addSystem("movement", (w, ctx) => {
      for (const entity of w.query(Position, Velocity)) {
        const pos = w.get(entity, Position);
        const vel = w.get(entity, Velocity);
        pos.x += vel.vx;
        pos.y += vel.vy;
      }
    });

    world.step({});

    // Both moved
    expect(world.get(p, Position)).toEqual({ x: 101, y: 199 });
    expect(world.get(proj, Position)).toEqual({ x: 60, y: 50 });

    // Only player in Player query
    const players = world.query(Player);
    expect(players).toEqual([p]);

    // toState pattern
    const state = {
      players: world.query(Player).map((e) => ({
        ...world.get(e, Player),
        ...world.get(e, Position),
      })),
    };
    expect(state.players).toEqual([{ id: "alice", hue: 42, x: 101, y: 199 }]);
  });
});
