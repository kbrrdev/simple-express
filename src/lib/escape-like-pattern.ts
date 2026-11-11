/** Makes `%`, `_`, and `\` in a search match themselves in an `ilike` pattern. */
export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
