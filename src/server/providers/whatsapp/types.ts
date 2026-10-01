/**
 * Provider-neutral WhatsApp interface. The rest of the app depends on this,
 * not on Meta's API shapes, so other providers can be added later.
 */
import type { MetaTemplateComponent, SendComponent } from "@/lib/templates";

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

  // Messaging (WA/reference/whatsapp-business-phone-number/message-api)
  sendMessage(input: SendMessageInput, accessToken: string, ctx: ProviderCallContext): Promise<SendMessageResult>;
  uploadMedia(phoneNumberId: string, file: UploadFile, accessToken: string, ctx: ProviderCallContext): Promise<string>;
  getMediaInfo(mediaId: string, accessToken: string, ctx: ProviderCallContext): Promise<MediaInfo>;
  downloadMedia(url: string, accessToken: string, maxBytes: number, ctx: ProviderCallContext): Promise<DownloadedMedia>;

  // Templates (WA/reference/whatsapp-business-account/message-template-api)
  listTemplates(wabaId: string, accessToken: string, ctx: ProviderCallContext): Promise<ProviderTemplate[]>;
  getTemplate(templateId: string, accessToken: string, ctx: ProviderCallContext): Promise<ProviderTemplate>;
  createTemplate(
    wabaId: string,
    input: CreateTemplateInput,
    accessToken: string,
    ctx: ProviderCallContext,
  ): Promise<{ id: string; status: string; category: string | null }>;
  deleteTemplate(
    wabaId: string,
    name: string,
    templateId: string | null,
    accessToken: string,
    ctx: ProviderCallContext,
  ): Promise<void>;
}

export type OutboundContent =
  | { type: "text"; text: string; previewUrl?: boolean }
  | {
      type: "image" | "video" | "audio" | "document" | "sticker";
      mediaId: string;
      caption?: string | null;
      fileName?: string | null;
    }
  | { type: "template"; name: string; language: string; components: SendComponent[] };

export interface SendMessageInput {
  phoneNumberId: string;
  /** Recipient in E.164 (with or without "+"). */
  to: string;
  content: OutboundContent;
  /** wamid of the customer message being replied to. */
  contextMessageId?: string | null;
  /** Echoed by Meta in status webhooks as biz_opaque_callback_data (max 512 chars). */
  callbackData?: string;
}

export interface SendMessageResult {
  messageId: string;
  /** accepted, held_for_quality_assessment or paused (pacing), when Meta returns it. */
  messageStatus: string | null;
}

export interface UploadFile {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface MediaInfo {
  url: string;
  mimeType: string | null;
  sha256: string | null;
  fileSize: number | null;
}

export interface DownloadedMedia {
  data: Buffer;
  contentType: string | null;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameterFormat: "POSITIONAL" | "NAMED";
  components: MetaTemplateComponent[];
  rejectionReason: string | null;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  parameterFormat: "POSITIONAL" | "NAMED";
  components: MetaTemplateComponent[];
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
