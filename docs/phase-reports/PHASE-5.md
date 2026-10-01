# Phase 5 Report: campaigns (basic version)

Date: 2026-10-01. Built in the reduced "basic" scope agreed with the product owner.

## What was implemented

- **Campaigns page**: list with status and delivered, read and failed counts.
- **New campaign**: name, number, approved template, audience (list, tag, segment or all contacts), a value for each template variable (a contact field with an optional fallback, or the same text for everyone), header file when the template needs one, "Count recipients", and a live preview.
- **Campaign page**: send now or schedule (in the workspace time zone); pause, resume, cancel and delete; results tiles (recipients, waiting, sent, delivered, read, replied, failed); a recipient list with filters and the reason for each skipped or failed contact. It refreshes every 5 seconds while sending.
- **Rules (server side)**:
  - Opted-out contacts never receive campaigns. Marketing templates go only to opted-in contacts, unless "also send to unknown opt-in" is ticked. Opt-in is checked when the audience is captured and again just before each send.
  - Each contact appears once per campaign (unique recipient), and each message has the key `campaign:<id>:<contact>`. Repeated engine runs, retries and duplicate jobs cannot send twice (tested).
  - Contacts with an empty variable and no fallback are skipped with the reason.
  - If the number disconnects or the template stops being approved, the campaign pauses itself with an explanation.
- **Engine** (worker, every 3 seconds): starts due campaigns, captures the audience, and feeds about 10 seconds of messages at a time to the send queue, so pause and cancel take effect within seconds. Messages already handed to the queue still go out.
- **Rate limit**: each number sends at most `WHATSAPP_SEND_RATE_PER_SECOND` messages per second (default 20; Meta's documented default limit is 80), shared across worker processes. This also applies to inbox replies.
- **Reply tracking**: a customer message within 72 hours of a campaign message counts as a reply to that campaign.
- **Results come from real data**: sent, delivered and read come from Meta's status webhooks. Failed messages are never counted as delivered.

## Database changes

Migration `campaigns`: enums `CampaignStatus`, `RecipientStatus`; tables `Campaign` and `CampaignRecipient` (unique campaign + contact); `Message.campaignId`. Both new tables are tenant-guarded.

## Environment variables

`WHATSAPP_SEND_RATE_PER_SECOND` (optional, default 20).

## Tests

- Unit and integration: 196 pass (10 new campaign tests).
  - Validation: variables, approved template, permissions.
  - Audience estimate with the opt-in rules.
  - Exactly one send per contact despite repeated ticks, dispatches and deliveries.
  - Marketing opt-in, including a contact who opts out after the audience was captured.
  - Missing values are skipped.
  - Pause, resume and cancel.
  - Scheduled start.
  - Results from webhooks, with failed counted separately, and reply attribution.
  - Workspace isolation and time-zone conversion.
- E2E: the existing 13 pass (the worker now also runs the campaign engine). No new browser test for campaigns in the basic scope.
- Lint, typecheck and build pass.

## Not included (basic scope)

- Editing a draft: delete it and create a new one.
- A browser test for the campaign screens.
- Per-recipient retry of failed messages.
- Meta's daily messaging limit (for example 250 customers per 24 hours for new numbers) is not checked in advance. Meta enforces it, and failures show with Meta's reason. The campaign page shows the number's current limit.

## Next step

Phase 6 (basic): analytics page with daily sent, delivered, read and failed counts, plus CSV download.
