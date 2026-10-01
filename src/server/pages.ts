import "server-only";
import { notFound } from "next/navigation";
import { isAppError } from "@/server/errors";

/** Awaits a service call and renders the 404 page when it reports NOT_FOUND. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
