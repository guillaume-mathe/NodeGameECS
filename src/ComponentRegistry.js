/**
 * Creates a component registry for controlling serialization and diff policies.
 *
 * @returns {{
 *   register: (componentType: { name: string, _id: number }, config: { id?: number, serialize?: function, deserialize?: function, diffPolicy?: string, equals?: function }) => void,
 *   get: (componentType: { _id: number }) => object|undefined,
 *   getById: (numericId: number) => object|undefined,
 *   getByName: (name: string) => object|undefined,
 *   [Symbol.iterator]: () => Iterator
 * }}
 */
export function createComponentRegistry() {
  /** @type {Map<number, object>} componentType._id → entry */
  const byComponentId = new Map();
  /** @type {Map<number, object>} numeric registry id → entry */
  const byNumericId = new Map();
  /** @type {Map<string, object>} name → entry */
  const byName = new Map();

  return {
    /**
     * Register a component type with serialization/diff config.
     * @param {{ name: string, _id: number }} componentType
     * @param {{ id?: number, serialize?: function, deserialize?: function, diffPolicy?: string, equals?: function }} config
     */
    register(componentType, config = {}) {
      const entry = {
        componentType,
        id: config.id != null ? config.id : componentType._id,
        serialize: config.serialize || null,
        deserialize: config.deserialize || null,
        diffPolicy: config.diffPolicy || "always",
        equals: config.equals || null,
      };
      byComponentId.set(componentType._id, entry);
      byNumericId.set(entry.id, entry);
      byName.set(componentType.name, entry);
    },

    /**
     * Look up by component type object.
     * @param {{ _id: number }} componentType
     * @returns {object|undefined}
     */
    get(componentType) {
      return byComponentId.get(componentType._id);
    },

    /**
     * Look up by numeric registry id.
     * @param {number} numericId
     * @returns {object|undefined}
     */
    getById(numericId) {
      return byNumericId.get(numericId);
    },

    /**
     * Look up by component name.
     * @param {string} name
     * @returns {object|undefined}
     */
    getByName(name) {
      return byName.get(name);
    },

    [Symbol.iterator]() {
      return byComponentId.values();
    },
  };
}
