import { parseCsv } from "@/lib/csv";
import type { ValidationResult } from "@/backend/user/user.dto";

/**
 * @file        src/backend/roster/roster.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Parses and validates a roster upload into an array of whitelisted student
 *  emails destined for `allowed_emails`. Accepts EITHER a raw CSV document
 *  (`csv`) OR a pre-parsed `emails` array, normalising both to a clean, unique,
 *  lower-cased email list while surfacing every rejected entry with a reason.
 *
 * @remarks
 *  This is the anti-corruption layer for bulk ingestion: whatever messy sheet an
 *  instructor drops in, only syntactically valid, de-duplicated emails reach the
 *  service. Rejections are reported, never silently dropped.
 */

/** Pragmatic email syntax check (mirrors the signup DTO guard). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * All C0/C1 control characters (NUL through U+001F, plus U+007F–U+009F). Built
 * via RegExp so this source file stays free of invisible characters. A NUL byte
 * must never reach Postgres — it rejects text containing NUL with error 22P05
 * ("unsupported Unicode escape sequence").
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

/** Header names (case-insensitive) recognised as the email column. */
const EMAIL_HEADER_ALIASES = new Set(["email", "e-mail", "email address", "mail"]);

/** Upper bound on a single roster upload, protecting the batch insert path. */
const MAX_ROSTER_SIZE = 5000;

/** Raw roster upload payload as it arrives on the wire, before validation. */
export interface RosterUploadRequestRaw {
  /** Raw CSV / spreadsheet-export text. */
  csv?: unknown;
  /** Alternatively, a pre-parsed array of email strings. */
  emails?: unknown;
}

/** A single rejected roster entry and the reason it was rejected. */
export interface RejectedRosterEntry {
  value: string;
  reason: string;
}

/**
 * A validated roster ready for the service layer.
 *
 * @property emails            - Unique, normalised (lower-cased) valid emails.
 * @property rejected          - Entries that failed validation, with reasons.
 * @property duplicatesInFile  - Count of duplicate emails collapsed within the upload.
 */
export interface RosterUploadDto {
  emails: string[];
  rejected: RejectedRosterEntry[];
  duplicatesInFile: number;
}

/**
 * Outbound summary of a roster ingestion, returned to the dashboard.
 *
 * @property received          - Total valid, unique emails submitted to the service.
 * @property added             - Emails newly added to the whitelist.
 * @property alreadyWhitelisted - Emails skipped because they already existed.
 * @property duplicatesInFile  - Duplicate emails collapsed within the upload.
 * @property rejected          - Entries rejected during validation, with reasons.
 */
export interface RosterIngestionResultDto {
  received: number;
  added: number;
  alreadyWhitelisted: number;
  duplicatesInFile: number;
  rejected: readonly RejectedRosterEntry[];
}

/**
 * Extracts candidate email strings from a parsed CSV matrix.
 *
 * Strategy:
 *  1. If the first row contains a recognised email-header cell, take that column
 *     from every subsequent row.
 *  2. Otherwise, scan every cell of every row and keep those that look like an
 *     email — tolerating "name,email" sheets and bare single-column lists alike.
 *
 * @param matrix - Rows of cells from {@link parseCsv}.
 * @returns Raw (un-normalised) candidate email strings, in document order.
 */
function extractEmailCandidates(matrix: string[][]): string[] {
  if (matrix.length === 0) return [];

  const header = matrix[0]!;
  const headerColumn = header.findIndex((cell) =>
    EMAIL_HEADER_ALIASES.has(cell.trim().toLowerCase()),
  );

  if (headerColumn !== -1) {
    return matrix
      .slice(1)
      .map((r) => (r[headerColumn] ?? "").trim())
      .filter((v) => v.length > 0);
  }

  // No header — harvest anything email-shaped from every cell.
  const candidates: string[] = [];
  for (const r of matrix) {
    for (const cell of r) {
      const v = cell.trim();
      if (EMAIL_PATTERN.test(v.toLowerCase())) candidates.push(v);
    }
  }
  return candidates;
}

/**
 * Validates and normalises a raw roster upload payload.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: the {@link RosterUploadDto} on success,
 *          or top-level errors (e.g. neither field present, size exceeded).
 */
export function validateRosterUpload(
  input: RosterUploadRequestRaw | unknown,
): ValidationResult<RosterUploadDto> {
  const body = (input ?? {}) as RosterUploadRequestRaw;

  // 1. Collect raw candidates from whichever source was provided.
  let candidates: string[] = [];
  if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    candidates = extractEmailCandidates(parseCsv(body.csv));
  } else if (Array.isArray(body.emails)) {
    candidates = body.emails
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  } else {
    return {
      ok: false,
      errors: ['Provide either a "csv" string or an "emails" array.'],
    };
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      errors: ["No email addresses were found in the upload."],
    };
  }
  if (candidates.length > MAX_ROSTER_SIZE) {
    return {
      ok: false,
      errors: [`Roster exceeds the maximum of ${MAX_ROSTER_SIZE} rows.`],
    };
  }

  // 2. Normalise, validate, and de-duplicate.
  const seen = new Set<string>();
  const emails: string[] = [];
  const rejected: RejectedRosterEntry[] = [];
  let duplicatesInFile = 0;

  for (const raw of candidates) {
    // Strip any control characters (NUL, etc.) that survived — e.g. from a
    // non-UTF-8 upload or a raw `emails[]` payload — before validating. NUL in
    // particular must never reach Postgres (it rejects it with error 22P05).
    const normalized = raw.replace(CONTROL_CHARS, "").toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      rejected.push({ value: raw, reason: "Not a valid email address." });
      continue;
    }
    if (seen.has(normalized)) {
      duplicatesInFile += 1;
      continue;
    }
    seen.add(normalized);
    emails.push(normalized);
  }

  if (emails.length === 0) {
    return {
      ok: false,
      errors: ["No valid email addresses remained after validation."],
    };
  }

  return { ok: true, value: { emails, rejected, duplicatesInFile } };
}
