import { createHmac } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForEmailLink } from "./emails";
import { E2E_APP_SECRET, FAKE_GRAPH_PORT } from "./env";
import { E2E_PHONE_ID, E2E_WABA_ID, type RecordedRequest } from "./fake-graph-server";
import { unique } from "./session";

/**
 * Stand-ins for Meta's browser side: a fake SDK whose FB.login opens a
 * facebook.com frame that posts the Embedded Signup session info (as Meta's
 * popup does), then returns a code to the callback.
 */
export async function fakeFacebook(
  page: Page,
  ids: { waba: string; phone: string } = { waba: E2E_WABA_ID, phone: E2E_PHONE_ID },
) {
  await page.route("https://connect.facebook.net/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        window.FB = {
          init: function () {},
          login: function (cb, opts) {
            window.__fbLoginOpts = opts;
            var f = document.createElement("iframe");
            f.style.display = "none";
            f.src = "https://www.facebook.com/__fake_embedded_signup";
            document.body.appendChild(f);
            setTimeout(function () { cb({ authResponse: { code: "AQB-fake-code-123456" } }); }, 400);
          }
        };
        window.fbAsyncInit && window.fbAsyncInit();`,
    }),
  );
  await page.route("https://www.facebook.com/__fake_embedded_signup", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>parent.postMessage(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH",
        data: { waba_id: "${ids.waba}", phone_number_id: "${ids.phone}", business_id: "2729063490586005" } }), "*");</script>`,
    }),
  );
}

/** Signs up, creates a workspace and verifies the email. Returns the workspace slug. */
export async function verifiedOwner(page: Page, name = "Wa Owner") {
  const email = `wa-${unique()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("a-very-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Workspace name").fill(`WA ${unique()}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  const slug = new URL(page.url()).pathname.split("/")[2]!;
  await page.goto(await waitForEmailLink(email, "/verify-email"));
  await page.getByRole("button", { name: "Verify my email" }).click();
  await expect(page.getByText("Your email address is verified.")).toBeVisible();
  return slug;
}

/** Connects the fake WhatsApp number through the Settings page. */
export async function connectWhatsApp(page: Page, slug: string, ids?: { waba: string; phone: string }) {
  await fakeFacebook(page, ids);
  await page.goto(`/w/${slug}/settings/whatsapp`);
  await page.getByRole("button", { name: "Connect with Facebook" }).click();
  await expect(page.getByText("WhatsApp is connected.")).toBeVisible();
}

/** Posts a correctly signed Meta webhook to the app. */
export async function postWebhook(
  request: APIRequestContext,
  wabaId: string,
  field: string,
  value: Record<string, unknown>,
) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ field, value }] }],
  });
  const signature = `sha256=${createHmac("sha256", E2E_APP_SECRET).update(body).digest("hex")}`;
  const res = await request.post("/api/webhooks/meta", {
    data: body,
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  });
  expect(res.status()).toBe(200);
}

/** Requests the fake Graph API has received. */
export async function graphCalls(request: APIRequestContext): Promise<RecordedRequest[]> {
  const res = await request.get(`http://127.0.0.1:${FAKE_GRAPH_PORT}/__calls`);
  return (await res.json()) as RecordedRequest[];
}
