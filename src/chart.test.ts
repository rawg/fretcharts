import { describe, it, expect } from "vitest";
import { buildChart, tryBuildChart, renderChartPng, buildNeckDiagram, tryBuildNeckDiagram, renderNeckDiagramPng } from "./chart";
import { ChordParseError } from "./chordparse";
import { LayoutError, NoteMarker } from "./types";
import { TuningError } from "./tuning";
import { ChartInputError } from "./chartFieldResolver";

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

describe("buildChart", () => {
  it("builds a chart with svg output for a simple valid chord", () => {
    const chart = buildChart("x02220"); // A
    expect(chart.chord).toEqual([null, 0, 2, 2, 2, 0]);
    expect(chart.layout.stringCount).toBe(6);
    expect(chart.svg).toContain("<svg");
  });

  it("throws ChordParseError for invalid notation", () => {
    expect(() => buildChart("qqqqqq")).toThrow(ChordParseError);
  });

  it("throws LayoutError when relaxed parseOptions allow a span that blows the 5-fret cap", () => {
    // fret 1 and fret 12 span 11 frets -- fine to parse (dash-separated,
    // unambiguous) with maxSpan disabled, but computeLayout still enforces
    // the 5-fret display cap. Mirrors the fixture in layout.test.ts's
    // "LayoutError guard" case: [1, null, null, null, null, 12].
    expect(() =>
      buildChart("1-x-x-x-x-12", {
        parseOptions: { maxSpan: null },
      }),
    ).toThrow(LayoutError);
  });

  it("passes label and stringLabels through to the rendered SVG", () => {
    const chart = buildChart("320003", {
      label: "G Major",
      stringLabels: { 6: "R" },
    });
    expect(chart.svg).toContain("G Major");
    expect(chart.svg).toContain(">R<");
  });
});

describe("buildChart transpose (chord-notation mode)", () => {
  it("shifts every fretted/open string, producing the transposed chord shape", () => {
    const chart = buildChart("x02220", { transpose: 2 }); // A major -> B major shape
    expect(chart.chord).toEqual([null, 2, 4, 4, 4, 2]);
  });

  it("computes labelPitches from the transposed frets, not the original ones", () => {
    const chart = buildChart("x02220", { transpose: 2, labelPitches: true, tuning: "EADGBE" });
    // String 5 (open A) transposed +2 frets -> fret 2 -> B, not the original open A.
    expect(chart.svg).toContain(">B<");
    expect(chart.svg).not.toMatch(/label-string-5[^>]*>A</);
  });

  it("throws ChartInputError when the shift would put a note below the nut", () => {
    expect(() => buildChart("x02220", { transpose: -3 })).toThrow(ChartInputError);
  });

  it("is a no-op when omitted", () => {
    const chart = buildChart("x02220");
    expect(chart.chord).toEqual([null, 0, 2, 2, 2, 0]);
  });
});

describe("tryBuildChart", () => {
  it("returns ok:true with a chart for valid notation", () => {
    const result = tryBuildChart("x02220");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chart.svg).toContain("<svg");
    }
  });

  it("returns ok:false instead of throwing for a bad chord", () => {
    const result = tryBuildChart("qqqqqq");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ChordParseError);
    }
  });

  it("returns ok:false for a chord that blows the LayoutError cap", () => {
    const result = tryBuildChart("1-x-x-x-x-12", { parseOptions: { maxSpan: null } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LayoutError);
    }
  });
});

describe("tuning", () => {
  it("defaults to standard EADGBE tuning", () => {
    const chart = buildChart("320003", { labelPitches: true }); // G major
    // string 6 (E) fret 3 -> G; string 5 (A) fret 2 -> B; string 1 (E) fret 3 -> G.
    expect(chart.svg).toContain(">G<");
    expect(chart.svg).toContain(">B<");
  });

  it("a custom tuning changes both string count (via notation length) and computed pitches", () => {
    // Drop D: low string tuned down a whole step. Fret 0 on string 6 is D,
    // not E.
    const chart = buildChart("0xxxxx", { tuning: "DADGBE", labelPitches: true });
    // Open string never gets a pitch label, even though it sounds D.
    expect(chart.svg).not.toContain("chord-dot-label");
  });

  it("supports a non-6-string tuning by deriving stringCount from its length", () => {
    // 4-string tuning; a 4-character notation should parse against it
    // instead of the default 6.
    expect(() => buildChart("0232", { tuning: "GCEA" })).not.toThrow();
    const chart = buildChart("0232", { tuning: "GCEA" });
    expect(chart.layout.stringCount).toBe(4);
  });

  it("throws TuningError for invalid tuning notation", () => {
    expect(() => buildChart("320003", { tuning: "HADGBE" })).toThrow(TuningError);
  });
});

describe("labelPitches", () => {
  it("auto-labels every fretted note with its computed pitch, skipping open strings", () => {
    const chart = buildChart("320003", { labelPitches: true }); // G major
    // Fretted: string6 fret3 -> G, string5 fret2 -> B, string1 fret3 -> G.
    // Open: strings 4/3/2 get no dot label.
    const dotLabelTexts = [...chart.svg.matchAll(/class="chord-dot-label[^"]*"[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(dotLabelTexts.sort()).toEqual(["B", "G", "G"]);
  });

  it("an explicit stringLabels entry wins over the computed pitch label for that string", () => {
    const chart = buildChart("320003", {
      labelPitches: true,
      stringLabels: { 6: "R" }, // override string 6 (index 0)'s computed "G"
    });
    const stringSixDot = chart.layout.dots.find((d) => d.stringIndex === 0);
    expect(stringSixDot?.label).toBe("R");
    // Other strings still get their computed pitch (string 5 -> B).
    const stringFiveDot = chart.layout.dots.find((d) => d.stringIndex === 1);
    expect(stringFiveDot?.label).toBe("B");
  });

  it("does nothing when labelPitches is false/omitted", () => {
    const chart = buildChart("320003");
    expect(chart.svg).not.toContain("chord-dot-label");
  });
});

describe("labelTuning", () => {
  it("labels every string with its open pitch, regardless of fret/mute/open state", () => {
    const chart = buildChart("x02220", { labelTuning: true }); // A: one muted, two open, three fretted
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(chart.svg).toContain(`class="chord-tuning-label chord-tuning-label-string-${n}"`);
    }
    // Standard tuning, low to high: E A D G B E.
    expect(chart.layout.tuningLabels).toEqual([
      { stringIndex: 0, label: "E" },
      { stringIndex: 1, label: "A" },
      { stringIndex: 2, label: "D" },
      { stringIndex: 3, label: "G" },
      { stringIndex: 4, label: "B" },
      { stringIndex: 5, label: "E" },
    ]);
  });

  it("reflects a custom tuning", () => {
    const chart = buildChart("xxxxxx", { tuning: "DADGBE", labelTuning: true });
    expect(chart.layout.tuningLabels[0]).toEqual({ stringIndex: 0, label: "D" });
  });

  it("does nothing when labelTuning is false/omitted", () => {
    const chart = buildChart("320003");
    expect(chart.svg).not.toContain("chord-tuning-label");
    expect(chart.layout.tuningLabels).toEqual([]);
  });
});

describe("noteShapes", () => {
  it("shapes a dot addressed by string number", () => {
    const chart = buildChart("320003", { noteShapes: { 6: "square" } }); // G major, string 6 fretted at 3
    const dot = chart.layout.dots.find((d) => d.stringIndex === 0);
    expect(dot?.shape).toBe("square");
    expect(chart.svg).toMatch(/<rect class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-square"/);
  });

  it("does nothing when noteShapes is omitted -- every dot defaults to circle", () => {
    const chart = buildChart("320003");
    expect(chart.layout.dots.every((d) => d.shape === undefined)).toBe(true);
    expect(chart.svg).not.toContain('<rect class="chord-dot');
    expect(chart.svg).not.toContain('<polygon class="chord-dot');
  });

  it("supports diamond", () => {
    const chart = buildChart("320003", { noteShapes: { 6: "diamond" } });
    expect(chart.svg).toMatch(/<polygon class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-diamond"/);
  });
});

describe("renderChartPng", () => {
  it("resolves to a Buffer starting with the PNG magic bytes", async () => {
    const png = await renderChartPng("x02220");
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(Array.from(png.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });

  it("rejects (propagates ChordParseError) for invalid notation", async () => {
    await expect(renderChartPng("qqqqqq")).rejects.toThrow(ChordParseError);
  });
});

describe("scale-chart mode (options.notes)", () => {
  it("builds a chart from notes alone, with chord left undefined", () => {
    const notes: NoteMarker[] = [
      { string: 6, fret: 3, label: "R" },
      { string: 5, fret: 5, label: "5" },
    ];
    const chart = buildChart(undefined, { notes });
    expect(chart.chord).toBeUndefined();
    expect(chart.layout.stringCount).toBe(6);
    expect(chart.svg).toContain("<svg");
    expect(chart.svg).toContain(">R<");
    expect(chart.svg).toContain(">5<");
  });

  it("throws ChartInputError when both notation and options.notes are given", () => {
    expect(() => buildChart("x02220", { notes: [{ string: 6, fret: 3 }] })).toThrow(ChartInputError);
  });

  it("throws ChartInputError when neither notation nor options.notes are given", () => {
    expect(() => buildChart()).toThrow(ChartInputError);
    expect(() => buildChart(undefined, {})).toThrow(ChartInputError);
  });

  it("derives stringCount from tuning, same as chord mode", () => {
    const notes: NoteMarker[] = [{ string: 4, fret: 2 }];
    const chart = buildChart(undefined, { notes, tuning: "GCEA" });
    expect(chart.layout.stringCount).toBe(4);
  });

  it("renders mutedStrings as 'x' glyphs", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const chart = buildChart(undefined, { notes, mutedStrings: [1] });
    expect(chart.svg).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
  });

  it("labelTuning works the same way it does in chord mode", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const chart = buildChart(undefined, { notes, labelTuning: true });
    expect(chart.layout.tuningLabels).toHaveLength(6);
  });

  it("labelFrets defaults to on and can be turned off", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    expect(buildChart(undefined, { notes }).layout.fretRowLabels.length).toBeGreaterThan(0);
    expect(buildChart(undefined, { notes, labelFrets: false }).layout.fretRowLabels).toEqual([]);
  });

  it("a marker's own shape flows onto its dot", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3, shape: "triangle" }];
    const chart = buildChart(undefined, { notes });
    expect(chart.layout.dots[0].shape).toBe("triangle");
    expect(chart.svg).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-triangle"/);
  });

  it("silently ignores chord-notation-specific fields (stringLabels/fingerPositions/noteClasses)", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3, label: "R" }];
    const chart = buildChart(undefined, {
      notes,
      stringLabels: { 5: "should not appear" },
      fingerPositions: { 5: 1 },
      noteClasses: { 5: "should-not-appear" },
    });
    expect(chart.svg).not.toContain("should not appear");
    expect(chart.svg).not.toContain("should-not-appear");
    expect(chart.svg).toContain(">R<");
  });

  it("labelPitches auto-labels fretted markers with no explicit label, leaving an explicit one alone, and skips open markers", () => {
    const notes: NoteMarker[] = [
      { string: 6, fret: 3 }, // no explicit label -> computed "G"
      { string: 5, fret: 5, label: "custom" }, // explicit label wins
      { string: 4, fret: 0 }, // open -- never labeled, even though string 4's open pitch is "G" too
    ];
    const chart = buildChart(undefined, { notes, labelPitches: true });
    expect(chart.layout.dots.find((d) => d.stringIndex === 0)?.label).toBe("G"); // string 6
    expect(chart.layout.dots.find((d) => d.stringIndex === 1)?.label).toBe("custom"); // string 5
    expect(chart.layout.glyphs.find((g) => g.stringIndex === 2)?.label).toBeUndefined(); // string 4, open
  });

  it("labelPitches does nothing in scale-chart mode when omitted/false", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const chart = buildChart(undefined, { notes });
    expect(chart.svg).not.toContain("chord-dot-label");
  });

  it("transpose shifts every marker's fret before layout, reflected in a computed labelPitches label", () => {
    // String 6 (low E) fret 3 = G; transposed +2 -> fret 5 = A.
    const chart = buildChart(undefined, {
      notes: [{ string: 6, fret: 3 }],
      transpose: 2,
      labelPitches: true,
    });
    expect(chart.svg).toContain(">A<");
    expect(chart.svg).not.toContain(">G<");
  });

  it("transpose throws ChartInputError when the shift would put a marker below the nut", () => {
    expect(() => buildChart(undefined, { notes: [{ string: 6, fret: 1 }], transpose: -2 })).toThrow(
      ChartInputError,
    );
  });

  it("tryBuildChart returns ok:true for valid notes input", () => {
    const result = tryBuildChart(undefined, { notes: [{ string: 6, fret: 3 }] });
    expect(result.ok).toBe(true);
  });

  it("tryBuildChart returns ok:false with a ChartInputError for conflicting inputs", () => {
    const result = tryBuildChart("x02220", { notes: [{ string: 6, fret: 3 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ChartInputError);
    }
  });

  it("tryBuildChart returns ok:false with a LayoutError when notes span exceeds the 5-fret cap", () => {
    const notes: NoteMarker[] = [
      { string: 6, fret: 1 },
      { string: 1, fret: 12 },
    ];
    const result = tryBuildChart(undefined, { notes });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LayoutError);
    }
  });

  it("renderChartPng resolves a PNG for notes-mode input", async () => {
    const png = await renderChartPng(undefined, { notes: [{ string: 6, fret: 3 }] });
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(Array.from(png.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });
});

describe("buildNeckDiagram", () => {
  it("builds a neck diagram from notes, defaulting to the nut through fret 12", () => {
    const notes: NoteMarker[] = [
      { string: 6, fret: 3, label: "R" },
      { string: 5, fret: 5, label: "5" },
    ];
    const diagram = buildNeckDiagram(notes);
    expect(diagram.layout.stringCount).toBe(6);
    expect(diagram.layout.firstFret).toBe(0);
    expect(diagram.layout.lastFret).toBe(12);
    expect(diagram.svg).toContain("<svg");
    expect(diagram.svg).toContain('class="neck-diagram"');
    expect(diagram.svg).toContain(">R<");
    expect(diagram.svg).toContain(">5<");
  });

  it("respects an explicit firstFret/lastFret range", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 7 }];
    const diagram = buildNeckDiagram(notes, { firstFret: 5, lastFret: 17 });
    expect(diagram.layout.firstFret).toBe(5);
    expect(diagram.layout.lastFret).toBe(17);
    expect(diagram.layout.fretNumberLabels.length).toBeGreaterThan(0);
  });

  it("transpose shifts every marker's fret, and an explicit firstFret/lastFret window along with it", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 7, label: "R" }];
    const diagram = buildNeckDiagram(notes, { firstFret: 5, lastFret: 17, transpose: 3 });
    expect(diagram.layout.dots[0].fret).toBe(10);
    expect(diagram.layout.firstFret).toBe(8);
    expect(diagram.layout.lastFret).toBe(20);
    expect(diagram.layout.warnings).toEqual([]); // the window moved with the notes -- no auto-expand needed
  });

  it("transpose without an explicit firstFret/lastFret lets the defaulted range auto-expand around the shifted notes", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 10 }];
    const diagram = buildNeckDiagram(notes, { transpose: 5 }); // fret 15, past the default 0-12 window
    expect(diagram.layout.dots[0].fret).toBe(15);
    expect(diagram.layout.lastFret).toBe(15);
    expect(diagram.layout.warnings).toHaveLength(1);
  });

  it("transpose throws ChartInputError when the shift would put a marker below the nut", () => {
    expect(() => buildNeckDiagram([{ string: 6, fret: 2 }], { transpose: -5 })).toThrow(ChartInputError);
  });

  it("derives stringCount from tuning, same as buildChart", () => {
    const notes: NoteMarker[] = [{ string: 4, fret: 2 }];
    const diagram = buildNeckDiagram(notes, { tuning: "GCEA" });
    expect(diagram.layout.stringCount).toBe(4);
  });

  it("renders mutedStrings as 'x' glyphs", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const diagram = buildNeckDiagram(notes, { mutedStrings: [1] });
    expect(diagram.svg).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
  });

  it("labelTuning labels every string, regardless of fret/mute/open state", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const diagram = buildNeckDiagram(notes, { labelTuning: true });
    expect(diagram.layout.tuningLabels).toHaveLength(6);
  });

  it("labelFrets defaults to on (standard inlay frets, including at the nut) and can be turned off", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const onByDefault = buildNeckDiagram(notes);
    // firstFret 0 .. lastFret 12: inlay frets 3,5,7,9,12 plus firstFret(0) itself.
    expect(onByDefault.layout.fretNumberLabels.map((l) => l.fret)).toEqual([0, 3, 5, 7, 9, 12]);
    expect(buildNeckDiagram(notes, { labelFrets: false }).layout.fretNumberLabels).toEqual([]);
  });

  it("a marker's own shape flows onto its dot", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3, shape: "square" }];
    const diagram = buildNeckDiagram(notes);
    expect(diagram.layout.dots[0].shape).toBe("square");
    expect(diagram.svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("labelPitches auto-labels fretted markers with no explicit label, leaving an explicit one alone, and skips open markers", () => {
    const notes: NoteMarker[] = [
      { string: 6, fret: 3 }, // no explicit label -> computed "G"
      { string: 5, fret: 5, label: "custom" }, // explicit label wins
      { string: 4, fret: 0 }, // open -- never labeled
    ];
    const diagram = buildNeckDiagram(notes, { labelPitches: true });
    expect(diagram.layout.dots.find((d) => d.stringIndex === 0)?.label).toBe("G"); // string 6
    expect(diagram.layout.dots.find((d) => d.stringIndex === 1)?.label).toBe("custom"); // string 5
    expect(diagram.layout.glyphs.find((g) => g.stringIndex === 2)?.label).toBeUndefined(); // string 4, open
  });

  it("labelPitches does nothing when omitted/false", () => {
    const notes: NoteMarker[] = [{ string: 6, fret: 3 }];
    const diagram = buildNeckDiagram(notes);
    expect(diagram.svg).not.toContain("chord-dot-label");
  });

  it("throws LayoutError for an invalid fret range", () => {
    expect(() => buildNeckDiagram([{ string: 6, fret: 3 }], { firstFret: 10, lastFret: 5 })).toThrow(
      LayoutError,
    );
    expect(() => buildNeckDiagram([{ string: 6, fret: 3 }], { firstFret: -1 })).toThrow(LayoutError);
  });

  it("throws TuningError for invalid tuning notation", () => {
    expect(() => buildNeckDiagram([{ string: 6, fret: 3 }], { tuning: "ZZZZZZ" })).toThrow(TuningError);
  });

  it("passes label through to the rendered SVG", () => {
    const diagram = buildNeckDiagram([{ string: 6, fret: 3 }], { label: "My Scale" });
    expect(diagram.svg).toContain("My Scale");
  });

  it("tryBuildNeckDiagram returns ok:true for valid input", () => {
    const result = tryBuildNeckDiagram([{ string: 6, fret: 3 }]);
    expect(result.ok).toBe(true);
  });

  it("tryBuildNeckDiagram returns ok:false with a LayoutError for a bad fret range", () => {
    const result = tryBuildNeckDiagram([{ string: 6, fret: 3 }], { firstFret: 10, lastFret: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LayoutError);
    }
  });

  it("tryBuildNeckDiagram returns ok:false with a TuningError for bad tuning notation", () => {
    const result = tryBuildNeckDiagram([{ string: 6, fret: 3 }], { tuning: "ZZZZZZ" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TuningError);
    }
  });

  it("renderNeckDiagramPng resolves to a Buffer starting with the PNG magic bytes", async () => {
    const png = await renderNeckDiagramPng([{ string: 6, fret: 3 }]);
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(Array.from(png.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });
});

describe("buildChart brackets (scale-chart mode)", () => {
  const notes: NoteMarker[] = [
    { string: 6, fret: 5 },
    { string: 1, fret: 8 },
  ];

  it("renders brackets left of the grid", () => {
    const { svg, layout } = buildChart(undefined, { notes, brackets: [{ startFret: 5, endFret: 7, label: "Box 1" }] });
    expect(svg).toContain(">Box 1</text>");
    expect(layout.brackets).toEqual([{ startFret: 5, endFret: 7, label: "Box 1", level: 0 }]);
  });

  it("shifts brackets with transpose", () => {
    const { layout } = buildChart(undefined, { notes, transpose: 2, brackets: [{ startFret: 5, endFret: 7, label: "x" }] });
    expect(layout.brackets?.[0]).toMatchObject({ startFret: 7, endFret: 9 });
  });

  it("rejects brackets combined with chord notation", () => {
    expect(() => buildChart("x02220", { brackets: [{ startFret: 1, endFret: 2, label: "x" }] })).toThrow(ChartInputError);
  });
});
