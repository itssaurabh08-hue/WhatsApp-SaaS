import "server-only";
import { createHmac } from "node:crypto";
import { db } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import { MetaApiError } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiCallRecord {
  operation: string;
  method: string;
  path: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number;
  errorCode: number | null;
  errorSubcode: number | null;
  errorMessage: string | null;
  fbtraceId: string | null;
  requestId: string | null;
  workspaceId: string | null;
  whatsappAccountId: string | null;
}

export interface GraphClientConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Where call metadata is recorded. Defaults to the ProviderApiLog table. */
  recordCall?: (entry: ApiCallRecord) => Promise<void>;
}

async function recordToDatabase(entry: ApiCallRecord) {
  await db.providerApiLog
    .create({ data: entry })
    .catch((err: unknown) => logger.error({ err }, "provider log write failed"));
}

/**
 * True when the request certainly never reached Meta (DNS failure, connection refused),
 * so repeating it cannot cause a duplicate. Timeouts and resets are ambiguous.
 */
function requestNeverSent(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(cause?.code ?? "");
}

export interface CallContext {
  operation: string;
  accessToken?: string;
  workspaceId?: string | null;
  whatsappAccountId?: string | null;
  requestId?: string | null;
}

/**
 * Minimal Graph API client. Every call:
 *  - sends appsecret_proof when using an access token (Meta's recommended hardening)
 *  - has a timeout
 *  - is logged to ProviderApiLog without tokens or bodies
 *  - throws MetaApiError with a user-safe message on failure
 */
export class GraphClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: GraphClientConfig) {
    this.baseUrl = config.baseUrl ?? "https://graph.facebook.com";
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  get apiVersion() {
    return this.config.apiVersion;
  }

  appSecretProof(accessToken: string) {
    return createHmac("sha256", this.config.appSecret).update(accessToken).digest("hex");
  }

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    ctx: CallContext,
    options: { query?: Record<string, string>; body?: unknown; form?: FormData; raw?: boolean } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.config.apiVersion}${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (ctx.accessToken) {
      headers.Authorization = `Bearer ${ctx.accessToken}`;
      url.searchParams.set("appsecret_proof", this.appSecretProof(ctx.accessToken));
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const body = options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

    const started = Date.now();
    let response: Response | null = null;
    let parsed: unknown = null;
    let text = "";
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
      text = await response.text();
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
    } catch (error) {
      await this.log(ctx, method, path, null, false, Date.now() - started, null, null, (error as Error).message, null);
      throw new MetaApiError(ctx.operation, null, null, null, (error as Error).message, null, !requestNeverSent(error));
    }

    const errorObj = (
      parsed as { error?: { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string } }
    )?.error;
    if (!response.ok || errorObj) {
      const code = errorObj?.code ?? null;
      const subcode = errorObj?.error_subcode ?? null;
      const message = errorObj?.message ?? `HTTP ${response.status}`;
      const trace = errorObj?.fbtrace_id ?? null;
      await this.log(ctx, method, path, response.status, false, Date.now() - started, code, subcode, message, trace);
      throw new MetaApiError(ctx.operation, response.status, code, subcode, message, trace);
    }
    await this.log(ctx, method, path, response.status, true, Date.now() - started, null, null, null, null);
    return (options.raw ? text : parsed) as T;
  }

  /**
   * Downloads a media file from a Meta media URL (WA/business-phone-numbers/media#download-media).
   * The URL is not a Graph path and needs the bearer token. Rejects files larger than maxBytes.
   */
  async download(
    mediaUrl: string,
    ctx: CallContext & { accessToken: string },
    maxBytes: number,
  ): Promise<{ data: Buffer; contentType: string | null }> {
    const started = Date.now();
    const path = "<media-url>";
    let response: Response;
    try {
      response = await this.fetchImpl(mediaUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
    } catch (error) {
      await this.log(ctx, "GET", path, null, false, Date.now() - started, null, null, (error as Error).message, null);
      throw new MetaApiError(ctx.operation, null, null, null, (error as Error).message, null);
    }
    if (!response.ok) {
      await this.log(ctx, "GET", path, response.status, false, Date.now() - started, null, null, null, null);
      throw new MetaApiError(ctx.operation, response.status, null, null, `HTTP ${response.status}`, null);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new MetaApiError(ctx.operation, response.status, null, null, "media file too large", null);
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) {
      throw new MetaApiError(ctx.operation, response.status, null, null, "media file too large", null);
    }
    await this.log(ctx, "GET", path, response.status, true, Date.now() - started, null, null, null, null);
    return { data, contentType: response.headers.get("content-type") };
  }

  private async log(
    ctx: CallContext,
    method: string,
    path: string,
    statusCode: number | null,
    success: boolean,
    durationMs: number,
    errorCode: number | null,
    errorSubcode: number | null,
    errorMessage: string | null,
    fbtraceId: string | null,
  ) {
    const entry: ApiCallRecord = {
      operation: ctx.operation,
      method,
      path,
      statusCode,
      success,
      durationMs,
      errorCode,
      errorSubcode,
      errorMessage: errorMessage?.slice(0, 1000) ?? null,
      fbtraceId,
      requestId: ctx.requestId ?? null,
      workspaceId: ctx.workspaceId ?? null,
      whatsappAccountId: ctx.whatsappAccountId ?? null,
    };
    (success ? logger.info : logger.warn).call(logger, { meta: entry }, "meta api call");
    await (this.config.recordCall ?? recordToDatabase)(entry);
  }
}
