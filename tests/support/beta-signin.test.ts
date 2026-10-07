import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const betaDirectory = new URL("../beta-e2e/", import.meta.url);

describe("beta sign-in fixture contract", () => {
  it("uses one asserted keyboard activation and verifies acknowledged policy consent", async () => {
    const helper = await readFile(new URL("sign-in.ts", betaDirectory), "utf8");
    expect(helper).toContain("await expect(policyConsent).toBeEnabled()");
    expect(helper).toContain("await expect(policyConsent).not.toBeChecked()");
    expect(helper).toContain("await policyConsent.focus()");
    expect(helper).toContain("await expect(policyConsent).toBeFocused()");
    expect(helper.match(/policyConsent\.press\("Space"\)/g)).toHaveLength(1);
    expect(helper).toContain("await expect(policyConsent).toBeChecked()");
    expect(helper).toContain("await expect(sendLink).toBeEnabled()");
    expect(helper).toContain("expect(response.status()).toBe(202)");
    expect(helper).toContain("expect(response.request().postDataJSON()).toMatchObject(");
    expect(helper).toContain("acceptPolicies: true");
    expect(helper).toContain('{ waitUntil: "load" }');
    expect(helper).not.toMatch(/force:|waitForTimeout|\.check\(|setTimeout|\.evaluate\(|\bwhile\b/);
  });

  it("shares the consent helper across every beta sign-in fixture", async () => {
    const specs = (await readdir(betaDirectory)).filter((name) => name.endsWith(".spec.ts"));
    // New feature specs must inherit the same consent journey without a fixed suite-size cap.
    expect(specs.length).toBeGreaterThan(0);
    for (const name of specs) {
      const source = await readFile(new URL(name, betaDirectory), "utf8");
      expect(source, name).toContain('from "./sign-in"');
      expect(source, name).toContain("await signInBeta(page");
      expect(source, name).not.toContain("policyConsent");
    }
  });
});
