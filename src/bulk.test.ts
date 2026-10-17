import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildBulkGrid, buildBulkSvg, transposeCsvNotes } from "./bulk";
import { ChartInputError } from "./chartFieldResolver";
import type { RawChartFields } from "./chartFieldResolver";

describe("buildBulkSvg", () => {
  it("renders one chart per CSV row into a single composite SVG", () => {
    const csv = "notes,label\nx02220,A\n320003,G\n";
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg.startsWith("<svg")).toBe(true);
    // Two nested <svg> charts inside the outer one.
    const nested = svg.match(/<svg[^>]*class="chord-chart"/g) ?? [];
    expect(nested).toHaveLength(2);
    expect(svg).toContain(">A<");
    expect(svg).toContain(">G<");
  });

  it("requires a 'notes' column", () => {
    const csv = "label\nA\n";
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(ChartInputError);
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/notes/);
  });

  it("requires at least one data row", () => {
    const csv = "notes,label\n";
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(ChartInputError);
  });

  it("wraps a CSV syntax error (e.g. an unescaped quote) in a ChartInputError with an actionable message", () => {
    // A common mistake: pasting raw JSON like {"6":"R"} into a
    // string-labels cell without CSV-quoting it -- csv-parse throws its
    // own CsvError, which this must not let escape uncaught (the HTTP
    // layer only maps ChartInputError et al. to a clean 400; anything else
    // becomes an opaque 500).
    const csv = 'notes,label,string-labels\nx02220,A,{"6":"R"}\n';
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(ChartInputError);
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/CSV parse error/);
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/wrap the whole field in quotes/);
  });

  it("accepts a properly CSV-quoted field containing JSON (doubled internal quotes)", () => {
    // String 4 is fretted (not muted/open) in x02220, so its label actually
    // renders -- string-labels only labels a dot, not a muted/open glyph.
    const csv = 'notes,label,string-labels\nx02220,A,"{""4"":""R""}"\n';
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(">R<");
  });

  it("errors with the row number when a row's notes cell is empty", () => {
    const csv = "notes,label\nx02220,A\n,G\n";
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/row 3/);
  });

  it("errors with the row number when a row's chord notation is invalid", () => {
    const csv = "notes\nx02220\nqqqqqq\n";
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/row 3/);
  });

  it("CSV cell values win over CLI-level defaults", () => {
    const csv = "notes,label\nx02220,Row Label\n";
    const svg = buildBulkSvg(csv, { label: "Default Label" }, 4);
    expect(svg).toContain(">Row Label<");
    expect(svg).not.toContain(">Default Label<");
  });

  it("CLI-level defaults apply to a row that leaves the column blank or omits it", () => {
    const csv = "notes,label\nx02220,\n320003,Explicit\n";
    const svg = buildBulkSvg(csv, { label: "Default Label" }, 4);
    expect(svg).toContain(">Default Label<");
    expect(svg).toContain(">Explicit<");
  });

  it("supports every documented column heading", () => {
    const csv = [
      "notes,label,string-labels,finger-positions,note-classes,root,tuning,label-pitches,label-tuning",
      '320003,G,"{""6"":""R""}",3xxxxx,,,"",false,false',
    ].join("\n");
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain(">G<");
    expect(svg).toContain(">R<"); // string-labels
    expect(svg).toContain("chord-finger-label"); // finger-positions
  });

  it("supports per-string string-label-N/finger-position-N column headings", () => {
    const csv = ["notes,label,string-label-6,finger-position-1", "320003,G,R,3"].join("\n");
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain(">R<");
    expect(svg).toContain("chord-finger-label-string-1");
  });

  it("a per-string column wins over a same-numbered entry in an aggregate column", () => {
    const csv = ['notes,string-labels,string-label-6', '320003,"{""6"":""aggregate""}",override'].join("\n");
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain(">override<");
    expect(svg).not.toContain(">aggregate<");
  });

  it("a per-string column value applies as a default when the row's own cell is blank", () => {
    const csv = "notes,string-label-6\n320003,\n";
    const svg = buildBulkSvg(csv, { stringLabel6: "R" }, 4);
    expect(svg).toContain(">R<");
  });

  it("root column expands to the root note class", () => {
    const csv = 'notes,root\n320003,"6"\n';
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain('class="chord-dot chord-dot-string-6 root chord-dot-shape-circle"');
  });

  it("note-shapes column sets a per-string dot shape", () => {
    const csv = ["notes,note-shapes", '320003,"{""6"":""square""}"'].join("\n");
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("a note-shapes default applies when the row's own cell is blank", () => {
    const csv = "notes,note-shapes\n320003,\n";
    const svg = buildBulkSvg(csv, { noteShapes: '{"6":"triangle"}' }, 4);
    expect(svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-triangle"/);
  });

  it("note-shapes column supports diamond", () => {
    const csv = ["notes,note-shapes", '320003,"{""6"":""diamond""}"'].join("\n");
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-diamond"/);
  });

  it("boolean columns accept true/false", () => {
    const csv = "notes,label-pitches\n320003,true\n";
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain("chord-dot-label");
  });

  it("boolean columns reject an invalid value with a row-numbered error", () => {
    const csv = "notes,label-pitches\n320003,maybe\n";
    expect(() => buildBulkSvg(csv, {}, 4)).toThrow(/row 2/);
  });

  it("tuning column overrides the default tuning per row", () => {
    const csv = "notes,tuning,label-pitches\n0xxxxx,DADGBE,true\n";
    const svg = buildBulkSvg(csv, {}, 4);
    // Open D string gets no dot label at all (open strings never do), but
    // confirm no crash and the chart rendered.
    expect(svg).toContain("<svg");
  });

  it("arranges charts left-to-right, wrapping after `columns` per row", () => {
    const csv = "notes\nx02220\n320003\nxxxxxx\n022100\n";
    // 4 charts, 2 per row -> 2 rows.
    const svg = buildBulkSvg(csv, {}, 2);
    const xs = [...svg.matchAll(/<svg x="([-\d.]+)" y="([-\d.]+)" xmlns="[^"]*" class="chord-chart"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(xs).toHaveLength(4);
    // First row: same y, increasing x. Second row: same (larger) y.
    expect(xs[0].y).toBe(xs[1].y);
    expect(xs[0].x).toBeLessThan(xs[1].x);
    expect(xs[2].y).toBeGreaterThan(xs[0].y);
    expect(xs[2].x).toBe(xs[0].x); // left-aligned: wraps back to the same x
    expect(xs[3].x).toBe(xs[1].x);
  });

  it("rejects a non-positive columns value", () => {
    const csv = "notes\nx02220\n";
    expect(() => buildBulkSvg(csv, {}, 0)).toThrow(ChartInputError);
    expect(() => buildBulkSvg(csv, {}, -1)).toThrow(ChartInputError);
  });

  it("ignores unrecognized column headings instead of erroring", () => {
    const csv = "notes,song,comment\nx02220,Some Song,a note to self\n";
    expect(() => buildBulkSvg(csv, {}, 4)).not.toThrow();
  });

  it("a single row still renders (no crash on a 1-chart grid)", () => {
    const csv = "notes\nx02220\n";
    const svg = buildBulkSvg(csv, {}, 4);
    expect(svg).toContain("<svg");
  });

  it("defaults object type-checks as RawChartFields (label default flows through)", () => {
    const defaults: RawChartFields = { label: "Default" };
    const csv = "notes\nx02220\n";
    const svg = buildBulkSvg(csv, defaults, 4);
    expect(svg).toContain(">Default<");
  });

  describe("collectionLabel", () => {
    it("renders a title above the grid when given", () => {
      const csv = "notes\nx02220\n320003\n";
      const svg = buildBulkSvg(csv, {}, 4, "My Collection");
      expect(svg).toContain('class="chord-collection-label"');
      expect(svg).toMatch(/<text class="chord-collection-label"[^>]*>My Collection<\/text>/);
    });

    it("grows the total height to make room for the label and shifts every chart down", () => {
      const csv = "notes\nx02220\n320003\n";
      const svgWithout = buildBulkSvg(csv, {}, 4);
      const svgWith = buildBulkSvg(csv, {}, 4, "Title");

      const heightWithout = Number(/^<svg[^>]*height="([\d.]+)"/.exec(svgWithout)?.[1]);
      const heightWith = Number(/^<svg[^>]*height="([\d.]+)"/.exec(svgWith)?.[1]);
      expect(heightWith).toBeGreaterThan(heightWithout);

      // Every chart's y offset increases by exactly the added height.
      const ysWithout = [...svgWithout.matchAll(/<svg x="[-\d.]+" y="([-\d.]+)"/g)].map((m) => Number(m[1]));
      const ysWith = [...svgWith.matchAll(/<svg x="[-\d.]+" y="([-\d.]+)"/g)].map((m) => Number(m[1]));
      const addedHeight = heightWith - heightWithout;
      expect(ysWith).toEqual(ysWithout.map((y) => y + addedHeight));
    });

    it("is centered horizontally over the full grid width", () => {
      const csv = "notes\nx02220\n320003\nxxxxxx\n022100\n";
      const svg = buildBulkSvg(csv, {}, 4, "Title");
      const width = Number(/^<svg[^>]*width="([\d.]+)"/.exec(svg)?.[1]);
      const labelX = Number(/<text class="chord-collection-label" x="([-\d.]+)"/.exec(svg)?.[1]);
      expect(labelX).toBe(width / 2);
    });

    it("is omitted entirely, with unchanged geometry, when not given", () => {
      const csv = "notes\nx02220\n";
      const svg = buildBulkSvg(csv, {}, 4);
      expect(svg).not.toContain("chord-collection-label");
    });

    it("XML-escapes special characters in the label", () => {
      const csv = "notes\nx02220\n";
      const svg = buildBulkSvg(csv, {}, 4, "A & <B>");
      expect(svg).toContain("A &amp; &lt;B&gt;");
    });
  });

  describe("header rows", () => {
    const chartPositions = (svg: string) =>
      [...svg.matchAll(/<svg x="([-\d.]+)" y="([-\d.]+)" xmlns="[^"]*" class="chord-chart"/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
    const sectionLabels = (svg: string) =>
      [...svg.matchAll(/<text class="chord-collection-section-label" x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(
        (m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }),
      );

    it("renders each header above its own section, starting a fresh grid row", () => {
      const csv = "header,notes,label\nOne,x02220,A\n,320003,G\nTwo,xx0232,D\n";
      const svg = buildBulkSvg(csv, {}, 4);
      const labels = sectionLabels(svg);
      expect(labels.map((l) => l.text)).toEqual(["One", "Two"]);
      const charts = chartPositions(svg);
      expect(charts).toHaveLength(3);
      // D starts a new row at the left, below both A/G and the "Two" heading.
      expect(charts[0].y).toBe(charts[1].y);
      expect(charts[2].x).toBe(0);
      expect(charts[2].y).toBeGreaterThan(labels[1].y);
      expect(labels[1].y).toBeGreaterThan(charts[0].y);
      expect(labels[0].y).toBeLessThan(charts[0].y);
    });

    it("accepts a heading-only row with blank notes", () => {
      const csv = "notes,header\n,First\nx02220,\n,Second\n320003,\n";
      const grid = buildBulkGrid(csv, {}, 4);
      expect(grid.sections.map((s) => [s.header, s.charts.length])).toEqual([
        ["First", 1],
        ["Second", 1],
      ]);
      expect(grid.charts).toHaveLength(2);
    });

    it("keeps charts before the first header in an untitled leading section", () => {
      const csv = "notes,header\nx02220,\n320003,Later\n";
      const grid = buildBulkGrid(csv, {}, 4);
      expect(grid.sections.map((s) => s.header)).toEqual([undefined, "Later"]);
    });

    it("centers headers over the full grid width, below the collection label", () => {
      const csv = "notes,header\nx02220,Short\nx02220,Wide\n320003,\nxx0232,\n";
      const svg = buildBulkSvg(csv, {}, 4, "Title");
      const width = Number(/^<svg[^>]*width="([\d.]+)"/.exec(svg)?.[1]);
      const titleY = Number(/<text class="chord-collection-label" x="[-\d.]+" y="([-\d.]+)"/.exec(svg)?.[1]);
      const labels = sectionLabels(svg);
      expect(labels.every((l) => l.x === width / 2)).toBe(true);
      expect(labels[0].y).toBeGreaterThan(titleY);
    });

    it("leaves the geometry unchanged when the header column is present but empty", () => {
      expect(buildBulkSvg("notes,header\nx02220,\n320003,\n", {}, 4)).toBe(buildBulkSvg("notes\nx02220\n320003\n", {}, 4));
    });

    it("XML-escapes header text", () => {
      const svg = buildBulkSvg("notes,header\nx02220,I & <IV>\n", {}, 4);
      expect(svg).toContain("I &amp; &lt;IV&gt;");
    });

    it("still errors on a row with neither notes nor a header", () => {
      expect(() => buildBulkSvg("notes,header\n,A\n,\n", {}, 4)).toThrow(/row 3/);
    });

    it("errors when the CSV has headers but no charts", () => {
      expect(() => buildBulkSvg("notes,header\n,A\n", {}, 4)).toThrow(/only headers/);
    });
  });

  describe("background", () => {
    it("includes a full-canvas background rect, transparent by default, covering the whole composite (including gutters)", () => {
      const csv = "notes\nx02220\n320003\nxxxxxx\n022100\n";
      const svg = buildBulkSvg(csv, {}, 2);
      const widthMatch = /^<svg[^>]*width="([\d.]+)"/.exec(svg);
      const heightMatch = /^<svg[^>]*height="([\d.]+)"/.exec(svg);
      const rectMatch = /<rect class="chord-collection-background"[^>]*\/>/.exec(svg);
      expect(rectMatch).not.toBeNull();

      const rect = rectMatch![0];
      expect(/x="([\d.]+)"/.exec(rect)?.[1]).toBe("0");
      expect(/y="([\d.]+)"/.exec(rect)?.[1]).toBe("0");
      expect(/width="([\d.]+)"/.exec(rect)?.[1]).toBe(widthMatch![1]);
      expect(/height="([\d.]+)"/.exec(rect)?.[1]).toBe(heightMatch![1]);
      expect(/fill="([^"]+)"/.exec(rect)?.[1]).toBe("none");

      // Sits behind everything, including the collection label.
      expect(svg.indexOf('class="chord-collection-background"')).toBeLessThan(
        svg.indexOf("<svg x="),
      );
    });

    it("is distinct from each individual chart's own chord-chart-background", () => {
      const csv = "notes\nx02220\n320003\n";
      const svg = buildBulkSvg(csv, {}, 4);
      const outer = svg.match(/class="chord-collection-background"/g) ?? [];
      const perChart = svg.match(/class="chord-chart-background"/g) ?? [];
      expect(outer).toHaveLength(1);
      expect(perChart).toHaveLength(2); // one per chart
    });
  });

  describe("inlineStylesheet", () => {
    it("is embedded into every row that has no stylesheetPath of its own", () => {
      const css = ".chord-dot { fill: red; }";
      const csv = "notes\nx02220\n320003\n";
      const svg = buildBulkSvg(csv, {}, 4, undefined, css);
      const embedded = svg.match(new RegExp(css.replace(/[.[\]]/g, "\\$&"), "g")) ?? [];
      expect(embedded).toHaveLength(2); // one <style> per chart
    });

    it("is a no-op when omitted (unchanged behavior, no file I/O attempted)", () => {
      const csv = "notes\nx02220\n";
      expect(() => buildBulkSvg(csv, {}, 4)).not.toThrow();
      const svg = buildBulkSvg(csv, {}, 4);
      expect(svg).not.toContain("<style>");
    });

    it("never causes a file read: a row/defaults with no stylesheetPath falls back to inlineStylesheet without touching the filesystem", () => {
      // No stylesheetPath anywhere in defaults or the CSV -- if this somehow
      // attempted fs.readFileSync(undefined, ...) it would throw a TypeError,
      // not silently succeed, so a clean render proves no file I/O happened.
      const css = ".root { fill: blue; }";
      const csv = "notes\nx02220\n";
      expect(() => buildBulkSvg(csv, {}, 4, undefined, css)).not.toThrow();
    });

    it("does not leak into a row that DOES specify its own stylesheetPath (file wins over inline default)", () => {
      const fileCss = ".chord-dot { fill: green; }";
      const cssPath = path.join(os.tmpdir(), `bulk-inline-test-${Date.now()}.css`);
      fs.writeFileSync(cssPath, fileCss);
      try {
        const inlineCss = ".chord-dot { fill: red; }";
        const csv = "notes\nx02220\n";
        const svg = buildBulkSvg(csv, { stylesheetPath: cssPath }, 4, undefined, inlineCss);
        expect(svg).toContain(fileCss);
        expect(svg).not.toContain(inlineCss);
      } finally {
        fs.rmSync(cssPath, { force: true });
      }
    });
  });

  describe("defs", () => {
    it("defaults.defsText is embedded as a <defs> element into every row", () => {
      const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
      const csv = "notes\nx02220\n320003\n";
      const svg = buildBulkSvg(csv, { defsText: defs }, 4);
      const embedded = svg.match(new RegExp("<defs>" + defs.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&") + "</defs>", "g")) ?? [];
      expect(embedded).toHaveLength(2); // one <defs> per chart
    });

    it("is a no-op when omitted (unchanged behavior, no file I/O attempted)", () => {
      const csv = "notes\nx02220\n";
      expect(() => buildBulkSvg(csv, {}, 4)).not.toThrow();
      const svg = buildBulkSvg(csv, {}, 4);
      expect(svg).not.toContain("<defs>");
    });

    it("defaults.defsPath reads the file and embeds its content, winning over defsText", () => {
      const fileDefs = '<linearGradient id="file" />';
      const defsPath = path.join(os.tmpdir(), `bulk-defs-test-${Date.now()}.svg`);
      fs.writeFileSync(defsPath, fileDefs);
      try {
        const csv = "notes\nx02220\n";
        const svg = buildBulkSvg(csv, { defsPath, defsText: "<x/>" }, 4);
        expect(svg).toContain("<defs>" + fileDefs + "</defs>");
        expect(svg).not.toContain("<x/>");
      } finally {
        fs.rmSync(defsPath, { force: true });
      }
    });
  });

  describe("transpose", () => {
    it("shifts every row's chord notation by the same amount", () => {
      const csv = "notes\nx02220\n320003\n";
      const svg = buildBulkSvg(csv, {}, 4, undefined, undefined, 2);
      // x02220 (A major) +2 -> B major shape: no open strings left on 5/4/3/1.
      expect(svg).toContain('class="chord-dot chord-dot-string-5 chord-dot-shape-circle"');
      expect(svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("is a no-op when omitted", () => {
      const csv = "notes\nx02220\n";
      const svg = buildBulkSvg(csv, {}, 4);
      expect(svg).toContain('class="chord-glyph chord-glyph-open chord-glyph-string-5"');
    });

    it("propagates a row-numbered ChartInputError when the shift would put a note below the nut", () => {
      const csv = "notes\nx02220\n";
      expect(() => buildBulkSvg(csv, {}, 4, undefined, undefined, -3)).toThrow(/row 2/);
    });
  });
});

describe("transposeCsvNotes", () => {
  it("rewrites the notes column, transposing each row, and leaves every other column untouched", () => {
    const csv = "notes,label\nx02220,A\n320003,G\n";
    const out = transposeCsvNotes(csv, {}, 2);
    expect(out).toBe("notes,label\nx 2 4 4 4 2,A\n5 4 2 2 2 5,G\n");
  });

  it("re-escapes an untouched column that needs quoting, without touching the transposed notes column", () => {
    const csv = 'notes,label\nx02220,"A, sort of"\n';
    const out = transposeCsvNotes(csv, {}, 2);
    expect(out).toBe('notes,label\nx 2 4 4 4 2,"A, sort of"\n');
  });

  it("resolves a row's own tuning column for two-digit-fret disambiguation, same as buildBulkSvg", () => {
    const csv = "notes,tuning\nxxx121010,DADGBE\n";
    const out = transposeCsvNotes(csv, {}, 1);
    expect(out).toBe("notes,tuning\nx x x 13 11 11,DADGBE\n");
  });

  it("falls back to a default's tuning when a row leaves the tuning column blank", () => {
    const csv = "notes,tuning\nxxx121010,\n";
    const out = transposeCsvNotes(csv, { tuning: "DADGBE" }, 1);
    expect(out).toBe("notes,tuning\nx x x 13 11 11,\n");
  });

  it("requires a 'notes' column", () => {
    const csv = "label\nA\n";
    expect(() => transposeCsvNotes(csv, {}, 2)).toThrow(ChartInputError);
  });

  it("requires at least one data row", () => {
    const csv = "notes\n";
    expect(() => transposeCsvNotes(csv, {}, 2)).toThrow(ChartInputError);
  });

  it("throws a row-numbered ChartInputError for a missing notation cell", () => {
    const csv = "notes,label\n,A\n";
    expect(() => transposeCsvNotes(csv, {}, 2)).toThrow(/row 2/);
  });

  it("throws a row-numbered ChartInputError when the shift would put a note below the nut", () => {
    const csv = "notes\n555555\nx02220\n";
    expect(() => transposeCsvNotes(csv, {}, -3)).toThrow(/row 3/);
  });

  it("passes heading-only rows through untouched", () => {
    const csv = "header,notes\nOne,\n,x02220\n";
    expect(transposeCsvNotes(csv, {}, 2)).toBe("header,notes\nOne,\n,x 2 4 4 4 2\n");
  });

  it("throws a row-numbered ChartInputError for invalid notation", () => {
    const csv = "notes\nqqqqqq\n";
    expect(() => transposeCsvNotes(csv, {}, 2)).toThrow(/row 2/);
  });
});
