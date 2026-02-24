export type SourceType = "html" | "pdf" | "doc" | "docx";

export interface SourceUrlEntry {
  id?: string;
  type: SourceType;
  category: string;
  year?: number;
  url: string;
  title?: string;
  crawlDepth?: number;
  maxPages?: number;
  includePathPrefix?: string;
  includePdfLinks?: boolean;
  maxPdfLinks?: number;
}

export interface HtmlContentBlock {
  tag: "h1" | "h2" | "h3" | "p" | "li";
  text: string;
}

export interface ExtractedFileLink {
  url: string;
  text: string;
  extension: string;
}

export interface ParsedHtmlPage {
  url: string;
  title: string;
  blocks: HtmlContentBlock[];
  fileLinks: ExtractedFileLink[];
  internalLinks: string[];
}

export interface StructuredOutputDocument {
  id: string;
  fileName: string;
  sourceUrl: string;
  category: string;
  year?: number;
  documentTitle: string;
  scrapedAt: string;
  outputPath: string;
}
