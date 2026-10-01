import { expect, test } from "@playwright/test";
import { E2E_PHONE_ID_2, E2E_WABA_ID_2 } from "./support/fake-graph-server";
import { connectWhatsApp, graphCalls, postWebhook, verifiedOwner } from "./support/whatsapp";

const ids = { waba: E2E_WABA_ID_2, phone: E2E_PHONE_ID_2 };
const CUSTOMER = "16505550199";

test("templates, incoming messages, replies and internal notes", async ({ page, request }) => {
  test.setTimeout(120_000);
  const slug = await verifiedOwner(page, "Inbox Owner");
  await connectWhatsApp(page, slug, ids);

  // Templates: import from WhatsApp, then create one for review.
  await page.goto(`/w/${slug}/templates`);
  await page.getByRole("button", { name: "Sync from WhatsApp" }).click();
  await expect(page.getByText("Loaded 1 template from WhatsApp.")).toBeVisible();
  await expect(page.getByRole("link", { name: "order_update" })).toBeVisible();

  await page.getByRole("link", { name: "New template" }).click();
  await page.getByLabel("Template name").fill("Delivery Reminder");
  await expect(page.getByLabel("Template name")).toHaveValue("delivery_reminder");
  await page.getByLabel("Message body").fill("Hi {{1}}, your delivery arrives on {{2}}.");
  await page.getByLabel("{{1}}", { exact: true }).fill("Ana");
  await page.getByLabel("{{2}}", { exact: true }).fill("Friday");
  await expect(page.getByText("Hi Ana, your delivery arrives on Friday.")).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Submitted to Meta for review")).toBeVisible();
  await expect(page.getByText("In review").first()).toBeVisible();
  const created = (await graphCalls(request)).find((c) => c.method === "POST" && c.path.endsWith("/message_templates"));
  expect(created?.body).toMatchObject({
    name: "delivery_reminder",
    category: "UTILITY",
    components: [{ type: "BODY", example: { body_text: [["Ana", "Friday"]] } }],
  });

  // A customer writes in.
  await postWebhook(request, E2E_WABA_ID_2, "messages", {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550783881", phone_number_id: E2E_PHONE_ID_2 },
    contacts: [{ profile: { name: "Maya Customer" }, wa_id: CUSTOMER }],
    messages: [
      {
        from: CUSTOMER,
        id: `wamid.in-${Date.now()}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Where is my parcel?" },
      },
    ],
  });
  await page.goto(`/w/${slug}/inbox`);
  await expect(page.getByRole("link", { name: /Maya Customer/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /Maya Customer/ }).click();
  await expect(page.getByText("Where is my parcel?")).toBeVisible();
  await expect(page.getByText(/Window open/)).toBeVisible();

  // Reply.
  await page.getByLabel("Message", { exact: true }).fill("It is out for delivery today.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("It is out for delivery today.")).toBeVisible();
  await expect
    .poll(
      async () => (await graphCalls(request)).filter((c) => c.method === "POST" && c.path.endsWith("/messages")).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);
  const sent = (await graphCalls(request)).find((c) => c.method === "POST" && c.path.endsWith("/messages"));
  expect(sent?.body).toMatchObject({
    to: `+${CUSTOMER}`,
    type: "text",
    text: { body: "It is out for delivery today." },
  });

  // Internal note: shown to the team, never sent.
  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByLabel("Internal note").fill("Customer called twice, VIP");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added. Only your team can see it.")).toBeVisible();
  const calls = await graphCalls(request);
  expect(JSON.stringify(calls)).not.toContain("Customer called twice");

  // Template reply.
  await page.getByRole("tab", { name: "Template" }).click();
  await page.getByLabel("{{1}}", { exact: true }).fill("Maya");
  await page.getByLabel("{{2}}", { exact: true }).fill("B-12");
  await page.getByRole("button", { name: "Send template" }).click();
  await expect(page.getByText("Hi Maya, order B-12 has shipped.").first()).toBeVisible();
  await expect
    .poll(
      async () => (await graphCalls(request)).filter((c) => c.method === "POST" && c.path.endsWith("/messages")).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(2);
});
