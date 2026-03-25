/**
 * SoA storage for a single component type.
 * One TypedArray per numeric field, one plain Array per string field,
 * all indexed by entity slot index.
 */
export class SoAStore {
  /**
   * @param {{ _fields: string[], _schema: Record<string, { type: string, Ctor: Function|null }>, defaults: object }} componentType
   * @param {number} capacity
   */
  constructor(componentType, capacity) {
    this._componentType = componentType;
    this._capacity = capacity;
    this._arrays = Object.create(null);

    for (const field of componentType._fields) {
      const { type, Ctor } = componentType._schema[field];
      if (type === "string") {
        const arr = new Array(capacity);
        const def = componentType.defaults[field];
        for (let i = 0; i < capacity; i++) arr[i] = def;
        this._arrays[field] = arr;
      } else {
        this._arrays[field] = new Ctor(capacity);
        // TypedArrays default to 0, fill with actual default if non-zero
        const def = componentType.defaults[field];
        if (def !== 0 && def !== false) {
          this._arrays[field].fill(type === "u8" ? (def ? 1 : 0) : def);
        }
      }
    }
  }

  /**
   * Write all field values for a slot index from a data object.
   * @param {number} slotIndex
   * @param {object} data
   */
  set(slotIndex, data) {
    const schema = this._componentType._schema;
    for (const field of this._componentType._fields) {
      if (field in data) {
        const val = data[field];
        this._arrays[field][slotIndex] =
          schema[field].type === "u8" && typeof val === "boolean"
            ? val ? 1 : 0
            : val;
      }
    }
  }

  /**
   * Read a single field value.
   * @param {number} slotIndex
   * @param {string} fieldName
   * @returns {*}
   */
  getField(slotIndex, fieldName) {
    return this._arrays[fieldName][slotIndex];
  }

  /**
   * Set a single field value.
   * @param {number} slotIndex
   * @param {string} fieldName
   * @param {*} value
   */
  setField(slotIndex, fieldName, value) {
    this._arrays[fieldName][slotIndex] = value;
  }

  /**
   * Read all fields into a detached plain object.
   * @param {number} slotIndex
   * @returns {object}
   */
  toObject(slotIndex) {
    const obj = {};
    for (const field of this._componentType._fields) {
      obj[field] = this._arrays[field][slotIndex];
    }
    return obj;
  }

  /**
   * Reset a slot's data to component defaults.
   * @param {number} slotIndex
   */
  clear(slotIndex) {
    const defaults = this._componentType.defaults;
    const schema = this._componentType._schema;
    for (const field of this._componentType._fields) {
      const def = defaults[field];
      this._arrays[field][slotIndex] =
        schema[field].type === "u8" && typeof def === "boolean"
          ? def ? 1 : 0
          : def;
    }
  }

  /**
   * Grow all arrays to a new capacity, preserving existing data.
   * @param {number} newCapacity
   */
  grow(newCapacity) {
    const schema = this._componentType._schema;
    for (const field of this._componentType._fields) {
      const old = this._arrays[field];
      const { type, Ctor } = schema[field];
      if (type === "string") {
        const arr = new Array(newCapacity);
        const def = this._componentType.defaults[field];
        for (let i = 0; i < newCapacity; i++) {
          arr[i] = i < old.length ? old[i] : def;
        }
        this._arrays[field] = arr;
      } else {
        const arr = new Ctor(newCapacity);
        arr.set(old);
        // Fill new slots with default if non-zero
        const def = this._componentType.defaults[field];
        if (def !== 0 && def !== false) {
          const fillVal = type === "u8" ? (def ? 1 : 0) : def;
          arr.fill(fillVal, old.length);
        }
        this._arrays[field] = arr;
      }
    }
    this._capacity = newCapacity;
  }
}
