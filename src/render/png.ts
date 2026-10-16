import sharp from "sharp";

/**
 * Rasterizes an SVG string to a PNG buffer.
 *
 * This is the only place in the codebase that touches the `sharp` native
 * dependency, kept intentionally small so that the native surface area is
 * easy to review.
 */
export async function renderPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}
