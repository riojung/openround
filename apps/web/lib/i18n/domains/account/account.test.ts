import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { accountEnglishMessages, loadAccountMessages } from ".";

function placeholders(message: string) {
  return [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
}

describe("account localization catalog", () => {
  it("provides every account message with matching placeholders in every locale", async () => {
    const sourceKeys = Object.keys(accountEnglishMessages).sort();

    for (const locale of supportedLocales) {
      const messages = await loadAccountMessages(locale);
      expect(Object.keys(messages).sort()).toEqual(sourceKeys);

      for (const key of sourceKeys) {
        const messageKey = key as keyof typeof accountEnglishMessages;
        expect(messages[messageKey].trim()).not.toBe("");
        expect(placeholders(messages[messageKey])).toEqual(
          placeholders(accountEnglishMessages[messageKey]),
        );
      }
    }
  });
});
