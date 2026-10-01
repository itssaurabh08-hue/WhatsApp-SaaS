import { expect, test } from "@playwright/test";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signUpWithWorkspace(page: import("@playwright/test").Page, name: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(`${name.toLowerCase()}-${unique()}@example.com`);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`${name} Workspace ${unique()}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/setup$/);
  return new URL(page.url()).pathname.split("/")[2]!;
}

test("a user cannot open another tenant's workspace", async ({ browser }) => {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const aliceSlug = await signUpWithWorkspace(alicePage, "Alice");
  await signUpWithWorkspace(bobPage, "Bob");

  const response = await bobPage.goto(`/w/${aliceSlug}/settings`);
  expect(response?.status()).toBe(404);
  await expect(bobPage.getByText("Page not found")).toBeVisible();

  await alice.close();
  await bob.close();
});

test("security headers and request ids are set", async ({ request }) => {
  const res = await request.get("/login");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-request-id"]).toBeTruthy();
  expect(headers["x-powered-by"]).toBeUndefined();
});
