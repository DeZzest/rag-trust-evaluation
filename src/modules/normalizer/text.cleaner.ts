const COOKIE_PATTERNS: RegExp[] = [
  /\bcookie(s)?\b/i,
  /\bgdpr\b/i,
  /\bprivacy policy\b/i,
  /політика конфіденційності/i,
  /cookies? policy/i,
];

const CONTACT_PATTERNS: RegExp[] = [
  /\b(e-?mail|email)\b/i,
  /\bтел\.?\b/i,
  /\bphone\b/i,
  /\+?\d[\d\s\-()]{7,}/,
  /\bcontact(s)?\b/i,
];

const JS_NOISE_PATTERNS: RegExp[] = [
  /^\s*function\s*\(/i,
  /^\s*var\s+[a-zA-Z_$]/,
  /^\s*\$\(/,
  /^\s*window\./,
  /^\s*document\./,
  /^\s*ga\(/,
  /^\s*analytics/i,
];

const FOOTER_PATTERNS: RegExp[] = [
  /^copyright\b/i,
  /^all rights reserved\b/i,
  /^всі права застережено\b/i,
  /^©/i,
];

function normalizeQuotes(input: string): string {
  return input
    .replace(/[“”„‟«»]/g, "\"")
    .replace(/[‘’‚‛]/g, "'");
}

function cleanupWhitespace(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shouldDropLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length <= 1) return true;

  if (COOKIE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (FOOTER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (JS_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;

  const looksLikeContact = CONTACT_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (looksLikeContact && trimmed.length <= 140) return true;

  return false;
}

export function cleanText(input: string): string {
  if (!input || input.trim().length === 0) return "";

  const normalized = normalizeQuotes(input);
  const withoutHtmlTags = normalized.replace(/<[^>]+>/g, " ");
  const base = cleanupWhitespace(withoutHtmlTags);

  const lines = base.split("\n");
  const cleanedLines: string[] = [];
  for (const line of lines) {
    const compact = line.replace(/[ ]{2,}/g, " ").trim();
    if (shouldDropLine(compact)) continue;
    cleanedLines.push(compact);
  }

  return cleanupWhitespace(cleanedLines.join("\n"));
}

export function cleanTextLines(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    const cleaned = cleanText(line);
    if (!cleaned) continue;
    for (const piece of cleaned.split("\n")) {
      const trimmed = piece.trim();
      if (trimmed.length > 0) output.push(trimmed);
    }
  }
  return output;
}
