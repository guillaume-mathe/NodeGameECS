import { describe, it, expect } from "vitest";
import { defineComponent } from "../src/Component.js";

describe("defineComponent", () => {
  it("returns an object with name, defaults, and _id", () => {
    const Position = defineComponent("Position", { x: 0, y: 0 });
    expect(Position.name).toBe("Position");
    expect(Position.defaults).toEqual({ x: 0, y: 0 });
    expect(typeof Position._id).toBe("number");
  });

  it("assigns incrementing _id values", () => {
    const A = defineComponent("A", {});
    const B = defineComponent("B", {});
    expect(B._id).toBe(A._id + 1);
  });

  it("freezes defaults", () => {
    const C = defineComponent("C", { val: 42 });
    expect(Object.isFrozen(C.defaults)).toBe(true);
  });

  it("defaults to empty object when no defaults provided", () => {
    const Tag = defineComponent("Tag");
    expect(Tag.defaults).toEqual({});
  });

  it("does not share defaults reference with input", () => {
    const input = { x: 1 };
    const D = defineComponent("D", input);
    input.x = 999;
    expect(D.defaults.x).toBe(1);
  });
});
