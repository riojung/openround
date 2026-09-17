import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AuthoringDraftSchema,
  QuizContentSchema,
  type AuthoringDraft,
  type QuestionDraft,
} from "@openround/contracts";
import type { ExtractedSource } from "./source-extraction.js";

const GeneratedChoiceSchema = z.object({
  label: z.string().trim().min(1).max(180),
  isCorrect: z.boolean(),
  rationale: z.string().trim().min(1).max(500),
  misconceptionLabel: z.string().trim().min(1).max(80).nullable().optional(),
});

const GeneratedCommonSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  purpose: z.enum(["diagnostic", "practice"]).default("diagnostic"),
  confidence: z.enum(["off", "optional", "required"]).default("optional"),
  explanation: z.string().trim().min(1).max(1_000),
  timeLimitSeconds: z.number().int().min(10).max(120).default(30),
  citationIndexes: z.array(z.number().int().nonnegative()).min(1).max(5),
});

const GeneratedChoiceCheckpointSchema = GeneratedCommonSchema.extend({
  type: z.enum(["single_select", "true_false", "multi_select"]),
  choices: z.array(GeneratedChoiceSchema).min(2).max(6),
});

const GeneratedNumericCheckpointSchema = GeneratedCommonSchema.extend({
  type: z.literal("numeric"),
  correctValue: z.string().trim().min(1).max(64),
  tolerance: z.string().trim().min(1).max(64).default("0"),
  unit: z.string().trim().max(32).nullable().default(null),
});

const GeneratedCheckpointSchema = z.discriminatedUnion("type", [
  GeneratedChoiceCheckpointSchema,
  GeneratedNumericCheckpointSchema,
]);

const GeneratedOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  conceptKey: z.string().trim().min(1).max(64),
  citations: z
    .array(
      z.object({
        locator: z.string().trim().min(1).max(120),
        excerpt: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(10),
  main: GeneratedCheckpointSchema,
  recheck: GeneratedCheckpointSchema,
});

export interface AuthoringAssistant {
  readonly providerName: string;
  readonly modelName: string;
  generate(source: ExtractedSource): Promise<unknown>;
}

async function limitedResponseText(response: Response, maximumBytes = 2_000_000) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("Authoring provider response exceeded the 2 MB limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Authoring provider response exceeded the 2 MB limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function promptSource(source: ExtractedSource) {
  let remaining = 60_000;
  const chunks: string[] = [];
  for (const section of source.sections) {
    if (remaining <= 0) break;
    const heading = `[${section.locator}]\n`;
    const text = section.text.slice(0, Math.max(0, remaining - heading.length));
    chunks.push(`${heading}${text}`);
    remaining -= heading.length + text.length;
  }
  return chunks.join("\n\n");
}

export class OpenAiCompatibleAuthoringAssistant implements AuthoringAssistant {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
    public readonly modelName: string,
    public readonly providerName: string,
  ) {}

  async generate(source: ExtractedSource) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.modelName,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You create assessment drafts only from supplied source text. Return JSON and nothing else. Create one main checkpoint and one conceptually equivalent but differently worded recheck. Use only single_select, true_false, multi_select, or numeric. Every distractor needs a concise rationale and misconception label. Citations must copy a short exact excerpt and use an exact locator from the source. Never invent facts, citations, or learner data.",
          },
          {
            role: "user",
            content: `Source: ${source.sourceName}\n\n${promptSource(source)}\n\nReturn this shape: {"title":"...","description":"...","conceptKey":"lowercase-slug","citations":[{"locator":"page 1, slide 2, or paragraph 3","excerpt":"exact source text"}],"main":{"type":"single_select|true_false|multi_select|numeric","prompt":"...","purpose":"diagnostic|practice","confidence":"off|optional|required","explanation":"...","timeLimitSeconds":30,"citationIndexes":[0],"choices":[{"label":"...","isCorrect":true,"rationale":"...","misconceptionLabel":null}]},"recheck":{same checkpoint shape and citationIndexes}}. Numeric checkpoints use correctValue, tolerance, and unit instead of choices.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Authoring provider returned ${response.status}`);
    }
    let body: {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    try {
      body = JSON.parse(await limitedResponseText(response)) as typeof body;
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error("Authoring provider returned invalid JSON", { cause: error });
      throw error;
    }
    const content = body.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((item) => item.text ?? "").join("") : content;
    if (!text) throw new Error("Authoring provider returned no structured output");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Authoring provider output was not valid JSON");
    }
  }
}

function conceptKey(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || `concept-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

function normalizedEvidence(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-CA");
}

function checkpoint(
  generated: z.infer<typeof GeneratedCheckpointSchema>,
  id: string,
  delivery: "main" | "recheck",
  linkedRecheckQuestionId: string | null,
  normalizedConceptKey: string,
  sourceName: string,
  sourceDigest: string,
  citations: z.infer<typeof GeneratedOutputSchema>["citations"],
): QuestionDraft {
  const common = {
    id,
    prompt: generated.prompt,
    purpose: generated.purpose,
    confidence: generated.confidence,
    delivery,
    conceptKeys: [normalizedConceptKey],
    linkedRecheckQuestionId,
    timeLimitSeconds: generated.timeLimitSeconds,
    basePoints: delivery === "main" ? 1_000 : 0,
    explanation: generated.explanation,
    mediaId: null,
    mediaAlt: null,
    sourceCitations: generated.citationIndexes.map((index) => ({
      sourceName,
      sourceDigest,
      ...citations[index]!,
    })),
  };
  if (generated.type === "numeric") {
    return {
      ...common,
      type: "numeric",
      correctValue: generated.correctValue,
      tolerance: generated.tolerance,
      unit: generated.unit,
    };
  }
  return {
    ...common,
    type: generated.type,
    choices: generated.choices.map((choice) => ({
      id: randomUUID(),
      label: choice.label,
      isCorrect: choice.isCorrect,
      feedback: choice.rationale,
      misconceptionKey:
        !choice.isCorrect && choice.misconceptionLabel
          ? conceptKey(choice.misconceptionLabel)
          : null,
    })),
  };
}

export function validateAuthoringOutput(input: {
  raw: unknown;
  source: ExtractedSource;
  sourceDigest: string;
  provider: string;
  model: string;
  generatedAt: Date;
}): AuthoringDraft {
  const generated = GeneratedOutputSchema.parse(input.raw);
  const sections = new Map(
    input.source.sections.map((section) => [section.locator, normalizedEvidence(section.text)]),
  );
  for (const citation of generated.citations) {
    const sourceText = sections.get(citation.locator);
    if (!sourceText) throw new Error(`Citation locator is not in the source: ${citation.locator}`);
    if (!sourceText.includes(normalizedEvidence(citation.excerpt))) {
      throw new Error(`Citation excerpt is not grounded in ${citation.locator}`);
    }
  }
  for (const item of [generated.main, generated.recheck]) {
    if (item.citationIndexes.some((index) => !generated.citations[index])) {
      throw new Error("Checkpoint references a citation that does not exist");
    }
  }
  if (generated.main.prompt === generated.recheck.prompt) {
    throw new Error("The linked recheck must be worded differently from the main checkpoint");
  }
  const normalizedConceptKey = conceptKey(generated.conceptKey);
  const mainId = randomUUID();
  const recheckId = randomUUID();
  const main = checkpoint(
    generated.main,
    mainId,
    "main",
    recheckId,
    normalizedConceptKey,
    input.source.sourceName,
    input.sourceDigest,
    generated.citations,
  );
  const recheck = checkpoint(
    generated.recheck,
    recheckId,
    "recheck",
    null,
    normalizedConceptKey,
    input.source.sourceName,
    input.sourceDigest,
    generated.citations,
  );
  const checkpointSet = QuizContentSchema.parse({
    title: generated.title,
    description: generated.description,
    questions: [main, recheck],
  });
  const citations = [
    ...generated.main.citationIndexes.map((index) => ({
      checkpointId: mainId,
      ...generated.citations[index]!,
    })),
    ...generated.recheck.citationIndexes.map((index) => ({
      checkpointId: recheckId,
      ...generated.citations[index]!,
    })),
  ];
  return AuthoringDraftSchema.parse({
    schemaVersion: 1,
    sourceName: input.source.sourceName,
    sourceDigest: input.sourceDigest,
    checkpointSet,
    citations,
    generatedAt: input.generatedAt.toISOString(),
    provider: input.provider,
    model: input.model,
  });
}
