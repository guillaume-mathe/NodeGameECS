let nextId = 0;

const TYPE_MAP = {
  f32: Float32Array,
  f64: Float64Array,
  i32: Int32Array,
  u8: Uint8Array,
  i16: Int16Array,
  u16: Uint16Array,
  string: null,
};

/**
 * Infer the SoA schema entry for a default value.
 * @param {*} val
 * @returns {{ type: string, Ctor: Function|null, jsType: string }}
 */
function inferSchema(val) {
  switch (typeof val) {
    case "number":
      return { type: "f64", Ctor: Float64Array, jsType: "number" };
    case "boolean":
      return { type: "u8", Ctor: Uint8Array, jsType: "boolean" };
    case "string":
      return { type: "string", Ctor: null, jsType: "string" };
    default:
      return { type: "string", Ctor: null, jsType: "string" };
  }
}

/**
 * Defines a reusable component type.
 * @param {string} name — unique name, used as serialization key
 * @param {object} defaults — default field values, spread when adding
 * @param {{ schema?: Record<string, string> }} [options] — optional explicit schema overrides per field
 * @returns {{ name: string, defaults: Readonly<object>, _id: number, _fields: string[], _schema: Record<string, { type: string, Ctor: Function|null, jsType: string }> }}
 */
export function defineComponent(name, defaults = {}, options = {}) {
  const frozen = Object.freeze({ ...defaults });
  const _fields = Object.keys(frozen);
  const _schema = Object.create(null);

  for (const field of _fields) {
    const inferred = inferSchema(frozen[field]);
    if (options.schema && options.schema[field]) {
      const typeStr = options.schema[field];
      _schema[field] = {
        type: typeStr,
        Ctor: TYPE_MAP[typeStr] ?? null,
        jsType: inferred.jsType,
      };
    } else {
      _schema[field] = inferred;
    }
  }

  return {
    name,
    defaults: frozen,
    _id: nextId++,
    _fields,
    _schema,
  };
}
