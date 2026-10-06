import { expect, type Page } from "@playwright/test";

// This account receives the beta server's explicitly seeded, allowlisted workspace.
export const betaEmail = "ux-beta-e2e@example.com";

export async function signInBeta(page: Page, email = betaEmail) {
  await page.goto("/signin");
  const education = page.getByRole("button", { name: "Education" });
  await expect(education).toBeEnabled();
  await education.click();
  await expect(education).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Email address").fill(email);

  const policyConsent = page.getByLabel(/I accept the Terms/);
  await expect(policyConsent).toBeEnabled();
  await expect(policyConsent).not.toBeChecked();
  // Linux Firefox can lose a native checkbox pointer activation despite passing
  // hit-target checks. Exercise its keyboard path once, with real state assertions.
  await policyConsent.focus();
  await expect(policyConsent).toBeFocused();
  await policyConsent.press("Space");
  await expect(policyConsent).toBeChecked();

  const sendLink = page.getByRole("button", { name: "Send sign-in link" });
  await expect(sendLink).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/v1/auth/magic-link",
    ),
    sendLink.click(),
  ]);
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    email: email.trim().toLowerCase(),
    segment: "education",
    acceptPolicies: true,
  });

  // A matching URL can precede the completed auth redirect. Fence the loaded
  // destination before callers assert their dashboard surface or navigate away.
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/dashboard" && url.searchParams.get("welcome") === "1",
      { waitUntil: "load" },
    ),
    page.getByRole("link", { name: "Continue to dashboard" }).click(),
  ]);
}
