/**
 * Defines a reusable entity prefab (archetype template).
 * @param {Array<[{ name: string, defaults: object, _id: number }, object?]>} components
 *   Array of [ComponentType, overrides?] pairs
 * @returns {{ components: Array<[{ name: string, defaults: object, _id: number }, object]> }}
 */
export function definePrefab(components) {
  return {
    components: components.map(([type, overrides]) => [type, overrides || {}]),
  };
}
