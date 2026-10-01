# Meta setup guide (for the platform owner)

This guide is for **you, the owner of this platform**. Your customers never do these steps: they only click **Connect with Facebook** inside the app.

You register your company with Meta as a **Tech Provider**. Meta then lets your app create and connect WhatsApp Business accounts for your customers through Meta's own sign-up window ("Embedded Signup").

Everything below comes from Meta's official documentation, checked on 2026-10-01. Links are at the end. Meta changes its screens from time to time, so a button may have a slightly different name.

## What you need first

- A Facebook account that you use for business.
- A **business portfolio** in Meta Business Suite (https://business.facebook.com). You can also create one while creating the app in step 2.
- Your business documents: legal name, address, phone, website, and possibly a registration certificate, for **business verification**.
- **A public web address with HTTPS where the app runs** (for example `https://app.yourdomain.com`). Meta's sign-up window and webhooks only work on a real HTTPS address, not on `localhost`. Hosting is not set up yet. Tell me when you are ready and I will help you choose and set it up.

## Step 1: Create a Meta developer account and app

1. Go to https://developers.facebook.com/apps and sign in.
2. Create an app and choose the **WhatsApp** use case ("Connect with customers through WhatsApp").
3. Connect the app to your business portfolio (or create one when asked).
4. In **App settings > Basic**, note the **App ID** and click **Show** next to **App secret**. Keep the app secret private, like a password.

## Step 2: Start Tech Provider onboarding

1. In the app dashboard go to **Use cases**, click the pencil (**Customize**) on the WhatsApp use case, then **Tech Provider onboarding** in the left menu.
2. Choose **Onboard without a partner** (you will run messaging yourself).
3. **Verify your business:** click **Start verification** and follow the steps. This can take from a few days to a couple of weeks.

You can keep testing while verification is in progress (see step 6).

## Step 3: Allow your website to open the sign-up window

1. In the app dashboard open **Facebook Login for Business > Settings > Client OAuth settings**.
2. Switch these to **Yes**: Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Use Strict Mode for redirect URIs, Login with the JavaScript SDK.
3. Add your app's HTTPS address (for example `https://app.yourdomain.com`) to both **Allowed domains** and **Valid OAuth redirect URIs**.

## Step 4: Create the Embedded Signup configuration

1. Open **Facebook Login for Business > Configurations** and click **Create configuration** (a custom configuration).
2. Select the **WhatsApp Embedded Signup** login variation and the **Cloud API** product.
3. When asked for the access token type, choose **System-user access token**, and set token expiration to **Never**.
   - Why: the app stores each customer's token encrypted and does not renew tokens. A token that expires (Meta's ready-made template is named "...With 60 Expiration Token") would force customers to reconnect when it runs out. If that happens, the app shows the number as "Needs reconnecting".
4. Keep only the assets and permissions you need: WhatsApp Business accounts, `whatsapp_business_management` and `whatsapp_business_messaging`. Extra requests (ad accounts, catalogs) make customers abandon the flow.
5. Copy the **Configuration ID**.

## Step 5: Set up webhooks (how WhatsApp messages reach the app)

1. In the app dashboard go to **Use cases > Customize > Configuration** for WhatsApp.
2. **Callback URL:** `https://YOUR-APP-ADDRESS/api/webhooks/meta`
3. **Verify token:** invent a long random string (for example 40 letters and digits) and write it down.
4. Click **Verify and save**. This only succeeds once the app is running at that address with the same verify token (step 7).
5. Subscribe to these webhook fields: `messages`, `message_template_status_update`, `account_update`, `phone_number_quality_update`, `user_preferences`.

## Step 6: Test with your own account (before Meta's review)

While the app is in **development mode**, anyone with an admin, developer or tester role on the app can use the **Connect with Facebook** button with their own Facebook account. You can connect your own business phone number end to end before App Review.

Meta also offers a **sandbox test account** that simulates a business going through the window. Its phone number cannot send real messages.

## Step 7: Give the values to the app

Set these on the server where the app runs (I will do this with you when we set up hosting):

| Setting                 | Where it comes from                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_APP_ID`       | App settings > Basic > App ID                                                                                                     |
| `WHATSAPP_APP_SECRET`   | App settings > Basic > App secret                                                                                                 |
| `WHATSAPP_CONFIG_ID`    | The Configuration ID from step 4                                                                                                  |
| `WHATSAPP_VERIFY_TOKEN` | The verify token you invented in step 5                                                                                           |
| `ENCRYPTION_KEY`        | Generated once (`openssl rand -base64 32`). Store a backup somewhere safe: if it is lost, every customer must reconnect WhatsApp. |

## Step 8: App Review (needed before onboarding other businesses)

After business verification, submit the app for **App Review** to get **Advanced access** to `whatsapp_business_messaging` and `whatsapp_business_management`. Meta asks for:

- App basics: icon, privacy policy URL, category.
- **Video 1:** a message sent from your app and received in WhatsApp.
- **Video 2:** your app being used to create a message template.

Our app can send messages and create templates after **Phase 4**. Meta also accepts the alternatives: recording the **API Setup** page in the app dashboard sending a test message, and recording **WhatsApp Manager** creating a template. That means you can submit earlier.

## Limits to know about

- Until business verification, App Review and Access Verification are done, you can onboard **up to 10 new customer businesses per rolling 7 days**. After that it rises to 200.
- New customer businesses start with a **messaging limit of 250 unique customers per 24 hours** outside the reply window. It grows automatically as they keep quality high.
- As a Tech Provider, **each customer adds their own payment method** in WhatsApp Manager. The app reminds them after they connect.
- A phone number currently used in the normal WhatsApp or WhatsApp Business app cannot be connected with the default setup.

## Official sources

- Become a Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Embedded Signup overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- Embedded Signup implementation: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Onboarding customers as a Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
- Webhook endpoint: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
