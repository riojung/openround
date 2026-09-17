import { parentPort, workerData } from "node:worker_threads";
import type { ExtractedSource, SourceExtractionInput } from "./source-extraction.js";

if (!parentPort) throw new Error("Source extraction worker requires a parent port");

try {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const moduleUrl = new URL(`./source-extraction.${extension}`, import.meta.url).href;
  const { extractSource } = (await import(moduleUrl)) as {
    extractSource(input: SourceExtractionInput): Promise<ExtractedSource>;
  };
  const result = await extractSource(workerData as SourceExtractionInput);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : "Source extraction failed",
  });
}
