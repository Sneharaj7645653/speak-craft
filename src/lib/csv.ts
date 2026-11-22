/**
 * @file        src/lib/csv.ts
 * @layer       Infrastructure / Parsing utility
 * @description
 *  A small, dependency-free CSV parser sufficient for roster ingestion. It
 *  handles the cases produced by Excel / Google Sheets "Save as CSV":
 *   - comma-separated fields,
 *   - double-quoted fields containing commas or newlines,
 *   - escaped quotes (`""`) inside quoted fields,
 *   - LF, CRLF, and CR line endings.
 *
 * @remarks
 *  This is intentionally NOT a full RFC-4180 library — it covers the roster
 *  ingestion contract without adding a runtime dependency. For binary `.xlsx`
 *  workbooks, export to CSV first (the dashboard guides users to do so).
 */

/**
 * A leading byte-order mark (U+FEFF), from UTF-8/UTF-16 exports.
 * Built via RegExp to keep this source file free of invisible characters.
 */
const BOM = new RegExp("^\\uFEFF");

/**
 * NUL and other C0/C1 control characters, EXCLUDING tab (U+0009), line feed
 * (U+000A) and carriage return (U+000D) — which the parser needs for structure.
 *
 * A UTF-16 file decoded as UTF-8 interleaves NUL (U+0000) between characters;
 * stripping these recovers the ASCII content and prevents NUL bytes from ever
 * reaching Postgres, which rejects them with error 22P05 ("unsupported Unicode
 * escape sequence") because text columns cannot store NUL.
 */
const NON_STRUCTURAL_CONTROLS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]",
  "g",
);

/**
 * Parses CSV text into a matrix of string cells.
 *
 * @param text - Raw CSV document content.
 * @returns An array of rows, each an array of trimmed-of-nothing cell strings.
 *          Empty input yields an empty array. Trailing empty lines are dropped.
 *
 * @example
 * parseCsv('email,name\n"a@x.io","Ann"') // → [["email","name"],["a@x.io","Ann"]]
 */
export function parseCsv(text: string): string[][] {
  // Sanitise before parsing so encoding artefacts never reach the database,
  // while preserving the line-ending / tab characters the parser needs.
  const source = text.replace(BOM, "").replace(NON_STRUCTURAL_CONTROLS, "");

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const len = source.length;
  let i = 0;

  /** Commits the accumulated field to the current row. */
  const endField = (): void => {
    row.push(field);
    field = "";
  };

  /** Commits the current row to the result set. */
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const char = source[i]!;

    if (inQuotes) {
      if (char === '"') {
        // Look ahead: `""` is an escaped quote, otherwise the quote closes.
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Handle CRLF and lone CR uniformly.
      endRow();
      if (source[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Flush the trailing field/row if the document did not end with a newline.
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  // Drop rows that are entirely empty (e.g. blank trailing lines).
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}
