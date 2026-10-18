/**
 * Browser entry point: bundled by scripts/build-web.mjs into
 * web/engine.js, which exposes `window.ChordChartsEngine` for web/app.js.
 * Everything renders client-side -- the same request handlers the old
 * Lambda ran (../api), plus an SVG-to-PNG step on a <canvas> in place of
 * the `sharp` rasterizer the CLI uses.
 */

import { handleRequest, RenderOutput } from "../api";

// For web/app.js: stamping downloaded FretCharts files, and spotting an
// uploaded one from a newer release (see src/version.ts).
export { VERSION, compareVersions, isVersion } from "../version";
// For web/app.js's per-string inputs, so what they produce reads the same
// as the CLI's and fretcharts-triads' output (e.g. "- - - 5 R 3").
export { stringCountFor, stringifyPerStringCompact } from "../chartFieldResolver";

export interface EngineResponse extends RenderOutput {
  format: "svg" | "png";
  /** `format: "png"` only: a data: URL for the rasterized image. */
  pngUrl?: string;
}

export type EngineResult = { ok: true; data: EngineResponse } | { ok: false; error: string };

/** Reads a root <svg>'s width/height attributes -- every generator in src/render and src/bulk.ts sets both. */
function svgSize(svg: string): { width: number; height: number } {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const width = parseFloat(root.getAttribute("width") ?? "");
  const height = parseFloat(root.getAttribute("height") ?? "");
  if (!(width > 0 && height > 0)) {
    throw new Error("rendered SVG is missing a usable width/height");
  }
  return { width, height };
}

/**
 * Rasterizes an SVG string to a PNG data: URL at its own pixel size --
 * the same 1 SVG unit = 1 pixel output `sharp` produces for the CLI.
 * Loaded through a data: URL (not a blob: URL) so the canvas is never
 * considered cross-origin-tainted, which would make toDataURL throw.
 */
export async function svgToPngUrl(svg: string): Promise<string> {
  const { width, height } = svgSize(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D rendering isn't available in this browser");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/**
 * Renders a request for `route` (/chart, /bulk, /neck, /document, or
 * /triads -- see ../api) and, when `body.format` is "png", rasterizes the
 * result. Always resolves, never rejects: failures come back as
 * `{ ok: false, error }` with a message fit for display.
 */
export async function render(route: string, body: unknown): Promise<EngineResult> {
  const result = handleRequest(route, body);
  if (!result.ok) return result;

  const wantsPng = typeof body === "object" && body !== null && (body as { format?: unknown }).format === "png";
  if (!wantsPng) {
    return { ok: true, data: { format: "svg", ...result.data } };
  }
  try {
    const pngUrl = await svgToPngUrl(result.data.svg);
    return { ok: true, data: { format: "png", pngUrl, ...result.data } };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Could not convert the chart to PNG in this browser. Try SVG instead." };
  }
}
