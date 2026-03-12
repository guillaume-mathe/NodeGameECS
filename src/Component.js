let nextId = 0;

/**
 * Defines a reusable component type.
 * @param {string} name — unique name, used as serialization key
 * @param {object} defaults — default field values, spread when adding
 * @returns {{ name: string, defaults: Readonly<object>, _id: number }}
 */
export function defineComponent(name, defaults = {}) {
  return {
    name,
    defaults: Object.freeze({ ...defaults }),
    _id: nextId++,
  };
}
