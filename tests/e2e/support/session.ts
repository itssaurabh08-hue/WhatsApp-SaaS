import { expect, type Page } from "@playwright/test";

export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Signs up a fresh user, creates a workspace, skips setup and returns the workspace slug. */
export async function signUpToDashboard(page: Page, name = "Test User") {
  const id = unique();
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(`user-${id}@example.com`);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`Workspace ${id}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/setup$/);
  const slug = new URL(page.url()).pathname.split("/")[2]!;
  await page.getByRole("link", { name: "Finish later" }).click();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  return slug;
}
