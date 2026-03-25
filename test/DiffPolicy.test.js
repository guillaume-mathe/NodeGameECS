import { describe, it, expect } from "vitest";
import { World } from "../src/World.js";
import { defineComponent } from "../src/Component.js";
import { createComponentRegistry } from "../src/ComponentRegistry.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const RenderState = defineComponent("RenderState", { sprite: "", frame: 0 });
const ClientOnly = defineComponent("ClientOnly", { cursor: 0, selected: false });

describe('Diff policy — "always" (default)', () => {
  it("includes component in diff whenever dirty", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.flushDiffs();

    world.set(e, Position, { x: 10 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].components.Position).toEqual({ x: 10, y: 2 });
  });
});

describe('Diff policy — "transition"', () => {
  const posEquals = (a, b) => a.x === b.x && a.y === b.y;

  it("includes component when equals returns false", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "transition", equals: posEquals });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.flushDiffs();

    world.set(e, Position, { x: 10 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].components.Position).toEqual({ x: 10, y: 0 });
  });

  it("excludes component when equals returns true (no change via set)", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "transition", equals: posEquals });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 5, y: 5 });
    world.flushDiffs();

    // Set to same values — equals returns true, so set() won't mark dirty
    world.set(e, Position, { x: 5, y: 5 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });

  it("transition check in flushDiffs uses _lastFlushed", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "transition", equals: posEquals });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 0, y: 0 });
    world.flushDiffs();

    // Use markDirty (bypasses set() equals check) — flushDiffs should compare against last flushed
    const pos = world.get(e, Position);
    pos.x = 10;
    world.markDirty(e, Position);

    const diff1 = world.flushDiffs();
    expect(diff1.entities).toHaveLength(1);

    // Mark dirty again without changing — _lastFlushed should match current
    world.markDirty(e, Position);
    const diff2 = world.flushDiffs();
    expect(diff2.entities).toHaveLength(0);
  });
});

describe('Diff policy — "snapshot-only"', () => {
  it("excludes component from diffs", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });
    registry.register(RenderState, { diffPolicy: "snapshot-only" });

    const world = new World({ components: [Position, RenderState], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, RenderState, { sprite: "hero", frame: 0 });
    world.flushDiffs();

    world.set(e, RenderState, { frame: 3 });
    const diff = world.flushDiffs();
    // RenderState is snapshot-only, so it shouldn't appear in updates
    expect(diff.entities).toHaveLength(0);
  });

  it("includes component in snapshot", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });
    registry.register(RenderState, { diffPolicy: "snapshot-only" });

    const world = new World({ components: [Position, RenderState], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, RenderState, { sprite: "hero", frame: 5 });

    const snap = world.snapshot();
    expect(snap.entities[0].components.RenderState).toEqual({ sprite: "hero", frame: 5 });
  });

  it("snapshot-only component excluded from add diff too", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });
    registry.register(RenderState, { diffPolicy: "snapshot-only" });

    const world = new World({ components: [Position, RenderState], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, RenderState, { sprite: "hero", frame: 0 });

    const diff = world.flushDiffs();
    expect(diff.entities[0].components.Position).toBeDefined();
    expect(diff.entities[0].components.RenderState).toBeUndefined();
  });
});

describe('Diff policy — "client-only"', () => {
  it("excludes component from diffs", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });
    registry.register(ClientOnly, { diffPolicy: "client-only" });

    const world = new World({ components: [Position, ClientOnly], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, ClientOnly, { cursor: 5, selected: true });
    world.flushDiffs();

    world.set(e, ClientOnly, { cursor: 10 });
    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(0);
  });

  it("excludes component from snapshots", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { diffPolicy: "always" });
    registry.register(ClientOnly, { diffPolicy: "client-only" });

    const world = new World({ components: [Position, ClientOnly], registry });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });
    world.add(e, ClientOnly, { cursor: 5, selected: true });

    const snap = world.snapshot();
    expect(snap.entities[0].components.Position).toBeDefined();
    expect(snap.entities[0].components.ClientOnly).toBeUndefined();
  });
});

describe("Registry serialize/deserialize in diffs", () => {
  it("uses custom serialize in flushDiffs", () => {
    const registry = createComponentRegistry();
    registry.register(Position, {
      serialize: (d) => ({ px: d.x, py: d.y }),
      deserialize: (r) => ({ x: r.px, y: r.py }),
    });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 10, y: 20 });

    const diff = world.flushDiffs();
    expect(diff.entities[0].components.Position).toEqual({ px: 10, py: 20 });
  });

  it("uses custom deserialize in applyDiff", () => {
    const registry = createComponentRegistry();
    registry.register(Position, {
      serialize: (d) => ({ px: d.x, py: d.y }),
      deserialize: (r) => ({ x: r.px, y: r.py }),
    });

    const world = new World({ components: [Position], registry });
    world.applyDiff({
      entities: [
        { id: 0, op: "add", components: { Position: { px: 5, py: 10 } } },
      ],
    });

    expect(world.get(0, Position)).toEqual({ x: 5, y: 10 });
  });

  it("uses custom serialize in snapshot", () => {
    const registry = createComponentRegistry();
    registry.register(Position, {
      serialize: (d) => ({ px: d.x, py: d.y }),
    });

    const world = new World({ components: [Position], registry });
    const e = world.create();
    world.add(e, Position, { x: 3, y: 7 });

    const snap = world.snapshot();
    expect(snap.entities[0].components.Position).toEqual({ px: 3, py: 7 });
  });
});

describe("No registry — backward compatibility", () => {
  it("flushDiffs works without registry", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });

    const diff = world.flushDiffs();
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].components.Position).toEqual({ x: 1, y: 2 });
  });

  it("snapshot works without registry", () => {
    const world = new World({ components: [Position] });
    const e = world.create();
    world.add(e, Position, { x: 1, y: 2 });

    const snap = world.snapshot();
    expect(snap.entities).toHaveLength(1);
    expect(snap.entities[0].components.Position).toEqual({ x: 1, y: 2 });
  });
});
