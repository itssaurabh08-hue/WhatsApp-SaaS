import "server-only";
import type { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { isAppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";

/** Converts a Zod error into one message per field (first issue wins). */
export function fieldErrorsFrom<T extends string>(error: z.ZodError): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key as T] = issue.message;
  }
  return out;
}

/**
 * Maps thrown errors to a safe ActionState. AppErrors carry a user-safe
 * message; everything else is logged and replaced by a generic message.
 */
export function actionError<T extends string>(
  error: unknown,
  context: string,
  values?: Partial<Record<T, string>>,
): ActionState<T> {
  if (isAppError(error)) {
    if (error.code === "INTERNAL") logger.error({ err: error, context }, error.message);
    return { ok: false, message: error.userMessage, values };
  }
  logger.error({ err: error, context }, "unhandled action error");
  return { ok: false, message: "Something went wrong on our side. Please try again.", values };
}

export function formValues<T extends string>(formData: FormData, keys: readonly T[]): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const key of keys) {
    const v = formData.get(key);
    if (typeof v === "string") out[key] = v;
  }
  return out;
}
