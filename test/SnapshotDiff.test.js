import { describe, it, expect } from "vitest";
import { World } from "../src/World.js";
import { defineComponent } from "../src/Component.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Player = defineComponent("Player", { id: "", name: "" });

describe("snapshot()", () => {
  it("returns complete world state", () => {
    const world = new World({ components: [Position, Player] });
    const e = world.create();
    world.add(e, Position, { x: 5, y: 10 });
    world.add(e, Player, { id: "p1", name: "alice" });

    const snap = world.snapshot();
    expect(snap.entities).toHaveLength(1);
    expect(snap.entities[0].id).toBe(e);
    expect(snap.entities[0].components.Position).toEqual({ x: 5, y: 10 });
    expect(snap.entities[0].components.Player).toEqual({ id: "p1", name: "alice" });
  });

  it("returns detached copies", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });

    const snap = world.snapshot();
    snap.entities[0].components.Position.x = 999;
    expect(world.get(e, Position).x).toBe(1);
  });
});

describe("applySnapshot()", () => {
  it("restores world state", () => {
    const world = new World({ components: [Position, Player] });
    const e = world.create();
    world.add(e, Position, { x: 5, y: 10 });
    world.add(e, Player, { id: "p1", name: "alice" });
    const snap = world.snapshot();

    const world2 = new World({ components: [Position, Player] });
    world2.applySnapshot(snap);
    expect(world2.has(e)).toBe(true);
    expect(world2.get(e, Position)).toEqual({ x: 5, y: 10 });
    expect(world2.get(e, Player)).toEqual({ id: "p1", name: "alice" });
  });

  it("clears dirty tracking after apply", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    const snap = world.snapshot();

    const world2 = new World({ components: [Position] });
    world2.applySnapshot(snap);
    const diff = world2.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });

  it("clears existing state before applying", () => {
    const world = new World({ components: [Position] });
    const e1 = world.create();
    world.add(e1, Position, { x: 1, y: 1 });
    world.flushDiffs();

    world.applySnapshot({ entities: [] });
    expect(world.has(e1)).toBe(false);
  });

  it("round-trip: snapshot → applySnapshot produces equivalent state", () => {
    const world = new World({ components: [Position, Player] });
    const e1 = world.create();
    world.add(e1, Position, { x: 10, y: 20 });
    world.add(e1, Player, { id: "p1", name: "alice" });
    const e2 = world.create();
    world.add(e2, Position, { x: 30, y: 40 });

    const snap = world.snapshot();
    const world2 = new World({ components: [Position, Player] });
    world2.applySnapshot(snap);

    expect(world2.has(e1)).toBe(true);
    expect(world2.has(e2)).toBe(true);
    expect(world2.get(e1, Position)).toEqual({ x: 10, y: 20 });
    expect(world2.get(e1, Player)).toEqual({ id: "p1", name: "alice" });
    expect(world2.get(e2, Position)).toEqual({ x: 30, y: 40 });
  });
});

describe("applyDiff()", () => {
  it("applies add operations", () => {
    const world = new World({ components: [Position] });
    world.applyDiff({
      entities: [
        { id: 0, op: "add", components: { Position: { x: 5, y: 10 } } },
      ],
    });
    expect(world.has(0)).toBe(true);
    expect(world.get(0, Position)).toEqual({ x: 5, y: 10 });
  });

  it("applies update operations", () => {
    const world = new World({ components: [Position, Velocity] });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, { vx: 1, vy: 1 });

    world.applyDiff({
      entities: [
        { id: e, op: "update", components: { Position: { x: 10, y: 20 } }, removed: ["Velocity"] },
      ],
    });

    expect(world.get(e, Position)).toEqual({ x: 10, y: 20 });
    expect(world.get(e, Velocity)).toBeUndefined();
  });

  it("applies update with new component on existing entity", () => {
    const world = new World({ components: [Position, Velocity] });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });

    world.applyDiff({
      entities: [
        { id: e, op: "update", components: { Velocity: { vx: 5, vy: 3 } } },
      ],
    });

    expect(world.get(e, Velocity)).toEqual({ vx: 5, vy: 3 });
  });

  it("applies remove operations", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position);

    world.applyDiff({
      entities: [{ id: e, op: "remove" }],
    });

    expect(world.has(e)).toBe(false);
  });

  it("does not trigger dirty tracking", () => {
    const world = new World({ components: [Position] });

    world.applyDiff({
      entities: [
        { id: 0, op: "add", components: { Position: { x: 5, y: 10 } } },
      ],
    });

    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });

  it("round-trip: flushDiffs → applyDiff produces equivalent state", () => {
    const world1 = new World({ components: [Position, Player] });
    const e1 = world1.create();
    world1.add(e1, Position, { x: 10, y: 20 });
    world1.add(e1, Player, { id: "p1", name: "alice" });

    const diff = world1.flushDiffs();

    const world2 = new World({ components: [Position, Player] });
    world2.applyDiff(diff);

    expect(world2.has(e1)).toBe(true);
    expect(world2.get(e1, Position)).toEqual({ x: 10, y: 20 });
    expect(world2.get(e1, Player)).toEqual({ id: "p1", name: "alice" });
  });

  it("round-trip with updates: flushDiffs → applyDiff", () => {
    const world1 = new World({ components: [Position] });
    const e = world1.create();
    world1.add(e, Position, { x: 0, y: 0 });
    world1.flushDiffs();

    // Create mirror world
    const world2 = new World({ components: [Position] });
    world2._createWithId(e);
    world2.add(e, Position, { x: 0, y: 0 });

    // Mutate world1
    world1.set(e, Position, { x: 42, y: 99 });
    const diff = world1.flushDiffs();

    // Apply to world2
    world2.applyDiff(diff);
    expect(world2.get(e, Position)).toEqual({ x: 42, y: 99 });
  });

  it("round-trip with destroy: flushDiffs → applyDiff", () => {
    const world1 = new World({ components: [Position] });
    const e = world1.create();
    world1.add(e, Position);
    world1.flushDiffs();

    // Create mirror world
    const world2 = new World({ components: [Position] });
    world2._createWithId(e);
    world2.add(e, Position);

    // Destroy in world1
    world1.destroy(e);
    world1.step({});
    const diff = world1.flushDiffs();

    world2.applyDiff(diff);
    expect(world2.has(e)).toBe(false);
  });
});
