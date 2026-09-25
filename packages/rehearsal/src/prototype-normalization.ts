export function normalizePrototypeConceptKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
