import { expect, test } from "@playwright/test";

test("navigation collapses into a drawer on tablet widths", async ({ page }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Tab User");
  await page.getByLabel("Work email").fill(`tab-${id}@example.com`);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Tab ${id}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Finish later" }).click();

  const openNav = page.getByRole("button", { name: "Open navigation" });
  await expect(openNav).toBeVisible();
  await openNav.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(dialog).toBeHidden();
});
