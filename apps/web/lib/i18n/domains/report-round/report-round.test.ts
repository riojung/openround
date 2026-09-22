import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { loadReportRoundMessages, reportRoundEnglishMessages } from ".";

function placeholders(message: string) {
  return [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
}

describe("report and Round localization catalog", () => {
  it("provides every message with matching placeholders in every locale", async () => {
    const sourceKeys = Object.keys(reportRoundEnglishMessages).sort();

    for (const locale of supportedLocales) {
      const messages = await loadReportRoundMessages(locale);
      expect(Object.keys(messages).sort()).toEqual(sourceKeys);

      for (const key of sourceKeys) {
        const messageKey = key as keyof typeof reportRoundEnglishMessages;
        expect(messages[messageKey].trim()).not.toBe("");
        expect(placeholders(messages[messageKey])).toEqual(
          placeholders(reportRoundEnglishMessages[messageKey]),
        );
      }
    }
  });

  it("ships reviewed Japanese and Traditional Chinese Round terminology", async () => {
    const japanese = await loadReportRoundMessages("ja-JP");
    const traditionalChinese = await loadReportRoundMessages("zh-TW");

    expect(japanese["reportRound.assign.description"]).toContain("アカウント不要");
    expect(japanese["reportRound.rehearsal.scenario.split_room.description"]).toContain("五分五分");
    expect(japanese["reportRound.editor.history.recheckAdded"]).toBe(
      "再確認用の質問を追加しました。",
    );
    expect(traditionalChinese["reportRound.assign.description"]).toContain("無需帳號");
    expect(traditionalChinese["reportRound.rehearsal.roundEvidence"]).toBe("互動測驗證據");
    expect(traditionalChinese["reportRound.editor.history.recheckAdded"]).toBe("已新增複測問題。");
  });
});
