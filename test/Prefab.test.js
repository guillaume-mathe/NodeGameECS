import { describe, it, expect } from "vitest";
import { World } from "../src/World.js";
import { defineComponent } from "../src/Component.js";
import { definePrefab } from "../src/Prefab.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Player = defineComponent("Player", { id: "", hue: 0 });
const Bomb = defineComponent("Bomb", { timer: 3, range: 1 });

describe("definePrefab", () => {
  it("creates a prefab from component list", () => {
    const prefab = definePrefab([
      [Position, { x: 0, y: 0 }],
      [Player, { id: "", hue: 0 }],
    ]);
    expect(prefab.components).toHaveLength(2);
    expect(prefab.components[0][0]).toBe(Position);
    expect(prefab.components[1][0]).toBe(Player);
  });

  it("defaults overrides to empty object", () => {
    const prefab = definePrefab([[Position]]);
    expect(prefab.components[0][1]).toEqual({});
  });
});

describe("world.spawn()", () => {
  it("creates entity with all prefab components", () => {
    const PlayerPrefab = definePrefab([
      [Position, { x: 0, y: 0 }],
      [Player, { id: "", hue: 0 }],
    ]);

    const world = new World({ components: [Position, Player] });
    const e = world.spawn(PlayerPrefab);

    expect(world.has(e)).toBe(true);
    expect(world.get(e, Position)).toEqual({ x: 0, y: 0 });
    expect(world.get(e, Player)).toEqual({ id: "", hue: 0 });
  });

  it("applies prefab-level defaults", () => {
    const BombPrefab = definePrefab([
      [Position],
      [Bomb, { timer: 3, range: 2 }],
    ]);

    const world = new World({ components: [Position, Bomb] });
    const e = world.spawn(BombPrefab);

    expect(world.get(e, Position)).toEqual({ x: 0, y: 0 });
    expect(world.get(e, Bomb)).toEqual({ timer: 3, range: 2 });
  });

  it("applies per-component overrides at spawn time", () => {
    const PlayerPrefab = definePrefab([
      [Position, { x: 0, y: 0 }],
      [Player, { id: "", hue: 0 }],
    ]);

    const world = new World({ components: [Position, Player] });
    const e = world.spawn(PlayerPrefab, {
      Position: { x: 100, y: 200 },
      Player: { id: "alice", hue: 42 },
    });

    expect(world.get(e, Position)).toEqual({ x: 100, y: 200 });
    expect(world.get(e, Player)).toEqual({ id: "alice", hue: 42 });
  });

  it("partial overrides merge with prefab defaults", () => {
    const BombPrefab = definePrefab([
      [Position],
      [Bomb, { timer: 3, range: 2 }],
    ]);

    const world = new World({ components: [Position, Bomb] });
    const e = world.spawn(BombPrefab, {
      Position: { x: 5, y: 10 },
      Bomb: { range: 4 },
    });

    expect(world.get(e, Position)).toEqual({ x: 5, y: 10 });
    expect(world.get(e, Bomb)).toEqual({ timer: 3, range: 4 });
  });

  it("spawn triggers dirty tracking", () => {
    const PlayerPrefab = definePrefab([
      [Position, { x: 0, y: 0 }],
      [Player, { id: "", hue: 0 }],
    ]);

    const world = new World({ components: [Position, Player] });
    const e = world.spawn(PlayerPrefab, {
      Player: { id: "bob" },
    });

    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].op).toBe("add");
    expect(diff.entities[0].components.Position).toEqual({ x: 0, y: 0 });
    expect(diff.entities[0].components.Player).toEqual({ id: "bob", hue: 0 });
  });

  it("spawned entities appear in queries", () => {
    const PlayerPrefab = definePrefab([
      [Position],
      [Velocity],
      [Player],
    ]);

    const world = new World({ components: [Position, Velocity, Player] });
    const e = world.spawn(PlayerPrefab);

    expect(world.query(Position, Velocity)).toContain(e);
    expect(world.query(Player)).toContain(e);
  });

  it("multiple spawns from same prefab create independent entities", () => {
    const BombPrefab = definePrefab([
      [Position],
      [Bomb, { timer: 3, range: 1 }],
    ]);

    const world = new World({ components: [Position, Bomb] });
    const e1 = world.spawn(BombPrefab, { Position: { x: 1, y: 1 } });
    const e2 = world.spawn(BombPrefab, { Position: { x: 5, y: 5 } });

    expect(e1).not.toBe(e2);
    expect(world.get(e1, Position)).toEqual({ x: 1, y: 1 });
    expect(world.get(e2, Position)).toEqual({ x: 5, y: 5 });

    // Mutating one doesn't affect the other
    world.get(e1, Bomb).timer = 0;
    expect(world.get(e2, Bomb).timer).toBe(3);
  });
});
