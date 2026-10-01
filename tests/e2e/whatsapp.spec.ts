import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_APP_SECRET, E2E_VERIFY_TOKEN } from "./support/env";
import { fakeFacebook, verifiedOwner } from "./support/whatsapp";

test("connect WhatsApp with Embedded Signup end to end", async ({ page }) => {
  await fakeFacebook(page);
  const slug = await verifiedOwner(page);

  const response = await page.goto(`/w/${slug}/settings/whatsapp`);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-src https://*.facebook.com");

  await page.getByRole("button", { name: "Connect with Facebook" }).click();
  await expect(page.getByText("WhatsApp is connected.")).toBeVisible();
  const card = page.getByTestId("whatsapp-account");
  await expect(card.getByText("Lucky Shrub")).toBeVisible();
  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  await expect(card.getByText("250 customers per 24 hours")).toBeVisible();
  await expect(page.getByText("Add a payment method in Meta")).toBeVisible();

  const opts = await page.evaluate(
    () => (window as unknown as { __fbLoginOpts: Record<string, unknown> }).__fbLoginOpts,
  );
  expect(opts).toMatchObject({ config_id: "555000111", response_type: "code", override_default_response_type: true });

  // Dashboard reflects the connection
  await page.goto(`/w/${slug}`);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // Disconnect
  await page.goto(`/w/${slug}/settings/whatsapp`);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Disconnect" }).last().click();
  await expect(page.getByTestId("whatsapp-account")).toHaveCount(0);
});

test("other pages do not allow Facebook frames", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["content-security-policy"]).not.toContain("facebook");
});

test("webhook endpoint verifies the handshake and signatures", async ({ request }) => {
  const ok = await request.get(
    `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${E2E_VERIFY_TOKEN}&hub.challenge=1158201444`,
  );
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("1158201444");
  expect(
    (await request.get("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status(),
  ).toBe(403);

  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  expect(
    (
      await request.post("/api/webhooks/meta", { data: body, headers: { "content-type": "application/json" } })
    ).status(),
  ).toBe(401);
  const signature = `sha256=${createHmac("sha256", E2E_APP_SECRET).update(body).digest("hex")}`;
  const signed = await request.post("/api/webhooks/meta", {
    data: body,
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  });
  expect(signed.status()).toBe(200);
});
