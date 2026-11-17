/**
 * Canonical JSON: one text for one value, whatever the runtime or the order keys were set in.
 * The engine hashes it for `inputHash` (spec §5.1), so two runtimes given equal inputs agree.
 *
 * - Object keys are sorted by UTF-16 code unit (`Array.prototype.sort`'s default order).
 * - Properties whose value is `undefined` are left out, as `JSON.stringify` does; in arrays they
 *   are `null`.
 * - Numbers use JavaScript's shortest round-trip form (the same in every engine); `-0` is `0`.
 *   NaN and ±Infinity throw: they have no JSON form, and a valid input never holds them.
 * - Strings use `JSON.stringify`'s escaping. Typed arrays are written as plain arrays.
 * - Anything else that isn't plain data (functions, symbols, bigint, class instances other than
 *   arrays) throws, so a hash can never silently depend on something it didn't read.
 */
export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

function write(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError(`canonicalJson: ${path} is ${v}, which has no JSON form`);
      return Object.is(v, -0) ? "0" : JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: ${path} is a ${typeof v}, not JSON data`);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => (x === undefined ? "null" : write(x, `${path}[${i}]`))).join(",")}]`;
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return write(Array.from(v as unknown as ArrayLike<number>), path);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`canonicalJson: ${path} is a ${proto?.constructor?.name ?? "class instance"}, not plain data`);
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${write(obj[k], `${path}.${k}`)}`).join(",")}}`;
}
