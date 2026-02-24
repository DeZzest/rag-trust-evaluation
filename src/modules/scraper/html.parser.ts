import { load } from "cheerio";
import { SectionSeed } from "../normalizer/structure.builder";
import {
  HtmlContentBlock,
  ParsedHtmlPage,
  ExtractedFileLink,
} from "./scraper.types";

const DROP_SELECTORS: string[] = [
  "script",
  "style",
  "noscript",
  "iframe",
  "header",
  "footer",
  "nav",
  "#footer",
  "#header",
  "#mainnavi",
  "#topnavi",
  "#quicksearch",
  "#languages",
  "#rightColumn",
  "#leftColumn",
  "#breadcrumbs",
  ".breadcrumbs",
  ".cookie",
  ".cookies",
  ".sidebar",
  ".menu",
  ".fce-box-special",
  ".fce-box-orange",
  ".csc-textpic-imagewrap",
  ".divider",
];

const CONTENT_SELECTORS: string[] = [
  "#mainColumn .content",
  "#mainColumn",
  "main article",
  "main",
  "article",
  ".content",
  "body",
];

function toAbsoluteUrl(baseUrl: string, href: string): string | null {
  try {
    if (!href || href.startsWith("#")) return null;
    if (/^(javascript:|mailto:|tel:)/i.test(href)) return null;
    if (/^(fileadmin|uploads|typo3temp|typo3conf)\//i.test(href)) {
      const origin = new URL(baseUrl).origin;
      return `${origin}/${href}`;
    }
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function detectBestContentSelector(html: string): string {
  const $ = load(html);
  for (const selector of CONTENT_SELECTORS) {
    const element = $(selector).first();
    if (element.length === 0) continue;
    const textLength = element.text().replace(/\s+/g, " ").trim().length;
    if (textLength >= 120) return selector;
  }
  return "body";
}

function isLikelyNoise(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length <= 1) return true;
  if (normalized.includes("всі права застережено")) return true;
  if (normalized.includes("copyright")) return true;
  if (normalized.includes("cookies")) return true;
  return false;
}

function extractContentBlocks(html: string, selectedRoot: string): HtmlContentBlock[] {
  const $ = load(html);
  const root = $(selectedRoot).first().clone();
  if (root.length === 0) return [];

  for (const selector of DROP_SELECTORS) {
    root.find(selector).remove();
  }

  const blocks: HtmlContentBlock[] = [];
  const seen = new Set<string>();

  root.find("h1, h2, h3, p, li").each((_index, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag || !["h1", "h2", "h3", "p", "li"].includes(tag)) return;

    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (isLikelyNoise(text)) return;

    const dedupeKey = `${tag}:${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    blocks.push({
      tag: tag as HtmlContentBlock["tag"],
      text,
    });
  });

  return blocks;
}

function extractLinks(
  html: string,
  selectedRoot: string,
  pageUrl: string
): Pick<ParsedHtmlPage, "fileLinks" | "internalLinks"> {
  const $ = load(html);
  const baseHrefRaw = $("base").attr("href");
  const baseHref = baseHrefRaw
    ? toAbsoluteUrl(pageUrl, baseHrefRaw) ?? pageUrl
    : pageUrl;
  const root = $(selectedRoot).first().clone();
  if (root.length === 0) {
    return { fileLinks: [], internalLinks: [] };
  }

  const fileLinks: ExtractedFileLink[] = [];
  const internalLinks: string[] = [];
  const seenFiles = new Set<string>();
  const seenInternal = new Set<string>();
  const host = new URL(pageUrl).host;

  root.find("a[href]").each((_index, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = toAbsoluteUrl(baseHref, href);
    if (!absolute) return;

    const linkText = $(el).text().replace(/\s+/g, " ").trim();
    const extensionMatch = absolute.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    const extension = extensionMatch?.[1]?.toLowerCase();

    if (extension && ["pdf", "doc", "docx", "txt", "rtf", "jpg", "jpeg", "png"].includes(extension)) {
      if (!seenFiles.has(absolute)) {
        fileLinks.push({
          url: absolute,
          text: linkText,
          extension,
        });
        seenFiles.add(absolute);
      }
      return;
    }

    try {
      const parsed = new URL(absolute);
      if (parsed.host !== host) return;
      if (seenInternal.has(parsed.toString())) return;
      seenInternal.add(parsed.toString());
      internalLinks.push(parsed.toString());
    } catch {
      // Ignore malformed URLs.
    }
  });

  return { fileLinks, internalLinks };
}

export function parseHtmlPage(html: string, pageUrl: string): ParsedHtmlPage {
  const $ = load(html);
  const selectedRoot = detectBestContentSelector(html);
  const blocks = extractContentBlocks(html, selectedRoot);
  const links = extractLinks(html, selectedRoot, pageUrl);

  const pageTitle =
    $("#pagetitle").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    "Untitled page";

  return {
    url: pageUrl,
    title: pageTitle,
    blocks,
    fileLinks: links.fileLinks,
    internalLinks: links.internalLinks,
  };
}

export function buildSectionsFromHtmlBlocks(
  blocks: HtmlContentBlock[],
  defaultHeading: string
): SectionSeed[] {
  const sections: SectionSeed[] = [];
  let currentHeading = defaultHeading;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({
      heading: currentHeading,
      lines: currentLines,
    });
    currentLines = [];
  };

  for (const block of blocks) {
    if (block.tag === "h2" || block.tag === "h3") {
      flush();
      currentHeading = block.text;
      continue;
    }

    if (block.tag === "h1") {
      if (currentLines.length === 0 && sections.length === 0) {
        currentHeading = block.text;
      } else {
        flush();
        currentHeading = block.text;
      }
      continue;
    }

    currentLines.push(block.text);
  }

  flush();

  if (sections.length === 0) {
    const fallback = blocks.map((block) => block.text).filter(Boolean);
    if (fallback.length > 0) {
      sections.push({
        heading: defaultHeading,
        lines: fallback,
      });
    }
  }

  return sections;
}
