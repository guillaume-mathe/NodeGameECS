import { describe, it, expect } from "vitest";
import { Bitset } from "../src/Bitset.js";

describe("Bitset", () => {
  it("set and has", () => {
    const bs = new Bitset(64);
    expect(bs.has(0)).toBe(false);
    bs.set(0);
    expect(bs.has(0)).toBe(true);
    bs.set(31);
    expect(bs.has(31)).toBe(true);
    expect(bs.has(1)).toBe(false);
  });

  it("handles word boundaries (bit 31 and 32)", () => {
    const bs = new Bitset(128);
    bs.set(31);
    bs.set(32);
    bs.set(63);
    expect(bs.has(31)).toBe(true);
    expect(bs.has(32)).toBe(true);
    expect(bs.has(63)).toBe(true);
    expect(bs.has(30)).toBe(false);
    expect(bs.has(33)).toBe(false);
  });

  it("clear removes a bit", () => {
    const bs = new Bitset(64);
    bs.set(5);
    expect(bs.has(5)).toBe(true);
    bs.clear(5);
    expect(bs.has(5)).toBe(false);
  });

  it("clearAll resets all bits", () => {
    const bs = new Bitset(64);
    bs.set(0);
    bs.set(31);
    bs.set(32);
    bs.clearAll();
    expect(bs.has(0)).toBe(false);
    expect(bs.has(31)).toBe(false);
    expect(bs.has(32)).toBe(false);
  });

  it("grow preserves existing bits", () => {
    const bs = new Bitset(32);
    bs.set(5);
    bs.set(31);
    bs.grow(128);
    expect(bs.has(5)).toBe(true);
    expect(bs.has(31)).toBe(true);
    expect(bs._capacity).toBe(128);
    // New bits are clear
    bs.set(100);
    expect(bs.has(100)).toBe(true);
  });

  it("toArray reconstructs entity IDs from generations", () => {
    const INDEX_BITS = 20;
    const bs = new Bitset(64);
    const generations = new Uint16Array(64);

    bs.set(0);
    generations[0] = 0;
    bs.set(5);
    generations[5] = 3;
    bs.set(32);
    generations[32] = 1;

    const ids = bs.toArray(generations, INDEX_BITS);
    expect(ids).toContain((0 << INDEX_BITS) | 0); // slot 0, gen 0
    expect(ids).toContain((3 << INDEX_BITS) | 5); // slot 5, gen 3
    expect(ids).toContain((1 << INDEX_BITS) | 32); // slot 32, gen 1
    expect(ids).toHaveLength(3);
  });

  it("toArray returns empty for no set bits", () => {
    const bs = new Bitset(64);
    const generations = new Uint16Array(64);
    expect(bs.toArray(generations, 20)).toEqual([]);
  });
});
