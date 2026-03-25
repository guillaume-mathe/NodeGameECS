/**
 * Fixed-capacity bitset backed by Uint32Array.
 * Used for entity alive tracking and component membership.
 */
export class Bitset {
  /**
   * @param {number} capacity — maximum number of bits
   */
  constructor(capacity) {
    this._capacity = capacity;
    this._words = new Uint32Array(Math.ceil(capacity / 32));
  }

  /**
   * Set bit at index.
   * @param {number} index
   */
  set(index) {
    this._words[index >>> 5] |= 1 << (index & 31);
  }

  /**
   * Clear bit at index.
   * @param {number} index
   */
  clear(index) {
    this._words[index >>> 5] &= ~(1 << (index & 31));
  }

  /**
   * Test bit at index.
   * @param {number} index
   * @returns {boolean}
   */
  has(index) {
    return (this._words[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  /**
   * Grow to a new capacity, preserving existing bits.
   * @param {number} newCapacity
   */
  grow(newCapacity) {
    const newWords = new Uint32Array(Math.ceil(newCapacity / 32));
    newWords.set(this._words);
    this._words = newWords;
    this._capacity = newCapacity;
  }

  /**
   * Clear all bits.
   */
  clearAll() {
    this._words.fill(0);
  }

  /**
   * Count the number of set bits (population count).
   * @returns {number}
   */
  count() {
    let n = 0;
    const words = this._words;
    for (let i = 0; i < words.length; i++) {
      let v = words[i];
      while (v) { v &= v - 1; n++; }
    }
    return n;
  }

  /**
   * Extract all set bit indices as entity IDs using generation lookup.
   * @param {Uint16Array} generations — per-slot generation values
   * @param {number} indexBits — number of bits for slot index (e.g. 20)
   * @returns {number[]}
   */
  toArray(generations, indexBits) {
    const result = [];
    const words = this._words;
    const len = words.length;
    for (let w = 0; w < len; w++) {
      let mask = words[w];
      while (mask !== 0) {
        const lsb = mask & (-mask);
        const bit = 31 - Math.clz32(lsb);
        const slotIndex = (w << 5) + bit;
        result.push((generations[slotIndex] << indexBits) | slotIndex);
        mask ^= lsb;
      }
    }
    return result;
  }
}
