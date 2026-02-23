import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import iconv from "iconv-lite";
import { parseHtmlPage, buildSectionsFromHtmlBlocks } from "./html.parser";
import { parsePdfBuffer } from "./pdf.parser";
import { buildStructuredDocument } from "../normalizer/structure.builder";
import { SourceUrlEntry, StructuredOutputDocument } from "./scraper.types";

const DATA_DIR = path.join(__dirname, "../../../data");
const SOURCE_LIST_PATH = path.join(DATA_DIR, "source_urls.json");
const RAW_HTML_DIR = path.join(DATA_DIR, "raw_html");
const RAW_PDF_DIR = path.join(DATA_DIR, "raw_pdf");
const CORPUS_DIR = path.join(DATA_DIR, "university_corpus");
const MANIFEST_PATH = path.join(DATA_DIR, "scrape_manifest.json");

const DEFAULT_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

interface RobotsPolicy {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds?: number;
}

interface CrawlQueueItem {
  url: string;
  depth: number;
}

const robotsCache = new Map<string, RobotsPolicy>();
const lastRequestAtByHost = new Map<string, number>();

function ensureDirectories() {
  for (const dir of [DATA_DIR, RAW_HTML_DIR, RAW_PDF_DIR, CORPUS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(input: string): string {
  const transliterated = input
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9а-яіїєґ]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return transliterated || "document";
}

function stripQueryAndHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function inferYear(source: SourceUrlEntry): number | undefined {
  if (typeof source.year === "number") return source.year;
  const match = source.url.match(/(20\d{2})/);
  if (!match) return undefined;
  return Number(match[1]);
}

function readSourceList(): SourceUrlEntry[] {
  if (!fs.existsSync(SOURCE_LIST_PATH)) {
    throw new Error(`Source list not found: ${SOURCE_LIST_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(SOURCE_LIST_PATH, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("data/source_urls.json must contain an array.");
  }
  return parsed as SourceUrlEntry[];
}

function encodingFromContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  const match = contentType.match(/charset=([a-z0-9_\-]+)/i);
  return match?.[1]?.toLowerCase();
}

function encodingFromHtmlMeta(buffer: Buffer): string | undefined {
  const ascii = buffer.toString("ascii");
  const charsetMeta = ascii.match(/<meta[^>]+charset=["']?\s*([a-z0-9_\-]+)/i);
  if (charsetMeta?.[1]) return charsetMeta[1].toLowerCase();
  const equivMeta = ascii.match(
    /<meta[^>]+content=["'][^"']*charset=([a-z0-9_\-]+)/i
  );
  return equivMeta?.[1]?.toLowerCase();
}

function decodeHtml(buffer: Buffer, contentType?: string): string {
  const headerCharset = encodingFromContentType(contentType);
  const metaCharset = encodingFromHtmlMeta(buffer);
  const charset = (headerCharset || metaCharset || "utf-8").toLowerCase();
  if (charset.includes("1251") || charset.includes("windows-1251") || charset.includes("cp1251")) {
    return iconv.decode(buffer, "win1251");
  }
  return iconv.decode(buffer, "utf8");
}

function toCacheFileName(url: string, extension: "html" | "pdf"): string {
  const normalized = stripQueryAndHash(url);
  const hash = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 14);
  const urlPath = new URL(normalized).pathname;
  const base = path.basename(urlPath) || "index";
  const safeBase = slugify(base.replace(/\.[^.]+$/, ""));
  return `${safeBase}_${hash}.${extension}`;
}

function parseRobotsTxt(content: string): RobotsPolicy {
  const rulesByAgent = new Map<string, RobotsPolicy>();
  let currentAgent: string | null = null;

  const getPolicy = (agent: string): RobotsPolicy => {
    const existing = rulesByAgent.get(agent);
    if (existing) return existing;
    const created: RobotsPolicy = { allow: [], disallow: [] };
    rulesByAgent.set(agent, created);
    return created;
  };

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;

    const split = line.split(":");
    if (split.length < 2) continue;
    const key = split[0].trim().toLowerCase();
    const value = split.slice(1).join(":").trim();

    if (key === "user-agent") {
      currentAgent = value.toLowerCase();
      getPolicy(currentAgent);
      continue;
    }

    if (!currentAgent) continue;
    const policy = getPolicy(currentAgent);

    if (key === "allow") policy.allow.push(value);
    if (key === "disallow") policy.disallow.push(value);
    if (key === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        policy.crawlDelaySeconds = parsed;
      }
    }
  }

  return rulesByAgent.get("*") ?? { allow: [], disallow: [] };
}

function robotsPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  if (pattern.endsWith("$")) {
    return new RegExp(`^${escaped.slice(0, -2)}$`);
  }
  return new RegExp(`^${escaped}`);
}

function bestMatchLength(pathAndQuery: string, patterns: string[]): number {
  let max = -1;
  for (const pattern of patterns) {
    if (!pattern) continue;
    const regex = robotsPatternToRegex(pattern);
    if (regex.test(pathAndQuery)) {
      max = Math.max(max, pattern.length);
    }
  }
  return max;
}

function isAllowedByRobots(url: string, policy: RobotsPolicy): boolean {
  const parsed = new URL(url);
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const allowLen = bestMatchLength(pathAndQuery, policy.allow);
  const disallowLen = bestMatchLength(pathAndQuery, policy.disallow);
  if (disallowLen < 0) return true;
  return allowLen >= disallowLen;
}

async function getRobotsPolicy(origin: string): Promise<RobotsPolicy> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  try {
    const response = await axios.get(`${origin}/robots.txt`, {
      timeout: 20_000,
      responseType: "text",
      headers: DEFAULT_REQUEST_HEADERS,
    });
    const parsed = parseRobotsTxt(String(response.data ?? ""));
    robotsCache.set(origin, parsed);
    return parsed;
  } catch {
    const fallback: RobotsPolicy = { allow: [], disallow: [] };
    robotsCache.set(origin, fallback);
    return fallback;
  }
}

async function respectCrawlDelay(url: string, policy: RobotsPolicy) {
  const host = new URL(url).host;
  const crawlDelayMs = Math.max(0, Math.floor((policy.crawlDelaySeconds ?? 0) * 1000));
  if (crawlDelayMs === 0) return;

  const now = Date.now();
  const last = lastRequestAtByHost.get(host);
  if (typeof last === "number") {
    const waitMs = last + crawlDelayMs - now;
    if (waitMs > 0) await sleep(waitMs);
  }
  lastRequestAtByHost.set(host, Date.now());
}

async function fetchHtmlWithCache(url: string, policy: RobotsPolicy): Promise<string> {
  const cachePath = path.join(RAW_HTML_DIR, toCacheFileName(url, "html"));
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, "utf8");
  }

  await respectCrawlDelay(url, policy);
  const response = await axios.get<ArrayBuffer>(url, {
    timeout: 45_000,
    responseType: "arraybuffer",
    headers: DEFAULT_REQUEST_HEADERS,
  });
  const html = decodeHtml(Buffer.from(response.data), response.headers["content-type"]);
  fs.writeFileSync(cachePath, html, "utf8");
  return html;
}

async function fetchBinaryWithCache(url: string, policy: RobotsPolicy): Promise<Buffer> {
  const cachePath = path.join(RAW_PDF_DIR, toCacheFileName(url, "pdf"));
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  await respectCrawlDelay(url, policy);
  const response = await axios.get<ArrayBuffer>(url, {
    timeout: 60_000,
    responseType: "arraybuffer",
    headers: DEFAULT_REQUEST_HEADERS,
  });
  const buffer = Buffer.from(response.data);
  fs.writeFileSync(cachePath, buffer);
  return buffer;
}

function normalizeSourceDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function outputFileName(baseId: string): string {
  return `${slugify(baseId)}.txt`;
}

function persistStructuredDocument(
  source: SourceUrlEntry,
  docId: string,
  title: string,
  url: string,
  scrapedAt: string,
  sections: Array<{ heading?: string; lines: string[] }>
): StructuredOutputDocument | null {
  const structured = buildStructuredDocument({
    documentTitle: title,
    source: normalizeSourceDomain(url),
    year: inferYear(source),
    category: source.category,
    url,
    scrapedAt,
    sections,
  });

  if (!structured || structured.trim().length === 0) return null;

  const fileName = outputFileName(docId);
  const outputPath = path.join(CORPUS_DIR, fileName);
  fs.writeFileSync(outputPath, structured, "utf8");

  return {
    id: docId,
    fileName,
    sourceUrl: url,
    category: source.category,
    year: inferYear(source),
    documentTitle: title,
    scrapedAt,
    outputPath,
  };
}

function inferIncludePathPrefix(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  if (parsed.pathname.endsWith("/")) return parsed.pathname;
  const index = parsed.pathname.lastIndexOf("/");
  if (index < 0) return "/";
  return parsed.pathname.slice(0, index + 1);
}

async function crawlHtmlSource(source: SourceUrlEntry, policy: RobotsPolicy) {
  const baseUrl = source.url;
  const baseHost = new URL(baseUrl).host;
  const maxDepth = Math.max(0, source.crawlDepth ?? 0);
  const maxPages = Math.max(1, source.maxPages ?? 1);
  const includePrefix = source.includePathPrefix ?? inferIncludePathPrefix(baseUrl);

  const queue: CrawlQueueItem[] = [{ url: baseUrl, depth: 0 }];
  const visited = new Set<string>();
  const pages: ReturnType<typeof parseHtmlPage>[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift()!;
    const normalizedUrl = stripQueryAndHash(current.url);
    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    if (!isAllowedByRobots(current.url, policy)) {
      console.warn(`Skipping blocked URL by robots.txt: ${current.url}`);
      continue;
    }

    const html = await fetchHtmlWithCache(current.url, policy);
    const parsed = parseHtmlPage(html, current.url);
    pages.push(parsed);

    if (current.depth >= maxDepth) continue;

    for (const candidate of parsed.internalLinks) {
      let parsedCandidate: URL;
      try {
        parsedCandidate = new URL(candidate);
      } catch {
        continue;
      }

      if (parsedCandidate.host !== baseHost) continue;
      if (!parsedCandidate.pathname.startsWith(includePrefix)) continue;
      if (visited.has(stripQueryAndHash(parsedCandidate.toString()))) continue;
      queue.push({
        url: parsedCandidate.toString(),
        depth: current.depth + 1,
      });
    }
  }

  return pages;
}

async function processPdfLink(
  source: SourceUrlEntry,
  pdfUrl: string,
  linkText: string,
  pdfIndex: number,
  policy: RobotsPolicy,
  scrapedAt: string
): Promise<StructuredOutputDocument | null> {
  if (!isAllowedByRobots(pdfUrl, policy)) {
    console.warn(`Skipping blocked PDF URL by robots.txt: ${pdfUrl}`);
    return null;
  }

  const buffer = await fetchBinaryWithCache(pdfUrl, policy);
  const parsed = await parsePdfBuffer(buffer, linkText || source.title);
  const baseId = source.id ?? slugify(`${source.category}_${source.title ?? "document"}`);
  const docId = `${baseId}_pdf_${pdfIndex + 1}`;

  return persistStructuredDocument(
    source,
    docId,
    parsed.title || linkText || source.title || "PDF document",
    pdfUrl,
    scrapedAt,
    parsed.sections
  );
}

async function processHtmlSource(
  source: SourceUrlEntry,
  policy: RobotsPolicy,
  scrapedAt: string
): Promise<StructuredOutputDocument[]> {
  const pages = await crawlHtmlSource(source, policy);
  const documents: StructuredOutputDocument[] = [];
  const baseId = source.id ?? slugify(`${source.category}_${source.title ?? "document"}`);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const sections = buildSectionsFromHtmlBlocks(page.blocks, page.title);
    const suffix = pageIndex === 0 ? "" : `_p${pageIndex + 1}`;
    const docId = `${baseId}${suffix}`;
    const title = page.title || source.title || "Untitled page";

    const doc = persistStructuredDocument(
      source,
      docId,
      title,
      page.url,
      scrapedAt,
      sections
    );
    if (doc) documents.push(doc);

    if (!source.includePdfLinks) continue;
    const pdfLinks = page.fileLinks
      .filter((link) => link.extension === "pdf")
      .slice(0, Math.max(0, source.maxPdfLinks ?? 10));

    for (let i = 0; i < pdfLinks.length; i++) {
      const link = pdfLinks[i];
      try {
        const pdfDoc = await processPdfLink(
          source,
          link.url,
          link.text,
          i,
          policy,
          scrapedAt
        );
        if (pdfDoc) documents.push(pdfDoc);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to process PDF ${link.url}: ${message}`);
      }
    }
  }

  return documents;
}

async function processSingleSource(
  source: SourceUrlEntry,
  scrapedAt: string
): Promise<StructuredOutputDocument[]> {
  const origin = new URL(source.url).origin;
  const policy = await getRobotsPolicy(origin);
  if (!isAllowedByRobots(source.url, policy)) {
    console.warn(`Skipping blocked source by robots.txt: ${source.url}`);
    return [];
  }

  if (source.type === "html") {
    return processHtmlSource(source, policy, scrapedAt);
  }

  if (source.type === "pdf") {
    const doc = await processPdfLink(
      source,
      source.url,
      source.title ?? "PDF document",
      0,
      policy,
      scrapedAt
    );
    return doc ? [doc] : [];
  }

  console.warn(`Unsupported source type "${source.type}" for URL: ${source.url}`);
  return [];
}

export async function runLuteScrape(): Promise<StructuredOutputDocument[]> {
  ensureDirectories();
  const sources = readSourceList();
  const scrapedAt = new Date().toISOString().slice(0, 10);
  const allDocs: StructuredOutputDocument[] = [];

  for (const source of sources) {
    try {
      const docs = await processSingleSource(source, scrapedAt);
      allDocs.push(...docs);
      console.log(
        `Source processed: ${source.url} -> ${docs.length} output document(s)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed source ${source.url}: ${message}`);
    }
  }

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        scrapedAt,
        sourceCount: sources.length,
        outputCount: allDocs.length,
        documents: allDocs,
      },
      null,
      2
    ),
    "utf8"
  );

  return allDocs;
}

if (require.main === module) {
  runLuteScrape()
    .then((docs) => {
      console.log(
        `Scraping complete. Created ${docs.length} structured document(s) in ${CORPUS_DIR}`
      );
    })
    .catch((error) => {
      console.error("Scraping failed:", error);
      process.exitCode = 1;
    });
}
