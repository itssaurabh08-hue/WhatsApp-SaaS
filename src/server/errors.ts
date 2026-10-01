/**
 * AppError separates what users see (`userMessage`) from what we log
 * (`message`, `cause`, `details`). Never surface `message` or `cause` to clients.
 */
export type AppErrorCode =
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL";

const DEFAULT_USER_MESSAGES: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find what you were looking for.",
  VALIDATION: "Some of the information provided is not valid.",
  CONFLICT: "This conflicts with existing data.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    options: {
      message?: string;
      userMessage?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = options.userMessage ?? DEFAULT_USER_MESSAGES[code];
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toUserMessage(error: unknown): string {
  return isAppError(error) ? error.userMessage : DEFAULT_USER_MESSAGES.INTERNAL;
}
