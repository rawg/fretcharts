import { describe, it, expect } from "vitest";
import { renderPng } from "./png";

const fixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>`;

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

describe("renderPng", () => {
  it("resolves to a Buffer", async () => {
    const result = await renderPng(fixtureSvg);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("produces a buffer starting with the PNG magic bytes", async () => {
    const result = await renderPng(fixtureSvg);
    expect(Array.from(result.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });

  it("produces a non-trivial buffer", async () => {
    const result = await renderPng(fixtureSvg);
    expect(result.length).toBeGreaterThan(50);
  });

  it("rejects on empty input", async () => {
    await expect(renderPng("")).rejects.toThrow();
  });

  it("rejects on malformed/garbage input", async () => {
    await expect(renderPng("this is not svg at all")).rejects.toThrow();
  });
});
