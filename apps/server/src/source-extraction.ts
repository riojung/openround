import { Worker } from "node:worker_threads";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as yauzl from "yauzl";
import type { AuthoringSourceType } from "@openround/contracts";

const MAX_SOURCE_BYTES = 6_000_000;
const MAX_EXPANDED_BYTES = 30_000_000;
const MAX_ENTRY_BYTES = 8_000_000;
const MAX_ENTRIES = 500;
const MAX_COMPRESSION_RATIO = 200;
const MAX_PAGES = 100;
const MAX_EXTRACTED_CHARACTERS = 100_000;

export interface SourceExtractionInput {
  sourceType: AuthoringSourceType;
  sourceName: string;
  sourceText: string | null;
  sourceBlob: Buffer | Uint8Array | null;
}

export interface ExtractedSection {
  locator: string;
  text: string;
}

export interface ExtractedSource {
  sourceName: string;
  sourceType: AuthoringSourceType;
  sections: ExtractedSection[];
  characterCount: number;
  truncated?: boolean;
}

function cleanText(value: string) {
  const withoutControlCharacters = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
  return withoutControlCharacters
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function enforceTextLimit(sections: ExtractedSection[]) {
  const originalCharacterCount = sections.reduce(
    (total, section) => total + cleanText(section.text).length,
    0,
  );
  let remaining = MAX_EXTRACTED_CHARACTERS;
  const limited: ExtractedSection[] = [];
  for (const section of sections) {
    if (remaining <= 0) break;
    const text = cleanText(section.text).slice(0, remaining);
    if (!text) continue;
    limited.push({ locator: section.locator, text });
    remaining -= text.length;
  }
  if (!limited.length) throw new Error("No readable source text was found");
  return {
    sections: limited,
    characterCount: limited.reduce((total, section) => total + section.text.length, 0),
    truncated: originalCharacterCount > MAX_EXTRACTED_CHARACTERS,
  };
}

function safeArchivePath(path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe document archive path: ${path || "(empty)"}`);
  }
}

async function readStream(stream: NodeJS.ReadableStream, maximum: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? Buffer.from(raw)
        : Buffer.from(raw as Uint8Array);
    size += chunk.length;
    if (size > maximum) throw new Error("Document archive entry is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readOfficeXml(buffer: Buffer, wanted: (path: string) => boolean) {
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("Source file exceeds the 6 MB limit");
  if (buffer.subarray(0, 2).toString("binary") !== "PK") {
    throw new Error("DOCX and PPTX sources must be ZIP-based Office files");
  }
  const archive = await yauzl.fromBufferPromise(buffer, {
    autoClose: true,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  if (archive.entryCount > MAX_ENTRIES) {
    archive.close();
    throw new Error(`Document contains more than ${MAX_ENTRIES} archive entries`);
  }
  const files = new Map<string, Buffer>();
  let total = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      safeArchivePath(entry.fileName);
      if (entry.fileName.endsWith("/")) continue;
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error("Encrypted or unsupported Office documents cannot be extracted");
      }
      total += entry.uncompressedSize;
      if (total > MAX_EXPANDED_BYTES) throw new Error("Expanded document exceeds 30 MB");
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
      ) {
        throw new Error(`Suspicious compression ratio in ${entry.fileName}`);
      }
      if (!wanted(entry.fileName)) continue;
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`Document XML entry is too large: ${entry.fileName}`);
      }
      files.set(
        entry.fileName,
        await readStream(await archive.openReadStreamPromise(entry), MAX_ENTRY_BYTES),
      );
    }
  } finally {
    if (archive.isOpen) archive.close();
  }
  return files;
}

const officeParser = new XMLParser({
  preserveOrder: true,
  removeNSPrefix: true,
  ignoreAttributes: true,
  processEntities: true,
  maxNestedTags: 100,
});

function parseOfficeXml(buffer: Buffer, fileName: string) {
  const source = buffer.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error(`${fileName} contains a prohibited XML declaration`);
  }
  const valid = XMLValidator.validate(source);
  if (valid !== true) throw new Error(`${fileName} contains malformed XML`);
  return officeParser.parse(source) as unknown[];
}

function collectTagText(value: unknown, containerTag: string, textTag: string) {
  const results: string[] = [];
  const textWithin = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(textWithin);
    if (!node || typeof node !== "object") return [];
    const object = node as Record<string, unknown>;
    const output: string[] = [];
    for (const [key, child] of Object.entries(object)) {
      if (key === textTag) output.push(...textWithin(child));
      else if (key === "#text" && typeof child === "string") output.push(child);
      else output.push(...textWithin(child));
    }
    return output;
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === containerTag) {
        const text = cleanText(textWithin(child).join(" "));
        if (text) results.push(text);
      } else walk(child);
    }
  };
  walk(value);
  return results;
}

async function extractDocx(buffer: Buffer) {
  const files = await readOfficeXml(buffer, (path) => path === "word/document.xml");
  const document = files.get("word/document.xml");
  if (!document) throw new Error("DOCX package has no word/document.xml");
  return collectTagText(parseOfficeXml(document, "word/document.xml"), "p", "t")
    .slice(0, 1_000)
    .map((text, index) => ({ locator: `paragraph ${index + 1}`, text }));
}

async function extractPptx(buffer: Buffer) {
  const files = await readOfficeXml(buffer, (path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
  const slides = [...files.entries()].sort((left, right) => {
    const leftNumber = Number(left[0].match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    const rightNumber = Number(right[0].match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    return leftNumber - rightNumber;
  });
  if (!slides.length) throw new Error("PPTX package contains no slides");
  if (slides.length > MAX_PAGES)
    throw new Error(`PPTX sources support at most ${MAX_PAGES} slides`);
  return slides.map(([path, content], index) => ({
    locator: `slide ${index + 1}`,
    text: collectTagText(parseOfficeXml(content, path), "t", "t").join("\n"),
  }));
}

async function extractPdf(buffer: Buffer) {
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("Source file exceeds the 6 MB limit");
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF source does not have a valid PDF signature");
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  try {
    if (document.numPages > MAX_PAGES) {
      throw new Error(`PDF sources support at most ${MAX_PAGES} pages`);
    }
    const sections: ExtractedSection[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const content = text.items
        .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
        .join(" ");
      sections.push({ locator: `page ${pageNumber}`, text: content });
      page.cleanup();
    }
    return sections;
  } finally {
    await task.destroy();
  }
}

function extractPastedText(text: string) {
  const paragraphs = cleanText(text)
    .split(/\n{2,}/)
    .map(cleanText)
    .filter(Boolean);
  return (paragraphs.length ? paragraphs : [cleanText(text)]).map((paragraph, index) => ({
    locator: `paragraph ${index + 1}`,
    text: paragraph,
  }));
}

export async function extractSource(input: SourceExtractionInput): Promise<ExtractedSource> {
  let sections: ExtractedSection[];
  if (input.sourceType === "pasted_text") {
    if (!input.sourceText) throw new Error("Pasted source text is missing");
    sections = extractPastedText(input.sourceText);
  } else {
    if (!input.sourceBlob) throw new Error("Uploaded source file is missing");
    const buffer = Buffer.from(input.sourceBlob);
    sections =
      input.sourceType === "pdf"
        ? await extractPdf(buffer)
        : input.sourceType === "docx"
          ? await extractDocx(buffer)
          : await extractPptx(buffer);
  }
  const limited = enforceTextLimit(sections);
  return {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    ...limited,
  };
}

export async function extractSourceIsolated(
  input: SourceExtractionInput,
  timeoutMs: number,
): Promise<ExtractedSource> {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const worker = new Worker(new URL(`./source-extraction-worker.${extension}`, import.meta.url), {
    workerData: input,
    execArgv: extension === "ts" ? process.execArgv : [],
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
  });
  return new Promise<ExtractedSource>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new Error("Source extraction exceeded its time limit")));
    }, timeoutMs);
    worker.once("message", (message: { result?: ExtractedSource; error?: string }) => {
      void worker.terminate();
      finish(() => {
        if (message.result) resolve(message.result);
        else reject(new Error(message.error ?? "Source extraction failed"));
      });
    });
    worker.once("error", (error) => {
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`Source extraction worker exited with code ${code}`)));
      }
    });
  });
}
