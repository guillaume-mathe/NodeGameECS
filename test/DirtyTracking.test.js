import { describe, it, expect } from "vitest";
import { World } from "../src/World.js";
import { defineComponent } from "../src/Component.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Health = defineComponent("Health", { hp: 100 });

describe("Dirty tracking — create", () => {
  it("create() marks entity as dirty created", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0]).toEqual({ id: e, op: "add", components: {} });
  });

  it("create() + add() includes components in add diff", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 10, y: 20 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].op).toBe("add");
    expect(diff.entities[0].components.Position).toEqual({ x: 10, y: 20 });
  });
});

describe("Dirty tracking — add/remove components", () => {
  it("add() on existing entity produces update diff", () => {
    const world = new World({ components: [Position, Velocity] });
    const e = world.create();
    world.add(e, Position);
    world.flushDiffs(); // clear initial creation

    world.add(e, Velocity, { vx: 5, vy: 3 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].op).toBe("update");
    expect(diff.entities[0].components.Velocity).toEqual({ vx: 5, vy: 3 });
  });

  it("remove() on existing entity produces update diff with removed", () => {
    const world = new World({ components: [Position, Velocity] });
    const e = world.create();
    world.add(e, Position);
    world.add(e, Velocity);
    world.flushDiffs();

    world.remove(e, Velocity);
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].op).toBe("update");
    expect(diff.entities[0].removed).toContain("Velocity");
  });
});

describe("Dirty tracking — destroy", () => {
  it("destroy + step produces remove diff", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position);
    world.flushDiffs();

    world.destroy(e);
    world.step({});
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0]).toEqual({ id: e, op: "remove" });
  });

  it("create + destroy in same frame produces empty diff", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position);
    world.destroy(e);
    world.step({});
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });
});

describe("Dirty tracking — set()", () => {
  it("set() marks entity+component dirty", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.flushDiffs();

    world.set(e, Position, { x: 42 });
    expect(world.get(e, Position)).toEqual({ x: 42, y: 0 });

    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].op).toBe("update");
    expect(diff.entities[0].components.Position).toEqual({ x: 42, y: 0 });
  });

  it("set() on missing component is a no-op", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.flushDiffs();

    world.set(e, Position, { x: 42 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });

  it("set() on missing store is a no-op", () => {
    const world = new World({ components: [Position, Velocity] });
    const e = world.create();
    world.flushDiffs();

    world.set(e, Velocity, { vx: 5 }); // no Velocity store created yet
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });
});

describe("Dirty tracking — markDirty()", () => {
  it("markDirty() after direct mutation tracks the change", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.flushDiffs();

    const pos = world.get(e, Position);
    pos.x = 99;
    world.markDirty(e, Position);

    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].components.Position).toEqual({ x: 99, y: 0 });
  });

  it("markDirty() on dead entity is a no-op", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position);
    world.destroy(e);
    world.step({});
    world.flushDiffs();

    world.markDirty(e, Position);
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });
});

describe("Dirty tracking — flushDiffs() clears state", () => {
  it("second flushDiffs() returns empty diff", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });

    const diff1 = world.flushDiffs();
    expect(diff1.entities).toHaveLength(1);

    const diff2 = world.flushDiffs();
    expect(diff2.entities).toHaveLength(0);
  });
});
