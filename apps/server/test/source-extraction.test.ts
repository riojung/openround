import * as yazl from "yazl";
import { describe, expect, it } from "vitest";
import { extractSource } from "../src/source-extraction.js";

async function zip(files: Array<{ path: string; content: string }>) {
  const archive = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const file of files) archive.addBuffer(Buffer.from(file.content), file.path);
  archive.end();
  return completed;
}

function minimalPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 100 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe("private source extraction", () => {
  it("assigns stable paragraph, page, and slide locators", async () => {
    const pasted = await extractSource({
      sourceType: "pasted_text",
      sourceName: "Notes",
      sourceText: "First grounded paragraph.\n\nSecond grounded paragraph.",
      sourceBlob: null,
    });
    expect(pasted.sections).toEqual([
      { locator: "paragraph 1", text: "First grounded paragraph." },
      { locator: "paragraph 2", text: "Second grounded paragraph." },
    ]);

    const document = await zip([
      {
        path: "word/document.xml",
        content:
          '<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const docx = await extractSource({
      sourceType: "docx",
      sourceName: "Guide.docx",
      sourceText: null,
      sourceBlob: document,
    });
    expect(docx.sections).toEqual([
      { locator: "paragraph 1", text: "First paragraph" },
      { locator: "paragraph 2", text: "Second paragraph" },
    ]);

    const slides = await zip([
      {
        path: "ppt/slides/slide2.xml",
        content: '<p:sld xmlns:p="urn:test" xmlns:a="urn:text"><a:t>Second slide</a:t></p:sld>',
      },
      {
        path: "ppt/slides/slide1.xml",
        content: '<p:sld xmlns:p="urn:test" xmlns:a="urn:text"><a:t>First slide</a:t></p:sld>',
      },
    ]);
    const pptx = await extractSource({
      sourceType: "pptx",
      sourceName: "Briefing.pptx",
      sourceText: null,
      sourceBlob: slides,
    });
    expect(pptx.sections).toEqual([
      { locator: "slide 1", text: "First slide" },
      { locator: "slide 2", text: "Second slide" },
    ]);

    const pdf = await extractSource({
      sourceType: "pdf",
      sourceName: "Handout.pdf",
      sourceText: null,
      sourceBlob: minimalPdf("Grounded PDF sentence"),
    });
    expect(pdf.sections).toEqual([{ locator: "page 1", text: "Grounded PDF sentence" }]);
  });

  it("rejects malformed packages and prohibited XML declarations", async () => {
    await expect(
      extractSource({
        sourceType: "docx",
        sourceName: "Wrong.docx",
        sourceText: null,
        sourceBlob: Buffer.from("not-a-zip"),
      }),
    ).rejects.toThrow("ZIP-based Office files");

    const entityDocument = await zip([
      {
        path: "word/document.xml",
        content:
          '<?xml version="1.0"?><!DOCTYPE document [<!ENTITY external SYSTEM "file:///etc/passwd">]><document><p><t>&external;</t></p></document>',
      },
    ]);
    await expect(
      extractSource({
        sourceType: "docx",
        sourceName: "Unsafe.docx",
        sourceText: null,
        sourceBlob: entityDocument,
      }),
    ).rejects.toThrow("prohibited XML declaration");
  });
});
