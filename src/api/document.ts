/**
 * /document -- render from a single, self-contained chart-document
 * (YAML/JSON) passed as text.
 *
 * This route never reads a file based on request data. A document's
 * `stylesheetFile`/`defsFile`/`csvFile` fields mean "read this path
 * relative to the document's own directory" (see src/document.ts) --
 * there's no meaningful "document's own directory" for text pasted into
 * the browser, and no filesystem to read from there anyway, so a document
 * using any of these fields is rejected outright below. This
 * mirrors exactly how /bulk already refuses a per-row stylesheetPath -- a
 * caller wanting an external stylesheet/defs/CSV file should use the
 * CLI's --file instead, which has a real local filesystem to resolve
 * relative paths against.
 */

import { parse } from "csv-parse/sync";
import { parseDocument, buildDocument } from "../document";
import { ok, invalid, ApiResult, gridParts } from "./result";

/**
 * Same defensive bound /bulk applies to CSV rows, reused here for a
 * type: chords document's inline CSV.
 */
const MAX_ROWS = 200;

interface DocumentRequestBody {
  /** Raw YAML/JSON document text -- see src/document.ts's ChartDocument for the schema. */
  document?: unknown;
  /** Overrides the document's own `transpose:` field, if given -- same "request field wins" precedent as the CLI's `--transpose` combined with `--file`. */
  transpose?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Data-row count, or 0 if unparseable -- buildDocument's own CSV parse surfaces the real, well-formatted error for genuinely malformed CSV. */
function csvDataRowCount(csvText: string): number {
  try {
    const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as unknown[];
    return rows.length;
  } catch {
    return 0;
  }
}

export function handleDocument(body: unknown): ApiResult {
  if (typeof body !== "object" || body === null) {
    return invalid("request body must be a JSON object");
  }
  const req = body as DocumentRequestBody;

  if (!isNonEmptyString(req.document)) {
    return invalid("document is required and must be a non-empty string");
  }
  if (req.transpose !== undefined && !isNumber(req.transpose)) {
    return invalid("transpose must be a number");
  }

  // Unguarded -- a malformed document throws DocumentError/ChartInputError/
  // FingerPositionError, which propagate to handler.ts's catch and get a
  // clean 400 via http.ts's errorResponse, same as every other route.
  const doc = parseDocument(req.document);
  if (isNumber(req.transpose)) {
    doc.transpose = req.transpose;
  }

  if (doc.stylesheetFile !== undefined) {
    return invalid('stylesheetFile is not supported in the web UI -- use the inline "stylesheet" field instead, or the CLI\'s --file for external file references');
  }
  if (doc.defsFile !== undefined) {
    return invalid('defsFile is not supported in the web UI -- use the inline "defs" field instead, or the CLI\'s --file for external file references');
  }
  if (doc.type === "chords") {
    if (doc.csvFile !== undefined) {
      return invalid('csvFile is not supported in the web UI -- use the inline "csv" field instead, or the CLI\'s --file for external file references');
    }
    if (doc.csv !== undefined) {
      const rowCount = csvDataRowCount(doc.csv);
      if (rowCount > MAX_ROWS) {
        return invalid(`too many rows (${rowCount}); the maximum is ${MAX_ROWS}`);
      }
    }
  }

  // basePath is inert here -- stylesheetFile/csvFile are already rejected
  // above, so buildDocument never actually resolves a path against it.
  const { svg, warnings, grid } = buildDocument(doc, ".");
  const responseWarnings = warnings.length > 0 ? warnings : undefined;

  return ok({ svg, warnings: responseWarnings, grid: grid ? gridParts(grid) : undefined });
}
