import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Education" }).click();
  await page.getByLabel("Email address").fill("ux-beta-e2e@example.com");
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("beta workspace and creation surfaces pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  await expectNoAxeViolations(page);

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("mobile beta creation surface passes automated accessibility checks @mobile", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await expectNoAxeViolations(page);
});
