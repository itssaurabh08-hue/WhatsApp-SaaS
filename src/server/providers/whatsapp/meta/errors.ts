/**
 * Meta Graph / WhatsApp error handling. Codes and guidance are from
 * WA/support/error-codes (see docs/META_API_VERIFICATION.md item 15).
 */
export type MetaErrorCategory =
  | "auth" // token expired/revoked or permissions missing: reconnect needed
  | "account" // account restricted, payment, registration problems
  | "rate_limit" // retry later
  | "temporary" // Meta-side transient failure: retry
  | "recipient" // problem with this recipient: do not retry
  | "window" // outside the 24h customer service window: use a template
  | "opt_out" // user stopped marketing messages: never retry
  | "template" // template missing, paused, parameters wrong
  | "invalid_request"
  | "network" // no response from Meta
  | "unknown";

export interface MetaErrorInfo {
  category: MetaErrorCategory;
  retryable: boolean;
  userMessage: string;
}

const TABLE: Record<number, MetaErrorInfo> = {
  0: {
    category: "auth",
    retryable: false,
    userMessage: "WhatsApp access has expired. Reconnect your WhatsApp account.",
  },
  3: {
    category: "auth",
    retryable: false,
    userMessage: "This app is missing a WhatsApp permission. Reconnect your WhatsApp account.",
  },
  10: {
    category: "auth",
    retryable: false,
    userMessage: "WhatsApp permission was removed. Reconnect your WhatsApp account.",
  },
  190: {
    category: "auth",
    retryable: false,
    userMessage: "WhatsApp access has expired. Reconnect your WhatsApp account.",
  },
  200: {
    category: "auth",
    retryable: false,
    userMessage: "This app no longer has permission for this WhatsApp account. Reconnect it.",
  },
  368: {
    category: "account",
    retryable: false,
    userMessage: "Meta has restricted this WhatsApp Business account for a policy violation. Check WhatsApp Manager.",
  },
  131031: {
    category: "account",
    retryable: false,
    userMessage: "Meta has restricted or locked this WhatsApp Business account. Check WhatsApp Manager.",
  },
  131042: {
    category: "account",
    retryable: false,
    userMessage:
      "There is a problem with the payment method on your WhatsApp Business account. Check WhatsApp Manager.",
  },
  131045: {
    category: "account",
    retryable: false,
    userMessage: "This phone number is not registered with WhatsApp yet. Finish setup and try again.",
  },
  131057: {
    category: "temporary",
    retryable: true,
    userMessage: "The WhatsApp account is in maintenance. Try again in a few minutes.",
  },
  133016: {
    category: "account",
    retryable: false,
    userMessage: "Too many registration attempts for this number. Meta blocks new attempts for up to 72 hours.",
  },
  133005: {
    category: "account",
    retryable: false,
    userMessage: "The two-step verification PIN for this number is incorrect.",
  },
  133006: {
    category: "account",
    retryable: false,
    userMessage: "This phone number must be verified in WhatsApp Manager before it can be registered.",
  },
  4: {
    category: "rate_limit",
    retryable: true,
    userMessage: "WhatsApp is temporarily limiting requests. Try again shortly.",
  },
  80007: {
    category: "rate_limit",
    retryable: true,
    userMessage: "WhatsApp is temporarily limiting requests for this account. Try again shortly.",
  },
  130429: {
    category: "rate_limit",
    retryable: true,
    userMessage: "Sending too fast for this number. Messages will be retried.",
  },
  131056: {
    category: "rate_limit",
    retryable: true,
    userMessage: "Too many messages to the same contact in a short time. Try again later.",
  },
  1: { category: "temporary", retryable: true, userMessage: "WhatsApp had a temporary problem. Try again." },
  2: { category: "temporary", retryable: true, userMessage: "WhatsApp is temporarily unavailable. Try again." },
  131000: { category: "temporary", retryable: true, userMessage: "WhatsApp could not send this message. Try again." },
  131016: { category: "temporary", retryable: true, userMessage: "WhatsApp is temporarily unavailable. Try again." },
  133004: { category: "temporary", retryable: true, userMessage: "WhatsApp is temporarily unavailable. Try again." },
  131026: {
    category: "recipient",
    retryable: false,
    userMessage:
      "WhatsApp could not deliver this message. The number may not use WhatsApp or may need to update the app.",
  },
  131021: { category: "recipient", retryable: false, userMessage: "You cannot message your own business number." },
  130403: {
    category: "recipient",
    retryable: false,
    userMessage: "This contact is blocked on your WhatsApp Business account.",
  },
  131049: {
    category: "recipient",
    retryable: false,
    userMessage:
      "WhatsApp did not deliver this marketing message to keep engagement healthy. Do not resend within 24 hours.",
  },
  131047: {
    category: "window",
    retryable: false,
    userMessage:
      "More than 24 hours have passed since this contact last messaged you. Send an approved template instead.",
  },
  131050: {
    category: "opt_out",
    retryable: false,
    userMessage: "This contact has stopped marketing messages from your business on WhatsApp.",
  },
  132000: {
    category: "template",
    retryable: false,
    userMessage: "The number of template variables does not match the template.",
  },
  132001: {
    category: "template",
    retryable: false,
    userMessage: "This template does not exist in that language or is not approved yet.",
  },
  132007: {
    category: "template",
    retryable: false,
    userMessage: "This template was rejected for violating WhatsApp policy.",
  },
  132012: {
    category: "template",
    retryable: false,
    userMessage: "Template variable values are not in the expected format.",
  },
  132015: { category: "template", retryable: false, userMessage: "This template is paused because of low quality." },
  132016: {
    category: "template",
    retryable: false,
    userMessage: "This template has been disabled because of repeated low quality.",
  },
  131051: {
    category: "invalid_request",
    retryable: false,
    userMessage: "This message type is not supported by WhatsApp.",
  },
  131052: {
    category: "recipient",
    retryable: false,
    userMessage: "The media sent by the contact could not be downloaded.",
  },
  131053: {
    category: "invalid_request",
    retryable: false,
    userMessage: "The media file could not be uploaded to WhatsApp. Check the file type and size.",
  },
  100: { category: "invalid_request", retryable: false, userMessage: "WhatsApp rejected the request as invalid." },
  131008: {
    category: "invalid_request",
    retryable: false,
    userMessage: "WhatsApp rejected the request because a required value is missing.",
  },
  131009: {
    category: "invalid_request",
    retryable: false,
    userMessage: "WhatsApp rejected one of the values in the request.",
  },
};

export function classifyMetaError(code: number | null | undefined): MetaErrorInfo {
  if (code === null || code === undefined) {
    return { category: "unknown", retryable: false, userMessage: "WhatsApp returned an unexpected error. Try again." };
  }
  const known = TABLE[code];
  if (known) return known;
  if (code > 200 && code < 300) return TABLE[200]!;
  return { category: "unknown", retryable: false, userMessage: "WhatsApp returned an unexpected error. Try again." };
}

/** Error thrown by the Graph client. Keeps Meta's details for logs; `info.userMessage` is safe to show. */
export class MetaApiError extends Error {
  readonly info: MetaErrorInfo;
  constructor(
    readonly operation: string,
    readonly httpStatus: number | null,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly metaMessage: string,
    readonly fbtraceId: string | null,
  ) {
    super(`Meta API ${operation} failed (http ${httpStatus ?? "none"}, code ${code ?? "none"}): ${metaMessage}`);
    this.name = "MetaApiError";
    this.info =
      httpStatus === null
        ? { category: "network", retryable: true, userMessage: "Could not reach WhatsApp. Try again." }
        : classifyMetaError(code);
  }
}
