/**
 * Exact synthetic text emitted by parsers when there is no usable body.
 * These strings are structural placeholders, not university-document evidence.
 * We deliberately do not reject short but meaningful regulations or titles.
 */
export function isNonEvidenceLine(input: string): boolean {
  const normalized = input.replace(/\s+/g, " ").trim();
  return (
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(normalized) ||
    /^No structured content extracted\.?$/i.test(normalized)
  );
}
