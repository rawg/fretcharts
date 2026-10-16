import { describe, it, expect } from "vitest";
import { handleRequest } from "./index";

/**
 * Flattens handleRequest's result into a status code plus the success
 * data or `{ error }` -- the same shape these tests checked back when the
 * routes were HTTP endpoints, which keeps the assertions compact.
 */
function call(route: string, body?: unknown): { statusCode: number; json: any } {
  const result = handleRequest(route, body);
  return result.ok ? { statusCode: 200, json: result.data } : { statusCode: 400, json: { error: result.error } };
}

describe("handleRequest routing", () => {
  it("rejects an unknown route", () => {
    const { statusCode, json } = call("/nope", {});
    expect(statusCode).toBe(400);
    expect(json.error).toContain("/nope");
  });

  it("turns an unexpected exception into a generic error instead of throwing", () => {
    const { statusCode, json } = call("/chart", { notation: "x02220", get label() { throw new Error("boom"); } });
    expect(statusCode).toBe(400);
    expect(json.error).not.toContain("boom");
  });
});

describe("/chart", () => {
  it("renders a valid chord to SVG", () => {
    const { statusCode, json } = call("/chart", { notation: "x02220" });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain("<svg");
  });

  it("renders scale-chart brackets with notes", () => {
    const { statusCode, json } = call("/chart", { notes: "6:5;1:8", brackets: "5-7:Box 1" });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">Box 1</text>");
  });

  it("ignores a blank brackets string, even with notation", () => {
    const { statusCode } = call("/chart", { notation: "x02220", brackets: "" });
    expect(statusCode).toBe(200);
  });

  it("400s for brackets with notation, or wrong-typed/malformed brackets", () => {
    expect((call("/chart", { notation: "x02220", brackets: "1-2:x" })).statusCode).toBe(400);
    expect((call("/chart", { notes: "6:5", brackets: 3 })).statusCode).toBe(400);
    expect((call("/chart", { notes: "6:5", brackets: "7-5:x" })).statusCode).toBe(400);
  });

  it("400s when notation is missing", () => {
    const { statusCode, json } = call("/chart", {});
    expect(statusCode).toBe(400);
    expect(json.error).toContain("notation");
  });

  it("400s with a clean message for invalid chord notation", () => {
    const { statusCode, json } = call("/chart", { notation: "qqqqqq" });
    expect(statusCode).toBe(400);
    expect(json.error).toMatch(/q/);
    expect(json.error).not.toContain("at ChordParseError"); // no stack trace
  });

  it("passes through label, tuning, root, labelPitches, labelTuning", () => {
    const { statusCode, json } = call("/chart", {
      notation: "0xxxxx",
      label: "Drop D",
      tuning: "DADGBE",
      labelTuning: true,
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">Drop D<");
    expect(json.svg).toContain("chord-tuning-label");
  });

  it("expands root into a note-class on the rendered dot", () => {
    const { json } = call("/chart", { notation: "320003", root: "6" });
    expect(json.svg).toContain("root");
  });

  it("parses raw JSON text fields (stringLabels, fingerPositions, noteClasses)", () => {
    const { statusCode, json } = call("/chart", {
      notation: "320003",
      stringLabels: '{"6":"R"}',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">R<");
  });

  it("400s with a clean message for malformed stringLabels JSON", () => {
    const { statusCode, json } = call("/chart", {
      notation: "320003",
      stringLabels: "{not json",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toBeTruthy();
  });

  it("noteShapes shapes the targeted string's dot", () => {
    const { statusCode, json } = call("/chart", {
      notation: "320003",
      noteShapes: '{"6":"square"}',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("noteShapes supports diamond", () => {
    const { statusCode, json } = call("/chart", {
      notation: "320003",
      noteShapes: '{"6":"diamond"}',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-diamond"/);
  });

  it("400s with a clean message for an invalid noteShapes value", () => {
    const { statusCode, json } = call("/chart", {
      notation: "320003",
      noteShapes: '{"6":"hexagon"}',
    });
    expect(statusCode).toBe(400);
    expect(json.error).toBeTruthy();
  });

  it("embeds raw CSS text from `stylesheet` directly, with no file I/O involved", () => {
    const css = ".chord-dot { fill: red; }";
    const { json } = call("/chart", { notation: "320003", stylesheet: css });
    expect(json.svg).toContain(css);
  });

  it("embeds raw SVG markup from `defs` directly as a <defs> element, with no file I/O involved", () => {
    const defs = '<linearGradient id="g" />';
    const { json } = call("/chart", { notation: "320003", defs });
    expect(json.svg).toContain("<defs>" + defs + "</defs>");
  });

  it("transpose shifts the chord's fretted/open strings before rendering", () => {
    const { json } = call("/chart", { notation: "x02220", transpose: 2 });
    // A major -> B major shape: no open strings left on 5/1.
    expect(json.svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    expect(json.svg).not.toMatch(/chord-glyph-open chord-glyph-string-1/);
  });

  it("400s with a clean message when transpose is not a number", () => {
    const { statusCode, json } = call("/chart", { notation: "x02220", transpose: "two" });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("transpose");
  });

  it("400s with a clean message when transpose would put a note below the nut", () => {
    const { statusCode, json } = call("/chart", { notation: "x02220", transpose: -3 });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("nut");
  });

  it("400s a non-object body", () => {
    const { statusCode } = call("/chart", "just a string");
    expect(statusCode).toBe(400);
  });

  describe("scale-chart mode (notes)", () => {
    it("renders a scale chart from notes (JSON form) to SVG, with label/className/finger flowing through", () => {
      const { statusCode, json } = call("/chart", {
        notes: '[{"string":6,"fret":3,"label":"R","className":"root","finger":2}]',
      });
      expect(statusCode).toBe(200);
      expect(json.svg).toContain("<svg");
      expect(json.svg).toContain(">R<");
      expect(json.svg).toContain("root");
      expect(json.svg).toMatch(/chord-finger-label-string-6"[^>]*>2</);
    });

    it("renders a scale chart from notes (compact notation) to SVG", () => {
      const { statusCode, json } = call("/chart", { notes: "6:3:R:root:2" });
      expect(statusCode).toBe(200);
      expect(json.svg).toContain(">R<");
    });

    it("400s when both notation and notes are given", () => {
      const { statusCode, json } = call("/chart", {
        notation: "x02220",
        notes: "6:3",
      });
      expect(statusCode).toBe(400);
      expect(json.error).toContain("notes");
    });

    it("400s with a clean message for malformed notes text", () => {
      const { statusCode, json } = call("/chart", { notes: "banana" });
      expect(statusCode).toBe(400);
      expect(json.error).toBeTruthy();
    });

    it("applies mutedStrings, dropping any marker targeting the same string", () => {
      const { json } = call("/chart", { notes: "6:3;1:2", mutedStrings: "1" });
      expect(json.svg).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
    });

    it("400s with a clean message for an invalid mutedStrings value", () => {
      const { statusCode } = call("/chart", { notes: "6:3", mutedStrings: "7" });
      expect(statusCode).toBe(400);
    });

    it("passes through label, tuning, and labelTuning in notes mode", () => {
      const { json } = call("/chart", {
        notes: "6:3",
        label: "Scale",
        tuning: "DADGBE",
        labelTuning: true,
      });
      expect(json.svg).toContain(">Scale<");
      expect(json.svg).toContain("chord-tuning-label");
    });

    it("labelPitches auto-labels a fretted marker with no explicit label in notes mode", () => {
      const { json } = call("/chart", { notes: "6:3", labelPitches: true });
      expect(json.svg).toContain(">G<"); // string 6 fret 3, standard tuning
    });

    it("labelFrets is on by default and can be turned off in notes mode", () => {
      const withDefault = call("/chart", { notes: "6:3" });
      expect(withDefault.json.svg).toContain("chord-fret-label");

      const withOff = call("/chart", { notes: "6:3", labelFrets: false });
      expect(withOff.json.svg).not.toContain("chord-fret-label");
    });

    it("a marker's shape (compact notation's 6th field) flows through to its dot", () => {
      const { json } = call("/chart", { notes: "6:3:R:root:2:square" });
      expect(json.svg).toMatch(/<rect class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-square"/);
    });
  });
});

describe("/bulk", () => {
  it("renders a valid CSV to a composite SVG", () => {
    const { statusCode, json } = call("/bulk", {
      csv: "notes,label\nx02220,A\n320003,G\n",
    });
    expect(statusCode).toBe(200);
    const nested = (json.svg.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
    expect(nested).toBe(2);
  });

  it("also returns each chart on its own, with the grid's columns and label, for printing", () => {
    const { statusCode, json } = call("/bulk", {
      csv: "notes,label\nx02220,A\n320003,G\n",
      columns: 3,
      collectionLabel: "Open chords",
    });
    expect(statusCode).toBe(200);
    expect(json.grid.columns).toBe(3);
    expect(json.grid.collectionLabel).toBe("Open chords");
    expect(json.grid.charts).toHaveLength(2);
    expect(json.grid.charts[0]).toMatch(/^<svg[^>]*class="chord-chart"/);
    expect(json.grid.charts[0]).toContain(">A<");
    expect(json.grid.charts[1]).toContain(">G<");
  });

  it("400s when csv is missing", () => {
    const { statusCode, json } = call("/bulk", {});
    expect(statusCode).toBe(400);
    expect(json.error).toContain("csv");
  });

  it("400s and refuses to read a file when the CSV has a 'stylesheet' column", () => {
    const { statusCode, json } = call("/bulk", {
      csv: "notes,stylesheet\nx02220,/etc/passwd\n",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("stylesheet");
    expect(json.error).not.toContain("ENOENT"); // never actually attempted the read
  });

  it("400s when the row count exceeds the cap", () => {
    const rows = Array.from({ length: 201 }, () => "x02220").join("\n");
    const { statusCode, json } = call("/bulk", { csv: `notes\n${rows}\n` });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("too many rows");
  });

  it("applies the shared inline stylesheet to the whole grid", () => {
    const css = ".chord-collection-background { fill: white; }";
    const { json } = call("/bulk", {
      csv: "notes\nx02220\n",
      stylesheet: css,
    });
    expect(json.svg).toContain(css);
  });

  it("applies the shared inline `defs` to every chart in the grid", () => {
    const defs = '<linearGradient id="g" />';
    const { json } = call("/bulk", {
      csv: "notes\nx02220\n",
      defs,
    });
    expect(json.svg).toContain("<defs>" + defs + "</defs>");
  });

  it("transpose shifts every row's chord notation", () => {
    const { json } = call("/bulk", { csv: "notes\nx02220\n", transpose: 2 });
    expect(json.svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
  });

  it("400s with a clean, row-numbered message when transpose would put a note below the nut", () => {
    const { statusCode, json } = call("/bulk", { csv: "notes\nx02220\n", transpose: -3 });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("row 2");
  });

  it("applies `defaults` to rows that leave their column blank", () => {
    const { json } = call("/bulk", {
      csv: "notes\nx02220\n",
      defaults: { label: "Default Label" },
    });
    expect(json.svg).toContain(">Default Label<");
  });

  it("a note-shapes CSV column shapes the targeted string's dot", () => {
    const { json } = call("/bulk", {
      csv: 'notes,note-shapes\n320003,"{""6"":""square""}"\n',
    });
    expect(json.svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("applies a `defaults.noteShapes` value to rows that leave their column blank", () => {
    const { json } = call("/bulk", {
      csv: "notes,note-shapes\n320003,\n",
      defaults: { noteShapes: '{"6":"triangle"}' },
    });
    expect(json.svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-triangle"/);
  });

  it("respects a custom `columns` value, defaulting to 4 when omitted", () => {
    const csv = "notes\nx02220\n320003\nxxxxxx\n022100\n";
    const withDefault = call("/bulk", { csv });
    const withTwo = call("/bulk", { csv, columns: 2 });
    const widthOf = (svg: string) => Number(/^<svg[^>]*width="([\d.]+)"/.exec(svg)?.[1]);
    expect(widthOf(withTwo.json.svg)).toBeLessThan(widthOf(withDefault.json.svg));
  });

  it("400s with a clean, row-numbered message for an invalid chord in the CSV", () => {
    const { statusCode, json } = call("/bulk", {
      csv: "notes\nx02220\nqqqqqq\n",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("row 3");
  });

  it("ignores defaults.stylesheetPath even if a caller tries to smuggle one in", () => {
    // TypeScript wouldn't allow this field on BulkDefaultsBody, but a raw
    // HTTP caller isn't bound by our types -- confirm the route only ever
    // reads the fields it explicitly enumerates, never a blind spread.
    const { statusCode } = call("/bulk", {
      csv: "notes\nx02220\n",
      defaults: { stylesheetPath: "/etc/passwd" },
    });
    expect(statusCode).toBe(200); // succeeds, silently ignoring the unknown field
  });
});

describe("/neck", () => {
  it("renders a neck diagram from notes (JSON form) to SVG", () => {
    const { statusCode, json } = call("/neck", {
      notes: '[{"string":6,"fret":3,"label":"R","className":"root","finger":2}]',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain('class="neck-diagram"');
    expect(json.svg).toContain(">R<");
    expect(json.svg).toContain("root");
  });

  it("renders a neck diagram from notes (compact notation) to SVG", () => {
    const { statusCode, json } = call("/neck", { notes: "6:3:R:root:2" });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">R<");
  });

  it("400s when notes is missing", () => {
    const { statusCode, json } = call("/neck", {});
    expect(statusCode).toBe(400);
    expect(json.error).toContain("notes");
  });

  it("400s with a clean message for malformed notes text", () => {
    const { statusCode, json } = call("/neck", { notes: "banana" });
    expect(statusCode).toBe(400);
    expect(json.error).toBeTruthy();
  });

  it("renders brackets below the neck", () => {
    const { statusCode, json } = call("/neck", { notes: "6:3", brackets: "0-3:E shape;2-5:D shape" });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">E shape</text>");
    expect(json.svg).toContain("chord-bracket-level-1");
  });

  it("treats a blank brackets string as no brackets", () => {
    const { statusCode, json } = call("/neck", { notes: "6:3", brackets: "  " });
    expect(statusCode).toBe(200);
    expect(json.svg).not.toContain("chord-bracket");
  });

  it("400s for malformed or wrong-typed brackets", () => {
    expect((call("/neck", { notes: "6:3", brackets: "5-2:x" })).statusCode).toBe(400);
    expect((call("/neck", { notes: "6:3", brackets: 5 })).statusCode).toBe(400);
  });

  it("applies mutedStrings, dropping any marker targeting the same string", () => {
    const { json } = call("/neck", { notes: "6:3;1:2", mutedStrings: "1" });
    expect(json.svg).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
  });

  it("400s with a clean message for an invalid mutedStrings value", () => {
    const { statusCode } = call("/neck", { notes: "6:3", mutedStrings: "7" });
    expect(statusCode).toBe(400);
  });

  it("passes through label, tuning, and labelTuning", () => {
    const { json } = call("/neck", {
      notes: "6:3",
      label: "Neck",
      tuning: "DADGBE",
      labelTuning: true,
    });
    expect(json.svg).toContain(">Neck<");
    expect(json.svg).toContain("chord-tuning-label");
  });

  it("labelPitches auto-labels a fretted marker with no explicit label", () => {
    const { json } = call("/neck", { notes: "6:3", labelPitches: true });
    expect(json.svg).toContain(">G<"); // string 6 fret 3, standard tuning
  });

  it("a marker's shape (compact notation's 6th field) flows through to its dot", () => {
    const { json } = call("/neck", { notes: "6:3:R:root:2:square" });
    expect(json.svg).toMatch(/<rect class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-square"/);
  });

  it("respects firstFret/lastFret, surfacing standard-inlay-fret labels plus firstFret itself, even at the nut", () => {
    const atNut = call("/neck", { notes: "6:3" });
    expect(atNut.json.svg).toContain('chord-neck-fret-label-0"'); // firstFret itself
    expect(atNut.json.svg).toContain('chord-neck-fret-label-12"'); // a standard inlay fret

    const offset = call("/neck", { notes: "6:7", firstFret: 5, lastFret: 17 });
    expect(offset.statusCode).toBe(200);
    expect(offset.json.svg).toContain('chord-neck-fret-label-5"');
    expect(offset.json.svg).toContain('chord-neck-fret-label-17"');
  });

  it("labelFrets: false omits fret-number labels entirely", () => {
    const { json } = call("/neck", { notes: "6:3", labelFrets: false });
    expect(json.svg).not.toContain("chord-neck-fret-label");
  });

  it("expands firstFret/lastFret to fit a note outside the range and surfaces a warnings array", () => {
    const { json } = call("/neck", {
      notes: "6:3;5:20",
      firstFret: 0,
      lastFret: 12,
    });
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toContain("[0, 12]");
    expect(json.warnings[0]).toContain("[0, 20]");
  });

  it("omits warnings entirely (no empty array) when every note already fits", () => {
    const { json } = call("/neck", { notes: "6:3", firstFret: 0, lastFret: 12 });
    expect(json.warnings).toBeUndefined();
  });

  it("400s with a clean message when lastFret <= firstFret", () => {
    const { statusCode, json } = call("/neck", {
      notes: "6:3",
      firstFret: 10,
      lastFret: 5,
    });
    expect(statusCode).toBe(400);
    expect(json.error).toBeTruthy();
  });

  it("400s with a clean message for a non-numeric firstFret/lastFret", () => {
    expect((call("/neck", { notes: "6:3", firstFret: "five" })).statusCode).toBe(400);
    expect((call("/neck", { notes: "6:3", lastFret: "twelve" })).statusCode).toBe(400);
  });

  it("embeds raw CSS text from `stylesheet` directly, with no file I/O involved", () => {
    const css = ".chord-dot { fill: red; }";
    const { json } = call("/neck", { notes: "6:3", stylesheet: css });
    expect(json.svg).toContain(css);
  });

  it("embeds raw SVG markup from `defs` directly as a <defs> element, with no file I/O involved", () => {
    const defs = '<linearGradient id="g" />';
    const { json } = call("/neck", { notes: "6:3", defs });
    expect(json.svg).toContain("<defs>" + defs + "</defs>");
  });

  it("transpose shifts every marker's fret, and an explicit firstFret/lastFret window along with it", () => {
    const { json } = call("/neck", {
      notes: "6:7:R",
      firstFret: 5,
      lastFret: 17,
      transpose: 3,
    });
    expect(json.warnings).toBeUndefined(); // the window moved with the note -- no auto-expand needed
    expect(json.svg).toContain(">R<");
  });

  it("400s with a clean message when transpose is not a number", () => {
    const { statusCode, json } = call("/neck", { notes: "6:3", transpose: "two" });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("transpose");
  });

  it("400s a non-object body", () => {
    const { statusCode } = call("/neck", "just a string");
    expect(statusCode).toBe(400);
  });
});

describe("/document", () => {
  it("renders a type: chord document to SVG", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\nlabel: "A"\n',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">A<");
    expect(json.grid).toBeUndefined();
  });

  it("returns a type: chords document's charts one by one for printing", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chords\ncolumns: 2\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n  xx0232,D\n',
    });
    expect(statusCode).toBe(200);
    expect(json.grid.columns).toBe(2);
    expect(json.grid.charts).toHaveLength(3);
  });

  it("a type: chord document's noteShapes shapes the targeted string's dot", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chord\nnotation: "320003"\nnoteShapes: \'{"6":"square"}\'\n',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("a type: neck document's marker shape (compact notation) shapes its dot", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: neck\nnotes: "6:3:R:root:2:triangle"\n',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toMatch(/<polygon class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-triangle"/);
  });

  it("renders a type: scale document to SVG (native YAML notes list)", () => {
    const { statusCode, json } = call("/document", {
      document: "type: scale\nnotes:\n  - { string: 6, fret: 3, label: R }\n",
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain(">R<");
  });

  it("renders a type: neck document to SVG", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: neck\nnotes: "6:7:R"\nfirstFret: 5\nlastFret: 17\n',
    });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain('class="neck-diagram"');
  });

  it("renders a type: chords document (inline csv) to a composite SVG", () => {
    const { statusCode, json } = call("/document", {
      document: "type: chords\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n",
    });
    expect(statusCode).toBe(200);
    const nested = (json.svg.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
    expect(nested).toBe(2);
  });

  it("400s when document is missing", () => {
    const { statusCode, json } = call("/document", {});
    expect(statusCode).toBe(400);
    expect(json.error).toContain("document");
  });

  it("400s with a clean message for malformed YAML", () => {
    const { statusCode, json } = call("/document", {
      document: "type: chord\n  bad: [unclosed\n",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toBeTruthy();
  });

  it("400s with a clean message for an unrecognized type", () => {
    const { statusCode } = call("/document", { document: "type: banana\n" });
    expect(statusCode).toBe(400);
  });

  it("400s with a clean message for a propagated ChordParseError", () => {
    const { statusCode, json } = call("/document", {
      document: "type: chord\nnotation: qqqqqq\n",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toMatch(/q/);
  });

  it("400s and refuses to read a file for a document with stylesheetFile", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\nstylesheetFile: "/etc/passwd"\n',
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("stylesheetFile");
    expect(json.error).not.toContain("ENOENT"); // never actually attempted the read
  });

  it("400s and refuses to read a file for a document with defsFile", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\ndefsFile: "/etc/passwd"\n',
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("defsFile");
    expect(json.error).not.toContain("ENOENT"); // never actually attempted the read
  });

  it("400s and refuses to read a file for a chords document with csvFile", () => {
    const { statusCode, json } = call("/document", {
      document: "type: chords\ncsvFile: /etc/passwd\n",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("csvFile");
    expect(json.error).not.toContain("ENOENT");
  });

  it("400s when a chords document's inline csv row count exceeds the cap", () => {
    const rows = Array.from({ length: 201 }, () => "x02220").join("\n");
    const { statusCode, json } = call("/document", {
      document: `type: chords\ncsv: |\n  notes\n${rows
        .split("\n")
        .map((r) => `  ${r}`)
        .join("\n")}\n`,
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("too many rows");
  });

  it("embeds inline stylesheet text directly, with no file I/O involved", () => {
    const css = ".chord-dot { fill: red; }";
    const { json } = call("/document", {
      document: `type: chord\nnotation: "x02220"\nstylesheet: |\n  ${css}\n`,
    });
    expect(json.svg).toContain(css);
  });

  it("embeds inline defs text directly as a <defs> element, with no file I/O involved", () => {
    const defs = '<linearGradient id="g" />';
    const { json } = call("/document", {
      document: `type: chord\nnotation: "x02220"\ndefs: '${defs}'\n`,
    });
    expect(json.svg).toContain("<defs>" + defs + "</defs>");
  });

  it("surfaces a type: neck document's fret-range auto-expansion as a warnings array", () => {
    const { json } = call("/document", {
      document: 'type: neck\nnotes: "6:3;5:20"\nfirstFret: 0\nlastFret: 12\n',
    });
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toContain("[0, 20]");
  });

  it("applies a document's own transpose: field", () => {
    const { json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\ntranspose: 2\n',
    });
    expect(json.svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
  });

  it("a request-level transpose overrides the document's own transpose: field", () => {
    const { json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\ntranspose: 2\n',
      transpose: 0,
    });
    expect(json.svg).toMatch(/chord-glyph-open chord-glyph-string-5/);
  });

  it("400s with a clean message when transpose is not a number", () => {
    const { statusCode, json } = call("/document", {
      document: 'type: chord\nnotation: "x02220"\n',
      transpose: "two",
    });
    expect(statusCode).toBe(400);
    expect(json.error).toContain("transpose");
  });

  it("400s a non-object body", () => {
    const { statusCode } = call("/document", "just a string");
    expect(statusCode).toBe(400);
  });
});

describe("/triads", () => {
  it("renders a grid and returns the generated CSV", () => {
    const { statusCode, json } = call("/triads", { chords: "D Bm G A", strings: "1-3" });
    expect(statusCode).toBe(200);
    expect(json.svg).toContain("<svg");
    const lines = json.csv.trim().split("\n");
    expect(lines[0]).toBe("notes,label,root,string-labels");
    expect(lines.slice(1).map((l: string) => l.split(",")[1])).toEqual(["D", "Bm", "G", "A"]);
    expect(json.grid.charts).toHaveLength(4);
    expect(json.grid.columns).toBe(4);
  });

  it("accepts comma- and bar-separated chords", () => {
    const { statusCode, json } = call("/triads", { chords: "G, C | D" });
    expect(statusCode).toBe(200);
    expect(json.csv.trim().split("\n")).toHaveLength(4);
  });

  it("passes the search options through", () => {
    const { json } = call("/triads", {
      chords: "D G A",
      key: "D",
      strings: "1,2,3",
      floor: "5",
      direction: "above",
      maxSpan: 4,
      maxFret: 15,
      tuning: "DADGBE",
    });
    expect(json.csv.split("\n")[0]).toBe("notes,label,root,string-labels,tuning");
    for (const line of json.csv.trim().split("\n").slice(1)) {
      expect(line.startsWith("xxx") || line.startsWith("x-x-x-")).toBe(true);
    }
  });

  it("embeds stylesheet text", () => {
    const { json } = call("/triads", { chords: "G", stylesheet: ".root { fill: red; }" });
    expect(json.svg).toContain(".root { fill: red; }");
  });

  it("400s with clean messages for bad input", () => {
    const cases: [unknown, RegExp][] = [
      [{}, /chords is required/],
      [{ chords: "C13" }, /unsupported chord quality/],
      [{ chords: "G", strings: "1,3,5" }, /three adjacent strings/],
      [{ chords: "G", floor: "a" }, /invalid floor/],
      [{ chords: "G", direction: "up" }, /direction/],
      [{ chords: "G", maxFret: 99 }, /maxFret/],
      [{ chords: "G C", key: "A" }, /key's root/],
      [{ chords: Array(65).fill("G").join(" ") }, /too many chords/],
    ];
    for (const [body, message] of cases) {
      const { statusCode, json } = call("/triads", body);
      expect(statusCode).toBe(400);
      expect(json.error).toMatch(message);
    }
  });
});
