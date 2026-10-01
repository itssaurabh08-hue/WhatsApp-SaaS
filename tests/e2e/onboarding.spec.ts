import { expect, test } from "@playwright/test";
import { waitForEmailLink } from "./support/emails";

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("new user signs up, verifies email, creates a workspace and reaches the dashboard", async ({ page }) => {
  const email = `owner-${unique()}@example.com`;
  const cspViolations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
  });

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Riya Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();

  // Step 1: create workspace
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Workspace name").fill(`Acme ${unique()}`);
  await page.getByRole("button", { name: "Create workspace" }).click();

  // Step 2: business details
  await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
  await page.getByLabel("Business name").fill("Acme Trading");
  await page.getByLabel("Timezone").selectOption("Asia/Kolkata");
  await page.getByLabel("Currency").selectOption("INR");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Steps 3-5 are not built yet and can be skipped
  await expect(page.getByRole("heading", { name: "Connect WhatsApp" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Import contacts" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "How message templates work" })).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard" }).click();

  await expect(page.getByRole("heading", { name: "Welcome, Riya" })).toBeVisible();
  await expect(page.getByText("Acme Trading")).toBeVisible();
  await expect(page.getByText(/Verify .* to connect WhatsApp/)).toBeVisible();

  // Verify email using the link that was actually emailed
  const link = await waitForEmailLink(email, "/verify-email");
  await page.goto(link);
  await page.getByRole("button", { name: "Verify my email" }).click();
  await expect(page.getByText("Your email address is verified.")).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Riya" })).toBeVisible();
  await expect(page.getByText(/Verify .* to connect WhatsApp/)).toHaveCount(0);

  // Client-side navigation still works under the nonce-based CSP.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(cspViolations).toEqual([]);
});

test("user can sign out and sign back in", async ({ page }) => {
  const email = `login-${unique()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Sam");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Sam Co ${unique()}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Finish later" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Sam" })).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Protected pages now redirect to login
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/login\?next=%2Fonboarding/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("password reset via emailed link signs in with the new password", async ({ page }) => {
  const email = `reset-${unique()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Reset User");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("original-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.context().clearCookies();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();

  const link = await waitForEmailLink(email, "/reset-password");
  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-2");
  await page.getByLabel("Confirm new password").fill("brand-new-password-2");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("Your password was changed.")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("brand-new-password-2");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});
