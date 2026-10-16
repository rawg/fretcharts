import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseDocument, buildDocument, runDocument, DocumentError } from "./document";
import { ChartInputError } from "./chartFieldResolver";
import { FingerPositionError } from "./fingerPositions";
import { ChordParseError } from "./chordparse";
import { LayoutError } from "./types";

function tmpPath(name: string): string {
  return path.join(os.tmpdir(), `document-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

describe("parseDocument", () => {
  it("parses a minimal type: chord document", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\n');
    expect(doc).toEqual({ type: "chord", notation: "x02220" });
  });

  it("parses a minimal type: scale document (compact notes string)", () => {
    const doc = parseDocument('type: scale\nnotes: "6:3:R"\n');
    expect(doc).toEqual({ type: "scale", notes: "6:3:R" });
  });

  it("parses a minimal type: neck document (native YAML notes list)", () => {
    const doc = parseDocument("type: neck\nnotes:\n  - { string: 6, fret: 3, label: R }\n");
    expect(doc).toEqual({ type: "neck", notes: [{ string: 6, fret: 3, label: "R" }] });
  });

  it("parses a multi-line compact notes block scalar, one marker per line", () => {
    const doc = parseDocument("type: scale\nnotes: |\n  6:3:R:root\n  6:5:2\n  5:2:b3\n");
    expect(doc).toEqual({ type: "scale", notes: "6:3:R:root\n6:5:2\n5:2:b3\n" });
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">R<");
    expect(svg).toContain(">2<");
    expect(svg).toContain(">b3<");
  });

  it("parses a minimal type: chords document (inline csv)", () => {
    const doc = parseDocument("type: chords\ncsv: |\n  notes\n  x02220\n");
    expect(doc).toEqual({ type: "chords", csv: "notes\nx02220\n" });
  });

  it("accepts a .json-shaped body (JSON is a YAML subset)", () => {
    const doc = parseDocument('{"type": "chord", "notation": "x02220"}');
    expect(doc).toEqual({ type: "chord", notation: "x02220" });
  });

  it("rejects malformed YAML with DocumentError", () => {
    expect(() => parseDocument("type: chord\n  bad: [unclosed\n")).toThrow(DocumentError);
  });

  it("rejects a document that isn't an object", () => {
    expect(() => parseDocument("just a string")).toThrow(DocumentError);
    expect(() => parseDocument("- 1\n- 2\n")).toThrow(DocumentError);
  });

  it("rejects a missing type field", () => {
    expect(() => parseDocument("notation: x02220\n")).toThrow(DocumentError);
  });

  it("rejects an unrecognized type value", () => {
    expect(() => parseDocument("type: banana\n")).toThrow(DocumentError);
  });

  it("rejects an unrecognized field for the given type", () => {
    expect(() => parseDocument("type: chord\nnotation: x02220\nbogusField: true\n")).toThrow(DocumentError);
  });

  it("rejects a field with the wrong type", () => {
    expect(() => parseDocument("type: chord\nnotation: x02220\nlabelTuning: not-a-boolean\n")).toThrow(
      DocumentError,
    );
  });

  it("rejects notation missing on a chord document", () => {
    expect(() => parseDocument("type: chord\nlabel: foo\n")).toThrow(DocumentError);
  });

  it("rejects notes missing on a scale/neck document", () => {
    expect(() => parseDocument("type: scale\nlabel: foo\n")).toThrow(DocumentError);
    expect(() => parseDocument("type: neck\nlabel: foo\n")).toThrow(DocumentError);
  });

  it("accepts labelPitches on scale/neck documents", () => {
    expect(parseDocument('type: scale\nnotes: "6:3"\nlabelPitches: true\n')).toEqual({
      type: "scale",
      notes: "6:3",
      labelPitches: true,
    });
    expect(parseDocument('type: neck\nnotes: "6:3"\nlabelPitches: true\n')).toEqual({
      type: "neck",
      notes: "6:3",
      labelPitches: true,
    });
  });

  it("accepts labelFrets on scale/neck documents", () => {
    expect(parseDocument('type: scale\nnotes: "6:3"\nlabelFrets: false\n')).toEqual({
      type: "scale",
      notes: "6:3",
      labelFrets: false,
    });
    expect(parseDocument('type: neck\nnotes: "6:3"\nlabelFrets: false\n')).toEqual({
      type: "neck",
      notes: "6:3",
      labelFrets: false,
    });
  });

  it("rejects stylesheet and stylesheetFile both given", () => {
    expect(() =>
      parseDocument('type: chord\nnotation: x02220\nstylesheet: "a"\nstylesheetFile: "b.css"\n'),
    ).toThrow(DocumentError);
  });

  it("rejects a non-numeric transpose field", () => {
    expect(() => parseDocument('type: chord\nnotation: "x02220"\ntranspose: "two"\n')).toThrow(DocumentError);
  });

  it("accepts a numeric transpose field (including negative)", () => {
    expect(parseDocument('type: chord\nnotation: "x02220"\ntranspose: -2\n')).toEqual({
      type: "chord",
      notation: "x02220",
      transpose: -2,
    });
  });

  it("rejects defs and defsFile both given", () => {
    expect(() =>
      parseDocument('type: chord\nnotation: x02220\ndefs: "<x/>"\ndefsFile: "b.svg"\n'),
    ).toThrow(DocumentError);
  });

  it("rejects a chords document with both csv and csvFile", () => {
    expect(() => parseDocument("type: chords\ncsv: |\n  notes\n  x02220\ncsvFile: foo.csv\n")).toThrow(
      DocumentError,
    );
  });

  it("rejects a chords document with neither csv nor csvFile", () => {
    expect(() => parseDocument("type: chords\ncolumns: 4\n")).toThrow(DocumentError);
  });

  it("propagates ChartInputError for malformed stringLabels JSON", () => {
    expect(() => parseDocument('type: chord\nnotation: x02220\nstringLabels: "{not json"\n')).toThrow(
      ChartInputError,
    );
  });

  it("propagates ChartInputError for a malformed notes string", () => {
    expect(() => parseDocument("type: scale\nnotes: banana\n")).toThrow(ChartInputError);
  });

  it("propagates ChartInputError for an out-of-range string number in a native YAML notes list", () => {
    expect(() => parseDocument("type: scale\nnotes:\n  - { string: 9, fret: 3 }\n")).toThrow(ChartInputError);
  });

  it("propagates FingerPositionError for an out-of-range finger", () => {
    expect(() =>
      parseDocument("type: scale\nnotes:\n  - { string: 6, fret: 3, finger: 9 }\n"),
    ).toThrow(FingerPositionError);
  });

  it("rejects a chords document with defaults.stylesheet", () => {
    expect(() =>
      parseDocument("type: chords\ncsv: |\n  notes\n  x02220\ndefaults:\n  stylesheet: foo.css\n"),
    ).toThrow(DocumentError);
  });

  it("rejects a chords document with defaults.stylesheetPath", () => {
    expect(() =>
      parseDocument("type: chords\ncsv: |\n  notes\n  x02220\ndefaults:\n  stylesheetPath: foo.css\n"),
    ).toThrow(DocumentError);
  });

  it("rejects a chords document with an unrecognized defaults key", () => {
    expect(() =>
      parseDocument("type: chords\ncsv: |\n  notes\n  x02220\ndefaults:\n  bogusField: true\n"),
    ).toThrow(DocumentError);
  });

  it("accepts a chords document with recognized defaults keys", () => {
    const doc = parseDocument("type: chords\ncsv: |\n  notes\n  x02220\ndefaults:\n  root: \"5\"\n  tuning: DADGBE\n");
    expect(doc).toMatchObject({ type: "chords", defaults: { root: "5", tuning: "DADGBE" } });
  });
});

describe("buildDocument", () => {
  it("builds a type: chord document to SVG", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\nlabel: "A"\n');
    const { svg, output } = buildDocument(doc, "/tmp");
    expect(svg).toContain("<svg");
    expect(svg).toContain(">A<");
    expect(output).toBeUndefined();
  });

  it("builds a type: scale document (compact notes) to SVG", () => {
    const doc = parseDocument('type: scale\nnotes: "6:3:R"\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">R<");
  });

  it("builds a type: scale document (native YAML notes list) to SVG", () => {
    const doc = parseDocument("type: scale\nnotes:\n  - { string: 6, fret: 3, label: R }\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">R<");
  });

  it("builds a type: scale document with brackets", () => {
    const doc = parseDocument('type: scale\nnotes: "6:5;1:8"\nbrackets:\n  - { startFret: 5, endFret: 7, label: Box 1 }\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain('class="chord-chart"');
    expect(svg).toContain(">Box 1</text>");
  });

  it("rejects malformed brackets in a type: scale document at parse time", () => {
    expect(() => parseDocument('type: scale\nnotes: "6:3"\nbrackets: "3-1:x"\n')).toThrow(ChartInputError);
  });

  it("builds a type: neck document with compact brackets", () => {
    const doc = parseDocument('type: neck\nnotes: "6:3"\nbrackets: "0-3:E shape;2-5:D shape"\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">E shape</text>");
    expect(svg).toContain(">D shape</text>");
  });

  it("builds a type: neck document with a native YAML brackets list", () => {
    const doc = parseDocument(
      'type: neck\nnotes: "6:3"\nbrackets:\n  - { startFret: 2, endFret: 5, label: C shape, className: caged-c }\n',
    );
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain("chord-bracket chord-bracket-level-0 caged-c");
  });

  it("rejects malformed brackets at parse time", () => {
    expect(() => parseDocument('type: neck\nnotes: "6:3"\nbrackets: "5-2:x"\n')).toThrow(ChartInputError);
  });

  it("builds a type: neck document to SVG", () => {
    const doc = parseDocument("type: neck\nnotes: \"6:7:R\"\nfirstFret: 5\nlastFret: 17\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain('class="neck-diagram"');
    expect(svg).toContain("chord-neck-fret-label");
    expect(svg).toContain(">R<");
  });

  it("a type: chord document's noteShapes shapes the targeted string's dot", () => {
    const doc = parseDocument('type: chord\nnotation: "320003"\nnoteShapes: \'{"6":"square"}\'\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("a type: scale document's marker shape (native YAML list) shapes its dot", () => {
    const doc = parseDocument("type: scale\nnotes:\n  - { string: 6, fret: 3, shape: square }\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("a type: neck document's marker shape (compact notation) shapes its dot", () => {
    const doc = parseDocument("type: neck\nnotes: \"6:3:R:root:2:triangle\"\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toMatch(/<polygon class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-triangle"/);
  });

  it("supports the diamond shape", () => {
    const doc = parseDocument('type: chord\nnotation: "320003"\nnoteShapes: \'{"6":"diamond"}\'\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-diamond"/);
  });

  it("a type: scale document's labelPitches auto-labels a fretted marker with no explicit label", () => {
    const doc = parseDocument("type: scale\nnotes: \"6:3\"\nlabelPitches: true\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">G<"); // string 6 fret 3, standard tuning
  });

  it("a type: neck document's labelPitches auto-labels a fretted marker with no explicit label", () => {
    const doc = parseDocument("type: neck\nnotes: \"6:3\"\nlabelPitches: true\n");
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">G<"); // string 6 fret 3, standard tuning
  });

  it("a type: scale document's fret-number labels are on by default and omitted when labelFrets: false", () => {
    const withDefault = buildDocument(parseDocument('type: scale\nnotes: "6:3"\n'), "/tmp");
    expect(withDefault.svg).toContain("chord-fret-label");

    const withOff = buildDocument(parseDocument("type: scale\nnotes: \"6:3\"\nlabelFrets: false\n"), "/tmp");
    expect(withOff.svg).not.toContain("chord-fret-label");
  });

  it("a type: neck document's fret-number labels are on by default (standard inlay frets, including the nut) and omitted when labelFrets: false", () => {
    const withDefault = buildDocument(parseDocument('type: neck\nnotes: "6:3"\n'), "/tmp");
    expect(withDefault.svg).toContain('chord-neck-fret-label-0"'); // firstFret itself
    expect(withDefault.svg).toContain('chord-neck-fret-label-12"'); // a standard inlay fret

    const withOff = buildDocument(parseDocument("type: neck\nnotes: \"6:3\"\nlabelFrets: false\n"), "/tmp");
    expect(withOff.svg).not.toContain("chord-neck-fret-label");
  });

  it("builds a type: chords document (inline csv) to a composite SVG", () => {
    const doc = parseDocument("type: chords\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n");
    const { svg } = buildDocument(doc, "/tmp");
    const nested = (svg.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
    expect(nested).toBe(2);
  });

  it("surfaces the document's output field without writing it", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\noutput: "chart.png"\n');
    const { output } = buildDocument(doc, "/tmp");
    expect(output).toBe("chart.png");
  });

  it("resolves stylesheetFile relative to basePath, not CWD", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "document-test-"));
    try {
      fs.writeFileSync(path.join(dir, "theme.css"), ".chord-dot { fill: red; }");
      const doc = parseDocument('type: chord\nnotation: "x02220"\nstylesheetFile: "theme.css"\n');
      const { svg } = buildDocument(doc, dir);
      expect(svg).toContain(".chord-dot { fill: red; }");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws DocumentError for a stylesheetFile that can't be read", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\nstylesheetFile: "nope.css"\n');
    expect(() => buildDocument(doc, "/tmp")).toThrow(DocumentError);
  });

  it("embeds an inline defs into the rendered SVG as a <defs> element", () => {
    const doc = parseDocument(
      'type: chord\nnotation: "x02220"\ndefs: "<linearGradient id=\\"g\\" />"\n',
    );
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain('<defs><linearGradient id="g" /></defs>');
  });

  it("resolves defsFile relative to basePath, not CWD", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "document-test-"));
    try {
      fs.writeFileSync(path.join(dir, "gradient.svg"), '<linearGradient id="g" />');
      const doc = parseDocument('type: chord\nnotation: "x02220"\ndefsFile: "gradient.svg"\n');
      const { svg } = buildDocument(doc, dir);
      expect(svg).toContain('<defs><linearGradient id="g" /></defs>');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws DocumentError for a defsFile that can't be read", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\ndefsFile: "nope.svg"\n');
    expect(() => buildDocument(doc, "/tmp")).toThrow(DocumentError);
  });

  it("embeds a chords document's top-level defs into every row's chart SVG", () => {
    const doc = parseDocument(
      'type: chords\ncsv: |\n  notes\n  x02220\ndefs: "<linearGradient id=\\"g\\" />"\n',
    );
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain('<defs><linearGradient id="g" /></defs>');
  });

  it("applies a type: chord document's transpose field at render time", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\ntranspose: 2\n');
    const { svg } = buildDocument(doc, "/tmp");
    // A major -> B major shape: no open strings left on string 5 or string 1.
    expect(svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    expect(svg).not.toMatch(/chord-glyph-open chord-glyph-string-1/);
  });

  it("applies a type: scale document's transpose field, reflected in the resolved marker frets", () => {
    const doc = parseDocument('type: scale\nnotes: "6:3"\ntranspose: 2\nlabelPitches: true\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">A<"); // string 6 fret 3 (no explicit label; computed G) transposed +2 -> A
  });

  it("applies a type: neck document's transpose field to both notes and an explicit firstFret/lastFret window", () => {
    const doc = parseDocument("type: neck\nnotes: \"6:7:R\"\nfirstFret: 5\nlastFret: 17\ntranspose: 3\n");
    const { svg, warnings } = buildDocument(doc, "/tmp");
    expect(svg).toContain("<svg");
    expect(warnings).toEqual([]); // the window moved with the note -- no auto-expand needed
  });

  it("applies a type: chords document's transpose field to every row", () => {
    const doc = parseDocument('type: chords\ncsv: |\n  notes\n  x02220\ntranspose: 2\n');
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
  });

  it("propagates ChartInputError when a document's transpose would put a note below the nut", () => {
    const doc = parseDocument('type: chord\nnotation: "x02220"\ntranspose: -3\n');
    expect(() => buildDocument(doc, "/tmp")).toThrow(ChartInputError);
  });

  it("surfaces a type: neck document's fret-range auto-expansion as a warning", () => {
    const doc = parseDocument("type: neck\nnotes: \"6:3;5:20\"\nfirstFret: 0\nlastFret: 12\n");
    const { warnings } = buildDocument(doc, "/tmp");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/\[0, 12\]/);
    expect(warnings[0]).toMatch(/\[0, 20\]/);
  });

  it("returns no warnings for a type: neck document whose notes already fit, or for any other document type", () => {
    expect(buildDocument(parseDocument('type: chord\nnotation: "x02220"\n'), "/tmp").warnings).toEqual([]);
    expect(buildDocument(parseDocument('type: scale\nnotes: "6:3"\n'), "/tmp").warnings).toEqual([]);
    expect(
      buildDocument(parseDocument("type: neck\nnotes: \"6:3\"\nfirstFret: 0\nlastFret: 12\n"), "/tmp").warnings,
    ).toEqual([]);
  });

  it("resolves csvFile relative to basePath, not CWD", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "document-test-"));
    try {
      fs.writeFileSync(path.join(dir, "chords.csv"), "notes,label\nx02220,A\n");
      const doc = parseDocument("type: chords\ncsvFile: chords.csv\n");
      const { svg } = buildDocument(doc, dir);
      expect(svg).toContain(">A<");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws DocumentError for a csvFile that can't be read", () => {
    const doc = parseDocument("type: chords\ncsvFile: nope.csv\n");
    expect(() => buildDocument(doc, "/tmp")).toThrow(DocumentError);
  });

  it("round-trips a multi-line inline csv block scalar correctly", () => {
    const doc = parseDocument(
      "type: chords\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n  xx0232,D\n",
    );
    const { svg } = buildDocument(doc, "/tmp");
    const nested = (svg.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
    expect(nested).toBe(3);
  });

  it("throws DocumentError for a chords document whose CSV has a 'stylesheet' column", () => {
    const doc = parseDocument("type: chords\ncsv: |\n  notes,stylesheet\n  x02220,/etc/passwd\n");
    expect(() => buildDocument(doc, "/tmp")).toThrow(DocumentError);
  });

  it("applies collectionLabel/columns/defaults for a chords document", () => {
    const doc = parseDocument(
      "type: chords\ncolumns: 2\ncollectionLabel: My Chords\ndefaults:\n  root: \"5\"\ncsv: |\n  notes\n  x02220\n",
    );
    const { svg } = buildDocument(doc, "/tmp");
    expect(svg).toContain(">My Chords<");
    expect(svg).toContain("root");
  });

  it("propagates ChordParseError for invalid chord notation", () => {
    const doc = parseDocument("type: chord\nnotation: qqqqqq\n");
    expect(() => buildDocument(doc, "/tmp")).toThrow(ChordParseError);
  });

  it("propagates LayoutError for an invalid neck fret range", () => {
    const doc = parseDocument('type: neck\nnotes: "6:3"\nfirstFret: 10\nlastFret: 5\n');
    expect(() => buildDocument(doc, "/tmp")).toThrow(LayoutError);
  });
});

describe("runDocument", () => {
  let cap: { stderr: string };
  const tmpFiles: string[] = [];

  beforeEach(() => {
    cap = { stderr: "" };
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      cap.stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const f of tmpFiles.splice(0)) {
      try {
        fs.rmSync(f, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  function writeTmp(name: string, content: string): string {
    const p = tmpPath(name);
    fs.writeFileSync(p, content, "utf8");
    tmpFiles.push(p);
    return p;
  }

  it("renders a document end to end, writing SVG to the given output path", async () => {
    const docPath = writeTmp("chart.yaml", 'type: chord\nnotation: "x02220"\n');
    const outPath = tmpPath("out.svg");
    tmpFiles.push(outPath);
    const code = await runDocument({ documentPath: docPath, output: outPath });
    expect(code).toBe(0);
    expect(fs.readFileSync(outPath, "utf8")).toContain("<svg");
  });

  it("prints a type: neck document's fret-range auto-expansion warning to stderr", async () => {
    const docPath = writeTmp("neck.yaml", 'type: neck\nnotes: "6:3;5:20"\nfirstFret: 0\nlastFret: 12\n');
    const outPath = tmpPath("out.svg");
    tmpFiles.push(outPath);
    const code = await runDocument({ documentPath: docPath, output: outPath });
    expect(code).toBe(0);
    expect(cap.stderr).toContain("warning:");
    expect(cap.stderr).toContain("[0, 20]");
  });

  describe("bakeTranspose", () => {
    it("bakes a chord document's transpose into notation, dropping the transpose: field", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const outPath = tmpPath("baked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("notation: x 2 4 4 4 2");
      expect(text).not.toContain("transpose");
    });

    it("bakes a scale document's transpose into its markers, preserving the compact-string notes format", async () => {
      const docPath = writeTmp("scale.yaml", 'type: scale\nnotes: "6:3:R"\ntranspose: 2\n');
      const outPath = tmpPath("baked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("notes: 6:5:R");
      expect(text).not.toContain("transpose");
    });

    it("bakes a scale document's transpose into its markers, preserving the native-list notes format", async () => {
      const docPath = writeTmp(
        "scale.yaml",
        "type: scale\nnotes:\n  - { string: 6, fret: 3, label: R }\ntranspose: 2\n",
      );
      const outPath = tmpPath("baked.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed.notes).toEqual([{ string: 6, fret: 5, label: "R" }]);
      expect(parsed.transpose).toBeUndefined();
    });

    it("bakes a neck document's transpose into its markers and shifts an explicit firstFret/lastFret window", async () => {
      const docPath = writeTmp(
        "neck.yaml",
        'type: neck\nnotes: "6:7:R"\nfirstFret: 5\nlastFret: 17\ntranspose: 3\n',
      );
      const outPath = tmpPath("baked.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed.notes).toBe("6:10:R");
      expect(parsed.firstFret).toBe(8);
      expect(parsed.lastFret).toBe(20);
      expect(parsed.transpose).toBeUndefined();
    });

    it("bakes a type: chords document's inline csv notes column, dropping the transpose: field", async () => {
      const docPath = writeTmp("chords.yaml", "type: chords\ncsv: |\n  notes\n  x02220\ntranspose: 2\n");
      const outPath = tmpPath("baked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("x 2 4 4 4 2");
      expect(text).not.toContain("x02220");
      expect(text).not.toContain("transpose");
    });

    it("has no effect on a type: chords document referencing an external csvFile -- transpose: is kept, no file is touched", async () => {
      const docPath = writeTmp("chords.yaml", "type: chords\ncsvFile: ./chords.csv\ntranspose: 2\n");
      const outPath = tmpPath("baked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("csvFile: ./chords.csv");
      expect(text).toContain("transpose: 2");
    });

    it("is a no-op when the document has no transpose: field", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\n');
      const outPath = tmpPath("unbaked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("notation: x02220");
      expect(text).not.toContain("transpose");
    });

    it("has no effect on a render (bakeTranspose only matters for a reformat-write)", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const svgPath = tmpPath("out.svg");
      tmpFiles.push(svgPath);
      const code = await runDocument({ documentPath: docPath, output: svgPath, bakeTranspose: true });
      expect(code).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("an explicit options.transpose is baked instead of the document's own transpose: field", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const outPath = tmpPath("baked.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({
        documentPath: docPath,
        output: outPath,
        transpose: 1,
        bakeTranspose: true,
      });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("notation: x 1 3 3 3 1");
      expect(text).not.toContain("transpose");
    });

    it("exits 1 cleanly when baking would put a note below the nut", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\ntranspose: -3\n');
      const outPath = tmpPath("bad.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath, bakeTranspose: true });
      expect(code).toBe(1);
      expect(fs.existsSync(outPath)).toBe(false);
    });
  });

  it("uses the document's own output: field when --output isn't given", async () => {
    const outPath = tmpPath("doc-output.svg");
    tmpFiles.push(outPath);
    const docPath = writeTmp("chart.yaml", `type: chord\nnotation: "x02220"\noutput: "${outPath.replace(/\\/g, "\\\\")}"\n`);
    const code = await runDocument({ documentPath: docPath });
    expect(code).toBe(0);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("an explicit output option overrides the document's own output: field", async () => {
    const docOwnPath = tmpPath("doc-own.svg");
    const overridePath = tmpPath("override.svg");
    tmpFiles.push(docOwnPath, overridePath);
    const docPath = writeTmp(
      "chart.yaml",
      `type: chord\nnotation: "x02220"\noutput: "${docOwnPath.replace(/\\/g, "\\\\")}"\n`,
    );
    const code = await runDocument({ documentPath: docPath, output: overridePath });
    expect(code).toBe(0);
    expect(fs.existsSync(overridePath)).toBe(true);
    expect(fs.existsSync(docOwnPath)).toBe(false);
  });

  it("resolves relative stylesheetFile/csvFile against the document's own directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "document-test-"));
    tmpFiles.push(dir);
    fs.writeFileSync(path.join(dir, "chords.csv"), "notes,label\nx02220,A\n");
    const docPath = path.join(dir, "doc.yaml");
    fs.writeFileSync(docPath, "type: chords\ncsvFile: chords.csv\n");
    const outPath = tmpPath("relative-out.svg");
    tmpFiles.push(outPath);
    const code = await runDocument({ documentPath: docPath, output: outPath });
    expect(code).toBe(0);
    expect(fs.readFileSync(outPath, "utf8")).toContain(">A<");
  });

  it("exits 1 cleanly for a nonexistent document file", async () => {
    const code = await runDocument({ documentPath: tmpPath("does-not-exist.yaml") });
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("exits 1 cleanly for malformed YAML", async () => {
    const docPath = writeTmp("bad.yaml", "type: chord\n  bad: [unclosed\n");
    const code = await runDocument({ documentPath: docPath });
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("exits 1 cleanly for a propagated ChordParseError", async () => {
    const docPath = writeTmp("bad-chord.yaml", "type: chord\nnotation: qqqqqq\n");
    const code = await runDocument({ documentPath: docPath });
    expect(code).toBe(1);
    expect(cap.stderr).toMatch(/q/);
  });

  describe("--output .yaml/.yml/.json (reformat/convert instead of rendering)", () => {
    it("re-serializes a document to YAML for a .yaml output path", async () => {
      const docPath = writeTmp("chord.json", '{"type":"chord","notation":"x02220","label":"A"}');
      const outPath = tmpPath("chord.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(0);
      const text = fs.readFileSync(outPath, "utf8");
      expect(text).toContain("type: chord");
      expect(text).toContain("notation: x02220");
      expect(text).toContain("label: A");
    });

    it("re-serializes a document to genuine JSON for a .json output path", async () => {
      const docPath = writeTmp("chord.yaml", 'type: chord\nnotation: "x02220"\nlabel: A\n');
      const outPath = tmpPath("chord.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed).toEqual({ type: "chord", notation: "x02220", label: "A" });
    });

    it("leaves stylesheetFile/defsFile/csvFile references as-is, not resolved/embedded", async () => {
      const docPath = writeTmp(
        "scale.yaml",
        'type: scale\nnotes: "6:3:R"\nstylesheetFile: ./theme.css\ndefsFile: ./gradient.svg\n',
      );
      const outPath = tmpPath("scale.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed.stylesheetFile).toBe("./theme.css");
      expect(parsed.stylesheet).toBeUndefined();
      expect(parsed.defsFile).toBe("./gradient.svg");
      expect(parsed.defs).toBeUndefined();
    });

    it("still validates document structure before writing (missing type field), without writing a file", async () => {
      const docPath = writeTmp("bad-structure.yaml", "notation: x02220\n");
      const outPath = tmpPath("bad-structure.yaml.out.yaml");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(1);
      expect(fs.existsSync(outPath)).toBe(false);
    });

    it("does not require stylesheetFile/csvFile to actually exist, unlike an actual render", async () => {
      // A reformat is purely structural (parseDocument only) -- it never
      // touches buildDocument, which is what would otherwise need
      // stylesheetFile/csvFile to resolve on disk.
      const docPath = writeTmp("neck.yaml", 'type: neck\nnotes: "6:3:R"\nstylesheetFile: ./does-not-exist.css\n');
      const outPath = tmpPath("neck-reformatted.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed.stylesheetFile).toBe("./does-not-exist.css");
    });

    it("a reformat does not validate full chord-parseability (that's buildDocument's job, skipped here)", async () => {
      // "qqqqqq" is structurally a valid `notation` string field -- only
      // buildChart (inside buildDocument) would reject it as unparseable
      // notation, and reformat mode intentionally skips that step.
      const docPath = writeTmp("bad-chord.yaml", "type: chord\nnotation: qqqqqq\n");
      const outPath = tmpPath("bad-chord-reformatted.json");
      tmpFiles.push(outPath);
      const code = await runDocument({ documentPath: docPath, output: outPath });
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
      expect(parsed.notation).toBe("qqqqqq");
    });
  });
});
