/**
 * Writes a final SVG string to stdout (default) or a file, rasterizing to
 * PNG first if the output path's extension calls for it -- or, for a
 * .yaml/.yml/.json path, writes a chart-document file instead (see
 * writeDocumentOutput below and ./document.ts), capturing the parameters
 * that produced the render rather than the render itself, so it can be
 * edited and re-rendered later (matching the web UI's "Download document"
 * feature). Shared by the single-chord, bulk CSV, and document-file CLI
 * paths so they all agree on this behavior.
 */

import * as fs from "fs";
import * as path from "path";
import { stringify as stringifyYamlText } from "yaml";
import { renderPng } from "./render/png";
// Type-only: erased at compile time, so this doesn't create a runtime
// circular dependency even though document.ts imports writeSvgOutput
// from this module -- see writeDocumentOutput's doc comment.
import type { ChartDocument } from "./document";

/**
 * True when `outputPath` ends in .yaml/.yml/.json -- the extensions that
 * mean "write a chart-document file instead of rendering" (see
 * writeDocumentOutput below). A type predicate so a caller's `if
 * (isDocumentOutputPath(x))` block narrows `x` to `string`, without a
 * separate `x !== undefined` check.
 */
export function isDocumentOutputPath(outputPath: string | undefined): outputPath is string {
  if (outputPath === undefined) return false;
  const ext = path.extname(outputPath).toLowerCase();
  return ext === ".yaml" || ext === ".yml" || ext === ".json";
}

export async function writeSvgOutput(svg: string, outputPath: string | undefined): Promise<number> {
  if (outputPath === undefined) {
    process.stdout.write(`${svg}\n`);
    return 0;
  }

  const ext = path.extname(outputPath).toLowerCase();
  if (ext === ".svg") {
    fs.writeFileSync(outputPath, svg, "utf8");
    return 0;
  }
  if (ext === ".png") {
    const png = await renderPng(svg);
    fs.writeFileSync(outputPath, png);
    return 0;
  }

  process.stderr.write(
    `Unrecognized --output extension ${JSON.stringify(ext || outputPath)}: use a path ending in .svg or .png\n`,
  );
  return 1;
}

/**
 * Writes `doc` to `outputPath` as a chart-document file -- genuine JSON
 * (`JSON.stringify`) for a `.json` path, or YAML (the `yaml` package's
 * own `stringify`, which already produces clean, human-friendly output --
 * block scalars for multi-line stylesheet/csv text, minimal quoting, same
 * as this tool's own README examples) for `.yaml`/`.yml`. Only ever
 * called with a real file path (there's no "document to stdout" mode --
 * callers only reach this because `isDocumentOutputPath` already
 * confirmed the extension calls for it), so unlike `writeSvgOutput` this
 * is synchronous -- no rasterization step to await.
 */
export function writeDocumentOutput(doc: ChartDocument, outputPath: string): number {
  const ext = path.extname(outputPath).toLowerCase();
  const text = ext === ".json" ? `${JSON.stringify(doc, null, 2)}\n` : stringifyYamlText(doc);
  fs.writeFileSync(outputPath, text, "utf8");
  return 0;
}
