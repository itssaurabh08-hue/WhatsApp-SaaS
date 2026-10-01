# Run the app in GitHub Codespaces (free testing)

Codespaces is a computer in the cloud, run by GitHub, that you use in your browser. Personal GitHub accounts get a free monthly allowance of Codespaces hours and storage; see GitHub's billing settings for your current amounts. Stop the codespace when you are not testing so you use less of the allowance.

Everything the app needs is set up automatically inside the codespace: database, Redis, and an email catcher (you read the app's emails on a web page, so no email account is needed).

## 1. Create the codespace (once, about 5 minutes)

1. Open the repository on GitHub: `github.com/itssaurabh08-hue/WhatsApp-SaaS`.
2. Switch the branch selector (top left, usually says `main`) to **`claude/wizardly-rubin-d37kv6`**.
3. Click the green **Code** button > **Codespaces** tab > **Create codespace on claude/wizardly-rubin-d37kv6**.
4. Wait while it builds. The terminal at the bottom shows progress and ends with `Setup finished. Start the app with: npm run codespace`.

## 2. Start the app (every time)

1. In the terminal at the bottom, type `npm run codespace` and press Enter.
2. It builds the app (1 to 3 minutes the first time) and then prints `Open: https://...app.github.dev`. Keep this terminal running: closing it stops the app.
3. Open that address. It is your app's address.

To read the app's emails (for example the sign-up verification email): open the **Ports** tab (next to Terminal) and click the globe icon on the **Emails (8025)** row.

## 3. First login

1. In the app, click **Sign up** and create your account and workspace.
2. Open the Emails page (see above), open the verification email and click the link.

## 4. Make the app reachable by Meta

Meta must be able to reach your app without logging in to GitHub:

1. Open the **Ports** tab.
2. Right-click the **App (3000)** row > **Port Visibility** > **Public**.

Keep the **Emails (8025)** port **private**.

## 5. Connect WhatsApp

Follow `docs/META_SETUP_GUIDE.md`, using your codespace address (the `https://...-3000.app.github.dev` one) wherever the guide says `https://YOUR-APP-ADDRESS`:

- **Allowed domains** and **Valid OAuth redirect URIs**: your codespace address
- **Webhook callback URL**: your codespace address followed by `/api/webhooks/meta`

Then give the app your Meta values:

1. In the codespace file list (left), open the file **`.env`**.
2. Fill in `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID` and `WHATSAPP_VERIFY_TOKEN` between the quotes, then save (Ctrl+S, or Cmd+S on a Mac).
3. Restart the app: click in the terminal, press **Ctrl+C**, then run `npm run codespace` again.
4. Now click **Verify and save** for the webhook in Meta's dashboard. It only succeeds while the app is running with the same verify token.

The `.env` file stays inside your codespace and is never uploaded to GitHub.

## 6. Test checklist

1. **Settings > WhatsApp > Connect with Facebook**: the number should show **Connected**.
2. **Templates > Sync from WhatsApp**. If you have no templates, create one under **Templates > New template** and wait for Meta's approval.
3. **Contacts > Add contact**: your own personal WhatsApp number, opt-in "Opted in".
4. Open the contact > **Send WhatsApp message** > send the template. It should arrive on your phone.
5. Reply from your phone. The reply appears in **Inbox** within a few seconds, and you can answer with free text.

Tell me what happens at each step, especially any error, and I will fix or explain it.

## Things to know

- **The app runs only while the codespace runs and `npm run codespace` is running.** Codespaces stop after a period without activity (30 minutes by default; you can raise it to up to 4 hours in GitHub > Settings > Codespaces). While it is stopped, Meta cannot reach the app, but Meta retries webhooks for up to 7 days, so messages arrive after you start it again.
- **To continue another day**: GitHub > Code > Codespaces > open your existing codespace, then run `npm run codespace`. The address stays the same, and your data is kept.
- **Deleting the codespace deletes its data**, and a new codespace gets a new address. You would then update the address in your Meta app settings.
- This is for testing only, not for real customers.
