import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Report } from "@openround/contracts";
import { reportCsv } from "../src/reporting.js";

describe("report CSV", () => {
  it("neutralizes spreadsheet formulas in participant-controlled nicknames", () => {
    const dangerousNicknames = ["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTDATA(A1)", "\t=1+1"];
    const report: Report = {
      id: randomUUID(),
      sessionId: randomUUID(),
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metrics: {
        participantCount: dangerousNicknames.length + 1,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [...dangerousNicknames, "Safe nickname"].map((nickname) => ({
        participantId: randomUUID(),
        nickname,
        score: 0,
        correctCount: 0,
        answerCount: 0,
      })),
    };

    const csv = reportCsv(report);

    for (const nickname of dangerousNicknames) expect(csv).toContain(`'${nickname}`);
    expect(csv).toContain(",Safe nickname,0,0,0");
    expect(csv).not.toMatch(/,[=+@-]/);
  });
});
