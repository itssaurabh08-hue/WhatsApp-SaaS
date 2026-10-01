import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { coerceCustomValue } from "@/lib/contacts/custom-values";
import { parseOptIn, splitFullName, type ColumnTarget } from "@/lib/contacts/fields";
import { CSV_MAX_BYTES, parseCsv, toCsv } from "@/lib/csv";
import { isCountryCode, normalizePhone } from "@/lib/phone";
import type { ImportOptions } from "@/lib/validation/imports";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import type { RequestMeta } from "@/server/request-meta";
import { ensureTagsByName } from "./tags";

type Meta = Partial<RequestMeta>;
type OptIn = "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";

const CHUNK = 1000;
const PREVIEW_ROWS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidRow {
  rowNumber: number;
  e164: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  country: string | null;
  optInStatus: OptIn;
  customFields: Record<string, string>;
  tagNames: string[];
}

export interface InvalidRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
}

export interface ImportPlan {
  valid: ValidRow[];
  invalid: InvalidRow[];
  /** Valid rows whose phone number already exists in the workspace. */
  existing: Map<string, { id: string; optInStatus: OptIn }>;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function createImportJob(ctx: TenantContext, file: { name: string; size: number; text: string }) {
  requirePermission(ctx, "contacts:import");
  if (file.size > CSV_MAX_BYTES) {
    throw new AppError("VALIDATION", { userMessage: `The file is larger than ${CSV_MAX_BYTES / 1024 / 1024} MB.` });
  }
  if (!/\.(csv|txt)$/i.test(file.name)) {
    throw new AppError("VALIDATION", { userMessage: "Upload a .csv file." });
  }
  const parsed = parseCsv(file.text);
  if (!parsed.ok) throw new AppError("VALIDATION", { userMessage: parsed.error });
  return db.importJob.create({
    data: {
      workspaceId: ctx.workspaceId,
      createdById: ctx.user.id,
      fileName: file.name.slice(0, 200),
      fileSize: file.size,
      csvContent: file.text,
      headers: parsed.data.headers,
      rowCount: parsed.data.rows.length,
    },
    select: { id: true },
  });
}

export async function getImportJob(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:import");
  const job = await db.importJob.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      status: true,
      headers: true,
      rowCount: true,
      mapping: true,
      options: true,
      createdCount: true,
      updatedCount: true,
      skippedCount: true,
      failedCount: true,
      completedAt: true,
      createdAt: true,
      csvContent: true,
    },
  });
  if (!job) throw new AppError("NOT_FOUND", { userMessage: "This import does not exist." });
  const parsed = job.csvContent ? parseCsv(job.csvContent) : null;
  const { csvContent: _omit, ...rest } = job;
  return {
    ...rest,
    headers: job.headers as string[],
    sample: parsed?.ok ? parsed.data.rows.slice(0, 5) : null,
    warnings: parsed?.ok ? parsed.data.warnings : [],
  };
}

export async function listImportJobs(ctx: TenantContext) {
  requirePermission(ctx, "contacts:import");
  return db.importJob.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      fileName: true,
      status: true,
      rowCount: true,
      createdCount: true,
      updatedCount: true,
      skippedCount: true,
      failedCount: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Validation (shared by preview and run)
// ---------------------------------------------------------------------------

/** Validates every row against the mapping. Pure apart from the custom field definitions passed in. */
export function validateRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnTarget[],
  options: ImportOptions,
  customTypes: Map<string, "TEXT" | "NUMBER" | "DATE" | "BOOLEAN">,
): { valid: ValidRow[]; invalid: InvalidRow[] } {
  const valid: ValidRow[] = [];
  const invalid: InvalidRow[] = [];
  const firstRowFor = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 1-based, after the header line
    const errors: string[] = [];
    const get = (target: ColumnTarget) => {
      const i = mapping.indexOf(target);
      return i >= 0 ? (row[i] ?? "").trim() : "";
    };

    let country: string | null = null;
    const countryRaw = get("country").toUpperCase();
    if (countryRaw) {
      if (isCountryCode(countryRaw)) country = countryRaw;
      else errors.push(`Country "${countryRaw}" is not a 2-letter country code`);
    }

    const phoneRaw = get("phoneNumber");
    const phone = normalizePhone(phoneRaw, country ?? options.defaultCountry);
    if (!phone.ok) errors.push(phoneRaw ? `Phone: ${phone.error}` : "Phone number is missing");

    const email = get("email").toLowerCase() || null;
    if (email && (!EMAIL_RE.test(email) || email.length > 254)) errors.push(`Email "${email}" is not valid`);

    let optInStatus: OptIn = options.defaultOptInStatus;
    if (mapping.includes("optInStatus")) {
      const raw = get("optInStatus");
      const parsed = parseOptIn(raw);
      if (parsed === null) errors.push(`Opt-in value "${raw}" is not recognized (use yes/no)`);
      else if (raw) optInStatus = parsed;
    }

    let firstName = get("firstName") || null;
    let lastName = get("lastName") || null;
    if (mapping.includes("fullName") && !firstName && !lastName) {
      ({ firstName, lastName } = splitFullName(get("fullName")));
    }

    const customFields: Record<string, string> = {};
    mapping.forEach((target, i) => {
      if (!target.startsWith("custom:")) return;
      const key = target.slice(7);
      const type = customTypes.get(key);
      if (!type) {
        errors.push(`Custom field "${key}" does not exist`);
        return;
      }
      const coerced = coerceCustomValue(type, row[i] ?? "");
      if (!coerced.ok) errors.push(`${key} ${coerced.error}`);
      else if (coerced.value !== null) customFields[key] = coerced.value;
    });

    const tagNames = get("tags")
      .split(/[,;|]/)
      .map((t) => t.trim().slice(0, 50))
      .filter(Boolean);

    if (phone.ok) {
      const first = firstRowFor.get(phone.e164);
      if (first !== undefined) errors.push(`Duplicate of row ${first} in this file`);
      else if (errors.length === 0) firstRowFor.set(phone.e164, rowNumber);
    }

    if (errors.length > 0 || !phone.ok) {
      invalid.push({ rowNumber, data: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])), errors });
      return;
    }
    valid.push({
      rowNumber,
      e164: phone.e164,
      phoneNumber: phoneRaw,
      firstName: firstName?.slice(0, 100) ?? null,
      lastName: lastName?.slice(0, 100) ?? null,
      email,
      company: get("company").slice(0, 120) || null,
      country: country ?? phone.country,
      optInStatus,
      customFields,
      tagNames,
    });
  });
  return { valid, invalid };
}

async function loadJobRows(ctx: TenantContext, jobId: string) {
  const job = await db.importJob.findFirst({
    where: { id: jobId, workspaceId: ctx.workspaceId },
    select: { id: true, status: true, csvContent: true, headers: true },
  });
  if (!job) throw new AppError("NOT_FOUND", { userMessage: "This import does not exist." });
  if (job.status !== "UPLOADED" || !job.csvContent) {
    throw new AppError("CONFLICT", { userMessage: "This import has already been processed." });
  }
  const parsed = parseCsv(job.csvContent);
  if (!parsed.ok) throw new AppError("VALIDATION", { userMessage: parsed.error });
  return { job, headers: parsed.data.headers, rows: parsed.data.rows };
}

async function customFieldTypes(ctx: TenantContext) {
  const defs = await db.customFieldDefinition.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { key: true, type: true },
  });
  return new Map(defs.map((d) => [d.key, d.type]));
}

async function findExisting(ctx: TenantContext, phones: string[]) {
  const existing = new Map<string, { id: string; optInStatus: OptIn }>();
  for (let i = 0; i < phones.length; i += CHUNK) {
    const found = await db.contact.findMany({
      where: { workspaceId: ctx.workspaceId, normalizedPhoneNumber: { in: phones.slice(i, i + CHUNK) } },
      select: { id: true, normalizedPhoneNumber: true, optInStatus: true },
    });
    for (const c of found) existing.set(c.normalizedPhoneNumber, { id: c.id, optInStatus: c.optInStatus });
  }
  return existing;
}

async function validateTargets(ctx: TenantContext, options: ImportOptions) {
  if (options.tagIds.length > 0) {
    const count = await db.tag.count({ where: { workspaceId: ctx.workspaceId, id: { in: options.tagIds } } });
    if (count !== new Set(options.tagIds).size)
      throw new AppError("VALIDATION", { userMessage: "One of the selected tags no longer exists." });
  }
  if (options.listId) {
    const list = await db.contactList.findFirst({
      where: { id: options.listId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!list) throw new AppError("VALIDATION", { userMessage: "The selected list no longer exists." });
  }
}

async function plan(ctx: TenantContext, jobId: string, mapping: ColumnTarget[], options: ImportOptions) {
  const { job, headers, rows } = await loadJobRows(ctx, jobId);
  if (mapping.length !== headers.length)
    throw new AppError("VALIDATION", { userMessage: "The column mapping does not match the file." });
  await validateTargets(ctx, options);
  const { valid, invalid } = validateRows(headers, rows, mapping, options, await customFieldTypes(ctx));
  const existing = await findExisting(
    ctx,
    valid.map((v) => v.e164),
  );
  return { job, headers, valid, invalid, existing };
}

export interface ImportPreview {
  totalRows: number;
  newCount: number;
  existingCount: number;
  invalidCount: number;
  /** Existing opted-out contacts that the file marks as opted in; they stay opted out. */
  keptOptedOutCount: number;
  sample: ValidRow[];
  invalidSample: InvalidRow[];
}

export async function previewImport(
  ctx: TenantContext,
  jobId: string,
  mapping: ColumnTarget[],
  options: ImportOptions,
): Promise<ImportPreview> {
  requirePermission(ctx, "contacts:import");
  const { valid, invalid, existing } = await plan(ctx, jobId, mapping, options);
  const existingRows = valid.filter((v) => existing.has(v.e164));
  return {
    totalRows: valid.length + invalid.length,
    newCount: valid.length - existingRows.length,
    existingCount: existingRows.length,
    invalidCount: invalid.length,
    keptOptedOutCount: existingRows.filter(
      (v) => v.optInStatus === "OPTED_IN" && existing.get(v.e164)?.optInStatus === "OPTED_OUT",
    ).length,
    sample: valid.slice(0, PREVIEW_ROWS),
    invalidSample: invalid.slice(0, PREVIEW_ROWS),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function runImport(
  ctx: TenantContext,
  jobId: string,
  mapping: ColumnTarget[],
  options: ImportOptions,
  meta: Meta = {},
) {
  requirePermission(ctx, "contacts:import");
  const { valid, invalid, existing } = await plan(ctx, jobId, mapping, options);

  // Claim the job atomically so a double submit cannot import twice.
  const claimed = await db.importJob.updateMany({
    where: { id: jobId, workspaceId: ctx.workspaceId, status: "UPLOADED" },
    data: { status: "RUNNING", mapping, options: options as unknown as Prisma.InputJsonValue },
  });
  if (claimed.count !== 1)
    throw new AppError("CONFLICT", { userMessage: "This import is already running or finished." });

  const now = new Date();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  try {
    const newRows = valid.filter((v) => !existing.has(v.e164));
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const res = await db.contact.createMany({
        data: newRows.slice(i, i + CHUNK).map((v) => ({
          workspaceId: ctx.workspaceId,
          phoneNumber: v.phoneNumber,
          normalizedPhoneNumber: v.e164,
          firstName: v.firstName,
          lastName: v.lastName,
          email: v.email,
          company: v.company,
          country: v.country,
          customFields: v.customFields,
          optInStatus: v.optInStatus,
          optInSource: v.optInStatus === "OPTED_IN" ? options.optInSource : null,
          optInAt: v.optInStatus === "OPTED_IN" ? now : null,
          optedOutAt: v.optInStatus === "OPTED_OUT" ? now : null,
          source: "IMPORT",
        })),
        skipDuplicates: true,
      });
      created += res.count;
      skipped += Math.min(CHUNK, newRows.length - i) - res.count; // created concurrently by someone else
    }

    const existingRows = valid.filter((v) => existing.has(v.e164));
    if (options.duplicateStrategy === "skip") {
      skipped += existingRows.length;
    } else {
      for (let i = 0; i < existingRows.length; i += 200) {
        const ops: Prisma.PrismaPromise<unknown>[] = [];
        for (const v of existingRows.slice(i, i + 200)) {
          const current = existing.get(v.e164)!;
          // Never re-opt-in a contact who opted out (business rule): an import is not fresh consent.
          const nextOptIn =
            current.optInStatus === "OPTED_OUT" && v.optInStatus === "OPTED_IN" ? "OPTED_OUT" : v.optInStatus;
          const data: Prisma.ContactUpdateManyMutationInput = {
            ...(v.firstName !== null && { firstName: v.firstName }),
            ...(v.lastName !== null && { lastName: v.lastName }),
            ...(v.email !== null && { email: v.email }),
            ...(v.company !== null && { company: v.company }),
            ...(v.country !== null && { country: v.country }),
          };
          if (mapping.includes("optInStatus") && nextOptIn !== current.optInStatus) {
            data.optInStatus = nextOptIn;
            if (nextOptIn === "OPTED_IN") Object.assign(data, { optInAt: now, optInSource: options.optInSource });
            if (nextOptIn === "OPTED_OUT") data.optedOutAt = now;
          }
          ops.push(db.contact.updateMany({ where: { id: current.id, workspaceId: ctx.workspaceId }, data }));
          if (Object.keys(v.customFields).length > 0) {
            // Merge (jsonb ||) so custom fields not present in the file are kept.
            ops.push(db.$executeRaw`UPDATE "Contact" SET "customFields" = "customFields" || ${JSON.stringify(v.customFields)}::jsonb
              WHERE "id" = ${current.id} AND "workspaceId" = ${ctx.workspaceId}`);
          }
        }
        await db.$transaction(ops);
        updated += Math.min(200, existingRows.length - i);
      }
    }

    // Tags and list membership for every imported row (new or existing, unless skipped).
    const affected = options.duplicateStrategy === "skip" ? valid.filter((v) => !existing.has(v.e164)) : valid;
    const ids = await idsByPhone(
      ctx,
      affected.map((v) => v.e164),
    );
    const tagByName = await ensureTagsByName(
      ctx,
      affected.flatMap((v) => v.tagNames),
    );
    const tagLinks: { workspaceId: string; contactId: string; tagId: string }[] = [];
    const listLinks: { workspaceId: string; contactId: string; listId: string }[] = [];
    for (const v of affected) {
      const contactId = ids.get(v.e164);
      if (!contactId) continue;
      const tagIds = new Set([
        ...options.tagIds,
        ...v.tagNames.map((n) => tagByName.get(n.toLowerCase())).filter((x): x is string => !!x),
      ]);
      for (const tagId of tagIds) tagLinks.push({ workspaceId: ctx.workspaceId, contactId, tagId });
      if (options.listId) listLinks.push({ workspaceId: ctx.workspaceId, contactId, listId: options.listId });
    }
    for (let i = 0; i < tagLinks.length; i += CHUNK) {
      await db.contactTag.createMany({ data: tagLinks.slice(i, i + CHUNK), skipDuplicates: true });
    }
    for (let i = 0; i < listLinks.length; i += CHUNK) {
      await db.contactListMember.createMany({ data: listLinks.slice(i, i + CHUNK), skipDuplicates: true });
    }

    for (let i = 0; i < invalid.length; i += CHUNK) {
      await db.importRowError.createMany({
        data: invalid.slice(i, i + CHUNK).map((r) => ({
          workspaceId: ctx.workspaceId,
          importJobId: jobId,
          rowNumber: r.rowNumber,
          data: r.data,
          errors: r.errors.join("; "),
        })),
      });
    }

    // The raw file is no longer needed: failed rows are kept in ImportRowError for the report.
    await db.importJob.updateMany({
      where: { id: jobId, workspaceId: ctx.workspaceId },
      data: {
        status: "COMPLETED",
        csvContent: null,
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
        failedCount: invalid.length,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error({ err: error, jobId }, "contact import failed");
    await db.importJob.updateMany({ where: { id: jobId, workspaceId: ctx.workspaceId }, data: { status: "FAILED" } });
    throw new AppError("INTERNAL", {
      message: "import failed",
      cause: error,
      userMessage: "The import failed. No further rows were imported; please try again.",
    });
  }

  await audit(
    {
      action: "contacts.imported",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "ImportJob",
      entityId: jobId,
      metadata: { created, updated, skipped, failed: invalid.length },
    },
    meta,
  );
  return { created, updated, skipped, failed: invalid.length };
}

async function idsByPhone(ctx: TenantContext, phones: string[]) {
  const map = new Map<string, string>();
  for (let i = 0; i < phones.length; i += CHUNK) {
    const rows = await db.contact.findMany({
      where: { workspaceId: ctx.workspaceId, normalizedPhoneNumber: { in: phones.slice(i, i + CHUNK) } },
      select: { id: true, normalizedPhoneNumber: true },
    });
    for (const r of rows) map.set(r.normalizedPhoneNumber, r.id);
  }
  return map;
}

/** Failed rows as CSV: the original columns plus row number and error message. */
export async function importErrorsCsv(ctx: TenantContext, jobId: string): Promise<{ fileName: string; csv: string }> {
  requirePermission(ctx, "contacts:import");
  const job = await db.importJob.findFirst({
    where: { id: jobId, workspaceId: ctx.workspaceId },
    select: { fileName: true, headers: true },
  });
  if (!job) throw new AppError("NOT_FOUND");
  const headers = job.headers as string[];
  const errors = await db.importRowError.findMany({
    where: { importJobId: jobId, workspaceId: ctx.workspaceId },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, data: true, errors: true },
  });
  const rows = errors.map((e) => {
    const data = e.data as Record<string, string>;
    return [e.rowNumber, e.errors, ...headers.map((h) => data[h] ?? "")];
  });
  return {
    fileName: job.fileName.replace(/\.(csv|txt)$/i, "") + "-errors.csv",
    csv: toCsv(["Row", "Error", ...headers], rows),
  };
}
