# Meta WhatsApp Cloud API: Items Requiring Verification

The official Meta developer documentation (developers.facebook.com) could not be reached from the build environment on 2026-10-01 (blocked by network policy). Per the project rule "do not invent Meta API behavior", every item below is treated as **unverified** until a developer confirms it against the current official docs and records the doc URL and date here.

Status legend: UNVERIFIED, VERIFIED (date, URL), CHANGED (what differs).

| #   | Item                           | Current assumption                                                                                                                           | Used in   | Status                                                   |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| 1   | Graph API version to pin       | Configurable via `WHATSAPP_GRAPH_API_VERSION`; no default hard-coded in logic                                                                | All calls | UNVERIFIED                                               |
| 2   | Base URL                       | `https://graph.facebook.com/{version}`                                                                                                       | All calls | UNVERIFIED                                               |
| 3   | Webhook verification handshake | GET with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`; respond 200 with raw challenge                                           | Phase 3   | UNVERIFIED (consistent with secondary sources)           |
| 4   | Webhook signature              | `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 of raw body with app secret                                                                 | Phase 3   | UNVERIFIED (consistent with secondary sources)           |
| 5   | Webhook payload shape          | `entry[].changes[].value` with `metadata.phone_number_id`, `messages[]`, `statuses[]`, `contacts[]`; template updates via a separate `field` | Phase 3   | UNVERIFIED                                               |
| 6   | Status values                  | `sent`, `delivered`, `read`, `failed` with `errors[]`                                                                                        | Phase 3/5 | UNVERIFIED                                               |
| 7   | Send message endpoint          | `POST /{phone-number-id}/messages`, body with `messaging_product: "whatsapp"`, `to`, `type`                                                  | Phase 4   | UNVERIFIED                                               |
| 8   | Send response                  | `messages[0].id` (wamid)                                                                                                                     | Phase 4   | UNVERIFIED                                               |
| 9   | Template send component shape  | `template.name`, `template.language.code`, `components[]` with parameters                                                                    | Phase 4/5 | UNVERIFIED                                               |
| 10  | Template management            | List/create under `/{waba-id}/message_templates`; categories MARKETING/UTILITY/AUTHENTICATION; supported button types                        | Phase 4   | UNVERIFIED                                               |
| 11  | Customer service window length | 24 hours from last inbound message                                                                                                           | Phase 4   | UNVERIFIED                                               |
| 12  | Media upload/download          | `/{phone-number-id}/media` upload, media id -> URL fetch requiring auth header                                                               | Phase 4   | UNVERIFIED                                               |
| 13  | Phone number status fields     | quality rating, messaging limit tier, name status                                                                                            | Phase 3   | UNVERIFIED                                               |
| 14  | Throughput / rate limits       | Per-number messages-per-second and messaging tier limits                                                                                     | Phase 5   | UNVERIFIED                                               |
| 15  | Error codes and retryability   | Mapping of Graph error codes (e.g. 131026, 131047, 130429) to user messages and retry policy                                                 | Phase 4/5 | UNVERIFIED                                               |
| 16  | Pricing / conversation charges | Pricing model for estimated cost display                                                                                                     | Phase 5   | UNVERIFIED; feature shows "not available" until verified |
| 17  | Opt-out handling               | Meta-side marketing opt-out signals and related error codes                                                                                  | Phase 4/5 | UNVERIFIED                                               |
| 18  | Embedded Signup                | Flow and requirements (Tech Provider status)                                                                                                 | Post-V1   | UNVERIFIED, not planned for V1                           |

Secondary (non-authoritative) sources consulted for items 3 and 4:

- https://webhookrelay.com/blog/whatsapp-cloud-api-webhooks/
- https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices

Code that depends on these items lives only in `src/server/providers/whatsapp/meta/` so corrections are made in one place. Tests use recorded fixtures that must be replaced with real sample payloads once verified.
