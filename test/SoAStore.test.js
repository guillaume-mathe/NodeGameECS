import { describe, it, expect } from "vitest";
import { defineComponent } from "../src/Component.js";
import { SoAStore } from "../src/SoAStore.js";

describe("SoAStore", () => {
  it("stores and retrieves numeric fields", () => {
    const Position = defineComponent("SoA_Pos", { x: 0, y: 0 });
    const store = new SoAStore(Position, 16);
    store.set(3, { x: 10, y: 20 });
    expect(store.getField(3, "x")).toBe(10);
    expect(store.getField(3, "y")).toBe(20);
  });

  it("stores and retrieves string fields", () => {
    const Tag = defineComponent("SoA_Tag", { label: "none" });
    const store = new SoAStore(Tag, 16);
    store.set(0, { label: "player" });
    expect(store.getField(0, "label")).toBe("player");
  });

  it("handles mixed numeric and string fields", () => {
    const Player = defineComponent("SoA_Player", { id: "", hue: 0 });
    const store = new SoAStore(Player, 16);
    store.set(5, { id: "abc", hue: 180 });
    expect(store.getField(5, "id")).toBe("abc");
    expect(store.getField(5, "hue")).toBe(180);
  });

  it("setField updates a single field", () => {
    const Position = defineComponent("SoA_Pos2", { x: 0, y: 0 });
    const store = new SoAStore(Position, 16);
    store.set(0, { x: 1, y: 2 });
    store.setField(0, "x", 99);
    expect(store.getField(0, "x")).toBe(99);
    expect(store.getField(0, "y")).toBe(2);
  });

  it("toObject returns a detached plain object", () => {
    const Position = defineComponent("SoA_Pos3", { x: 0, y: 0 });
    const store = new SoAStore(Position, 16);
    store.set(2, { x: 5, y: 10 });
    const obj = store.toObject(2);
    expect(obj).toEqual({ x: 5, y: 10 });
    // Mutations to returned object don't affect store
    obj.x = 999;
    expect(store.getField(2, "x")).toBe(5);
  });

  it("clear resets slot to defaults", () => {
    const Position = defineComponent("SoA_Pos4", { x: 0, y: 0 });
    const store = new SoAStore(Position, 16);
    store.set(1, { x: 42, y: 99 });
    store.clear(1);
    expect(store.getField(1, "x")).toBe(0);
    expect(store.getField(1, "y")).toBe(0);
  });

  it("clear resets string fields to defaults", () => {
    const Tag = defineComponent("SoA_Tag2", { label: "default" });
    const store = new SoAStore(Tag, 16);
    store.set(0, { label: "changed" });
    store.clear(0);
    expect(store.getField(0, "label")).toBe("default");
  });

  it("grow preserves existing data", () => {
    const Position = defineComponent("SoA_Pos5", { x: 0, y: 0 });
    const store = new SoAStore(Position, 4);
    store.set(2, { x: 7, y: 8 });
    store.grow(16);
    expect(store.getField(2, "x")).toBe(7);
    expect(store.getField(2, "y")).toBe(8);
    expect(store._capacity).toBe(16);
    // Can now use higher indices
    store.set(10, { x: 100, y: 200 });
    expect(store.getField(10, "x")).toBe(100);
  });

  it("grow preserves string data", () => {
    const Tag = defineComponent("SoA_Tag3", { label: "none" });
    const store = new SoAStore(Tag, 4);
    store.set(1, { label: "hello" });
    store.grow(16);
    expect(store.getField(1, "label")).toBe("hello");
    // New slots get default
    expect(store.getField(10, "label")).toBe("none");
  });

  it("works with zero-field component", () => {
    const Marker = defineComponent("SoA_Marker");
    const store = new SoAStore(Marker, 16);
    const obj = store.toObject(0);
    expect(obj).toEqual({});
  });

  it("respects explicit f32 schema", () => {
    const Pos = defineComponent("SoA_Pos6", { x: 0, y: 0 }, { schema: { x: "f32", y: "f32" } });
    const store = new SoAStore(Pos, 4);
    store.set(0, { x: 1.5, y: 2.5 });
    expect(store.getField(0, "x")).toBeCloseTo(1.5);
    expect(store._arrays.x).toBeInstanceOf(Float32Array);
  });
});
