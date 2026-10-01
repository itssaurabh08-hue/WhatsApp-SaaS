import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signUpToDashboard } from "./support/session";

test("add a contact, prevent a duplicate, tag it and add a note", async ({ page }) => {
  const slug = await signUpToDashboard(page);
  await page.goto(`/w/${slug}/contacts`);
  await expect(page.getByText("Import your contacts to start messaging.")).toBeVisible();

  // Create a tag first
  await page.goto(`/w/${slug}/contacts/tags`);
  await page.getByRole("button", { name: "New tag" }).click();
  await page.getByLabel("Name").fill("VIP");
  await page.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("cell", { name: "VIP" })).toBeVisible();

  await page.goto(`/w/${slug}/contacts/new`);
  await page.getByLabel("Phone number").fill("+91 98765 43210");
  await page.getByLabel("First name").fill("Asha");
  await page.getByLabel("WhatsApp opt-in").selectOption("OPTED_IN");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("heading", { name: "Asha", level: 1 })).toBeVisible();
  await expect(page.getByText("+919876543210")).toBeVisible();

  await page.getByLabel("Tag to add").selectOption({ label: "VIP" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove tag VIP" })).toBeVisible();

  await page.getByLabel("Add an internal note").fill("Prefers morning calls");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Prefers morning calls")).toBeVisible();

  // Same number in another format is rejected with a clear message
  await page.goto(`/w/${slug}/contacts/new`);
  await page.getByLabel("Phone number").fill("0091 98765-43210");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("A contact with this phone number already exists.")).toBeVisible();

  // Delete with confirmation returns to the (now empty) contacts list
  await page.goto(`/w/${slug}/contacts`);
  await page.getByRole("link", { name: "Asha" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete contact" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/contacts$`));
  await expect(page.getByText("Import your contacts to start messaging.")).toBeVisible();
});

test("import a CSV with column mapping, preview, errors and results", async ({ page }) => {
  const slug = await signUpToDashboard(page);
  await page.goto(`/w/${slug}/contacts/import`);
  const csv = [
    "Name,Mobile,Email,Opt in",
    "Asha Rao,+91 98765 11111,asha@example.com,yes",
    "Ravi Kumar,+91 98765 22222,,no",
    "Broken,12345,,",
  ].join("\n");
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload and continue" }).click();

  await expect(page.getByRole("heading", { name: "1. Map columns" })).toBeVisible();
  await expect(page.getByLabel("Import column Name as")).toHaveValue("fullName");
  await expect(page.getByLabel("Import column Mobile as")).toHaveValue("phoneNumber");
  await expect(page.getByLabel("Import column Opt in as")).toHaveValue("optInStatus");

  await page.getByRole("button", { name: "Check 3 rows" }).click();
  const summary = page.getByTestId("import-summary");
  await expect(summary.getByText("New contacts")).toBeVisible();
  await expect(page.getByTestId("import-errors")).toContainText("Row 4");

  await page.getByRole("button", { name: "Import 2 contacts" }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("heading", { name: "Import completed" })).toBeVisible();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("Created2");
  await expect(result).toContainText("Failed1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download failed rows" }).click();
  const download = await downloadPromise;
  const errors = readFileSync((await download.path())!, "utf8");
  expect(errors).toContain("Broken");
  expect(errors).toContain("Add the country code");

  await page.getByRole("link", { name: "View contacts" }).click();
  await expect(page.getByText("2 contacts")).toBeVisible();
});

test("bulk tag all matching contacts, filter, build a segment and export", async ({ page }) => {
  const slug = await signUpToDashboard(page);
  await page.goto(`/w/${slug}/contacts/tags`);
  await page.getByRole("button", { name: "New tag" }).click();
  await page.getByLabel("Name").fill("Customer");
  await page.getByRole("button", { name: "Create tag" }).click();
  await expect(page.getByRole("cell", { name: "Customer" })).toBeVisible();

  for (const [name, phone] of [
    ["Bea", "+91 98765 00001"],
    ["Cal", "+91 98765 00002"],
  ]) {
    await page.goto(`/w/${slug}/contacts/new`);
    await page.getByLabel("Phone number").fill(phone!);
    await page.getByLabel("First name").fill(name!);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("heading", { name: name, level: 1 })).toBeVisible();
  }

  await page.goto(`/w/${slug}/contacts`);
  await page.getByLabel("Select all on this page").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByLabel("Add tag").selectOption({ label: "Customer" });
  await expect(page.getByText("Tagged 2 contact(s).")).toBeVisible();

  await page.getByLabel("Search contacts").fill("Bea");
  await page.getByLabel("Search contacts").press("Enter");
  await expect(page.getByText("1 matching contact")).toBeVisible();

  // Segment builder
  await page.goto(`/w/${slug}/contacts/segments/new`);
  await page.getByLabel("Name", { exact: true }).fill("Customers");
  await expect(page.getByLabel("Condition 1 field")).toHaveValue("tag");
  await page.getByRole("button", { name: "Count matching contacts" }).click();
  await expect(page.getByRole("status")).toContainText("2 contacts match");
  await page.getByRole("button", { name: "Create segment" }).click();
  await expect(page).toHaveURL(/segmentId=/);
  await expect(page.getByText("2 matching contacts")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const csv = readFileSync((await (await downloadPromise).path())!, "utf8");
  expect(csv).toContain("+919876500001");
  expect(csv).toContain("Customer");
});
