import { describe, it, expect } from "vitest";
import { createComponentRegistry } from "../src/ComponentRegistry.js";
import { defineComponent } from "../src/Component.js";

const Position = defineComponent("Position", { x: 0, y: 0 });
const Velocity = defineComponent("Velocity", { vx: 0, vy: 0 });
const Health = defineComponent("Health", { hp: 100 });

describe("createComponentRegistry", () => {
  it("creates a registry", () => {
    const registry = createComponentRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.get).toBe("function");
    expect(typeof registry.getById).toBe("function");
    expect(typeof registry.getByName).toBe("function");
  });
});

describe("registry.register()", () => {
  it("registers a component type with defaults", () => {
    const registry = createComponentRegistry();
    registry.register(Position);
    const entry = registry.get(Position);
    expect(entry).toBeDefined();
    expect(entry.componentType).toBe(Position);
    expect(entry.diffPolicy).toBe("always");
    expect(entry.serialize).toBeNull();
    expect(entry.deserialize).toBeNull();
    expect(entry.equals).toBeNull();
  });

  it("registers with custom config", () => {
    const registry = createComponentRegistry();
    const serialize = (d) => ({ x: d.x, y: d.y });
    const deserialize = (r) => ({ x: r.x, y: r.y });
    const equals = (a, b) => a.x === b.x && a.y === b.y;

    registry.register(Position, {
      id: 42,
      serialize,
      deserialize,
      diffPolicy: "transition",
      equals,
    });

    const entry = registry.get(Position);
    expect(entry.id).toBe(42);
    expect(entry.serialize).toBe(serialize);
    expect(entry.deserialize).toBe(deserialize);
    expect(entry.diffPolicy).toBe("transition");
    expect(entry.equals).toBe(equals);
  });

  it("defaults id to componentType._id", () => {
    const registry = createComponentRegistry();
    registry.register(Velocity);
    const entry = registry.get(Velocity);
    expect(entry.id).toBe(Velocity._id);
  });
});

describe("registry.get()", () => {
  it("returns undefined for unregistered types", () => {
    const registry = createComponentRegistry();
    expect(registry.get(Position)).toBeUndefined();
  });

  it("returns the entry for registered types", () => {
    const registry = createComponentRegistry();
    registry.register(Position);
    expect(registry.get(Position).componentType).toBe(Position);
  });
});

describe("registry.getById()", () => {
  it("looks up by numeric id", () => {
    const registry = createComponentRegistry();
    registry.register(Position, { id: 99 });
    const entry = registry.getById(99);
    expect(entry).toBeDefined();
    expect(entry.componentType).toBe(Position);
  });

  it("returns undefined for unknown id", () => {
    const registry = createComponentRegistry();
    expect(registry.getById(999)).toBeUndefined();
  });
});

describe("registry.getByName()", () => {
  it("looks up by component name", () => {
    const registry = createComponentRegistry();
    registry.register(Position);
    const entry = registry.getByName("Position");
    expect(entry).toBeDefined();
    expect(entry.componentType).toBe(Position);
  });

  it("returns undefined for unknown name", () => {
    const registry = createComponentRegistry();
    expect(registry.getByName("Unknown")).toBeUndefined();
  });
});

describe("registry iteration", () => {
  it("iterates all registered entries", () => {
    const registry = createComponentRegistry();
    registry.register(Position);
    registry.register(Velocity);
    registry.register(Health);

    const entries = [...registry];
    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.componentType.name);
    expect(names).toContain("Position");
    expect(names).toContain("Velocity");
    expect(names).toContain("Health");
  });

  it("empty registry iterates nothing", () => {
    const registry = createComponentRegistry();
    const entries = [...registry];
    expect(entries).toHaveLength(0);
  });
});
