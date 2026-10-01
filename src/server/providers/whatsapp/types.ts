/**
 * Provider-neutral WhatsApp interface. The rest of the app depends on this,
 * not on Meta's API shapes, so other providers can be added later.
 * Messaging and template methods are added in Phase 4.
 */
export interface PhoneNumberDetails {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  messagingLimit: string | null;
  throughputLevel: string | null;
}

export interface ProviderCallContext {
  workspaceId?: string | null;
  whatsappAccountId?: string | null;
  requestId?: string | null;
}

export interface WhatsAppProvider {
  /** Exchanges the short-lived Embedded Signup code (30 s TTL) for a long-lived business token. */
  exchangeSignupCode(code: string, ctx: ProviderCallContext): Promise<string>;
  /** Lists phone numbers on a WABA; used to confirm the token really grants access to the returned IDs. */
  listPhoneNumbers(wabaId: string, accessToken: string, ctx: ProviderCallContext): Promise<PhoneNumberDetails[]>;
  subscribeAppToWaba(wabaId: string, accessToken: string, ctx: ProviderCallContext): Promise<void>;
  unsubscribeAppFromWaba(wabaId: string, accessToken: string, ctx: ProviderCallContext): Promise<void>;
  registerPhoneNumber(phoneNumberId: string, pin: string, accessToken: string, ctx: ProviderCallContext): Promise<void>;
  getPhoneNumber(phoneNumberId: string, accessToken: string, ctx: ProviderCallContext): Promise<PhoneNumberDetails>;
}

// ---------------------------------------------------------------------------
// Normalized webhook events
// ---------------------------------------------------------------------------

export interface NormalizedWebhookChange {
  /** Stable across Meta retries; used for idempotency. */
  dedupeKey: string;
  field: string;
  businessAccountId: string | null;
  phoneNumberId: string | null;
  value: Record<string, unknown>;
}
