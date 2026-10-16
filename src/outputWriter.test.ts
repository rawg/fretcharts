import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeSvgOutput, isDocumentOutputPath, writeDocumentOutput } from "./outputWriter";
import type { ChartDocument } from "./document";

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];
const FIXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="black"/></svg>`;

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  return {
    stdoutSpy,
    stderrSpy,
    get stdout() {
      return stdout.join("");
    },
    get stderr() {
      return stderr.join("");
    },
  };
}

describe("writeSvgOutput", () => {
  let cap: ReturnType<typeof capture>;
  const tmpFiles: string[] = [];

  beforeEach(() => {
    cap = capture();
  });

  afterEach(() => {
    cap.stdoutSpy.mockRestore();
    cap.stderrSpy.mockRestore();
    for (const f of tmpFiles.splice(0)) {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  });

  function tmpPath(name: string): string {
    const p = path.join(
      os.tmpdir(),
      `fretcharts-outputwriter-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`,
    );
    tmpFiles.push(p);
    return p;
  }

  it("writes to stdout when outputPath is undefined", async () => {
    const code = await writeSvgOutput(FIXTURE_SVG, undefined);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<svg");
    expect(cap.stderr).toBe("");
  });

  it("writes an SVG file for a .svg extension", async () => {
    const out = tmpPath("chart.svg");
    const code = await writeSvgOutput(FIXTURE_SVG, out);
    expect(code).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toContain("<svg");
    expect(cap.stdout).toBe("");
  });

  it("rasterizes to PNG for a .png extension", async () => {
    const out = tmpPath("chart.png");
    const code = await writeSvgOutput(FIXTURE_SVG, out);
    expect(code).toBe(0);
    const content = fs.readFileSync(out);
    expect(Array.from(content.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });

  it("returns exit code 1 with a clean stderr message for an unrecognized extension", async () => {
    const out = tmpPath("chart.txt");
    const code = await writeSvgOutput(FIXTURE_SVG, out);
    expect(code).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  describe("isDocumentOutputPath", () => {
    it("is true for .yaml/.yml/.json (any case)", () => {
      expect(isDocumentOutputPath("chart.yaml")).toBe(true);
      expect(isDocumentOutputPath("chart.yml")).toBe(true);
      expect(isDocumentOutputPath("chart.json")).toBe(true);
      expect(isDocumentOutputPath("chart.YAML")).toBe(true);
      expect(isDocumentOutputPath("chart.JSON")).toBe(true);
    });

    it("is false for .svg/.png/other extensions and undefined", () => {
      expect(isDocumentOutputPath("chart.svg")).toBe(false);
      expect(isDocumentOutputPath("chart.png")).toBe(false);
      expect(isDocumentOutputPath("chart.txt")).toBe(false);
      expect(isDocumentOutputPath(undefined)).toBe(false);
    });
  });

  describe("writeDocumentOutput", () => {
    const chordDoc: ChartDocument = { type: "chord", notation: "x02220", label: "A" };

    it("writes genuine JSON for a .json path", () => {
      const out = tmpPath("chart.json");
      const code = writeDocumentOutput(chordDoc, out);
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(parsed).toEqual(chordDoc);
    });

    it("writes YAML for a .yaml path", () => {
      const out = tmpPath("chart.yaml");
      const code = writeDocumentOutput(chordDoc, out);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: chord");
      expect(text).toContain("notation: x02220");
      expect(text).not.toContain("{"); // not JSON-formatted
    });

    it("writes YAML for a .yml path", () => {
      const out = tmpPath("chart.yml");
      const code = writeDocumentOutput(chordDoc, out);
      expect(code).toBe(0);
      expect(fs.readFileSync(out, "utf8")).toContain("type: chord");
    });

    it("YAML output uses a block scalar for multi-line stylesheet text", () => {
      const out = tmpPath("chart.yaml");
      const doc: ChartDocument = {
        type: "chord",
        notation: "x02220",
        stylesheet: ".chord-dot { fill: red; }\n.chord-title { fill: blue; }\n",
      };
      writeDocumentOutput(doc, out);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("stylesheet: |\n  .chord-dot { fill: red; }\n  .chord-title { fill: blue; }\n");
    });

    it("quotes a numeric-looking string field (root) so it round-trips as a string", () => {
      const out = tmpPath("chart.yaml");
      const doc: ChartDocument = { type: "chord", notation: "x02220", root: "5" };
      writeDocumentOutput(doc, out);
      expect(fs.readFileSync(out, "utf8")).toContain('root: "5"');
    });
  });
});
