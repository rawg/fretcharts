import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { run } from "./cli";

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
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

describe("run", () => {
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
    const p = path.join(os.tmpdir(), `fretcharts-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
    tmpFiles.push(p);
    return p;
  }

  it("writes SVG to stdout by default and exits 0", async () => {
    const code = await run(["x02220"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<svg");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with a clean stderr message (no stack trace) for invalid chord notation", async () => {
    const code = await run(["qqqqqq"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
    expect(cap.stderr).not.toContain("at ChordParseError");
    expect(cap.stderr).not.toContain(".ts:");
    expect(cap.stderr).not.toContain(".js:");
  });

  it("handles an all-muted chord without crashing", async () => {
    const code = await run(["xxxxxx"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<svg");
  });

  it("--output foo.svg writes an SVG file", async () => {
    const out = tmpPath("chord.svg");
    const code = await run(["320003", "--output", out]);
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const content = fs.readFileSync(out, "utf8");
    expect(content).toContain("<svg");
    expect(cap.stdout).toBe("");
  });

  it("--output foo.png writes a PNG file starting with the PNG magic bytes", async () => {
    const out = tmpPath("chord.png");
    const code = await run(["320003", "--output", out]);
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const content = fs.readFileSync(out);
    expect(Array.from(content.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });

  it("--output foo.txt (unrecognized extension) exits 1 with a clean error", async () => {
    const out = tmpPath("chord.txt");
    const code = await run(["320003", "--output", out]);
    expect(code).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  describe("--transpose", () => {
    it("shifts a chord notation's fretted/open strings by the given amount", async () => {
      const code = await run(["x02220", "--transpose", "2"]);
      expect(code).toBe(0);
      // A major -> B major shape: string 5/1 are no longer open.
      expect(cap.stdout).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
      expect(cap.stdout).not.toMatch(/chord-glyph-open chord-glyph-string-1/);
    });

    it("accepts a negative shift", async () => {
      const code = await run(["x24442", "--transpose", "-2"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("<svg");
    });

    it("rejects a non-integer value via commander's InvalidArgumentError", async () => {
      const code = await run(["x02220", "--transpose", "abc"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--transpose");
    });

    it("exits 1 cleanly when the shift would put a note below the nut", async () => {
      const code = await run(["x02220", "--transpose", "-3"]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("nut");
    });

    it("shifts --notes markers (scale-chart mode)", async () => {
      const code = await run(["--notes", "6:3", "--transpose", "2", "--label-pitches"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">A<"); // fret 3 (G) + 2 -> A
    });

    it("shifts --neck markers and an explicit --first-fret/--last-fret window together", async () => {
      const code = await run([
        "--neck",
        "--notes",
        "6:7:R",
        "--first-fret",
        "5",
        "--last-fret",
        "17",
        "--transpose",
        "3",
      ]);
      expect(code).toBe(0);
      expect(cap.stderr).toBe(""); // the window moved with the note -- no auto-expand warning
    });

    it("writes the original, untransposed notation/notes into a generated document, alongside a transpose: field", async () => {
      const out = tmpPath("transposed.yaml");
      const code = await run(["x02220", "--transpose", "2", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("notation: x02220");
      expect(text).toContain("transpose: 2");
    });

    it("--bake-transpose writes the transposed notation directly, with no transpose: field", async () => {
      const out = tmpPath("baked-chord.yaml");
      const code = await run(["x02220", "--transpose", "2", "--bake-transpose", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("notation: x 2 4 4 4 2");
      expect(text).not.toContain("transpose");
    });

    it("--bake-transpose writes transposed notes and an explicit firstFret/lastFret window, with no transpose: field", async () => {
      const out = tmpPath("baked-neck.yaml");
      const code = await run([
        "--neck",
        "--notes",
        "6:7:R",
        "--first-fret",
        "5",
        "--last-fret",
        "17",
        "--transpose",
        "3",
        "--bake-transpose",
        "--output",
        out,
      ]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("fret: 10");
      expect(text).toContain("firstFret: 8");
      expect(text).toContain("lastFret: 20");
      expect(text).not.toContain("transpose");
    });

    it("--bake-transpose has no effect without --transpose", async () => {
      const out = tmpPath("no-bake.yaml");
      const code = await run(["x02220", "--bake-transpose", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("notation: x02220");
      expect(text).not.toContain("transpose");
    });

    it("exits 1 cleanly when --bake-transpose's shift would put a note below the nut", async () => {
      const out = tmpPath("bad-bake.yaml");
      const code = await run(["x02220", "--transpose", "-3", "--bake-transpose", "--output", out]);
      expect(code).toBe(1);
      expect(fs.existsSync(out)).toBe(false);
      expect(cap.stderr).toContain("nut");
    });

    it("--file --bake-transpose bakes an existing document's own transpose: field into its notation, and it re-renders correctly", async () => {
      const docPath = tmpPath("unbaked.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const bakedPath = tmpPath("baked.yaml");
      const code = await run(["--file", docPath, "--bake-transpose", "--output", bakedPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(bakedPath, "utf8");
      expect(text).toContain("notation: x 2 4 4 4 2");
      expect(text).not.toContain("transpose");

      const svgPath = tmpPath("baked.svg");
      const renderCode = await run(["--file", bakedPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("--file --transpose --bake-transpose together override the document's own transpose and bake the new shift", async () => {
      const docPath = tmpPath("unbaked.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const out = tmpPath("rebaked.yaml");
      const code = await run(["--file", docPath, "--transpose", "1", "--bake-transpose", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      // Overridden shift (1, not the document's own 2) baked into notation.
      expect(text).toContain("notation: x 1 3 3 3 1");
      expect(text).not.toContain("transpose");
    });

    it("--bulk --transpose --bake-transpose writes the transposed CSV directly, with no transpose: field", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes,label\nx02220,A\n320003,G\n");
      const docPath = tmpPath("chords.yaml");
      const code = await run(["--bulk", csvPath, "--transpose", "2", "--bake-transpose", "--output", docPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(docPath, "utf8");
      expect(text).toContain("x 2 4 4 4 2,A");
      expect(text).toContain("5 4 2 2 2 5,G");
      expect(text).not.toContain("x02220");
      expect(text).not.toContain("transpose");
    });

    it("--file --bake-transpose bakes an existing type: chords document's inline csv, and it re-renders correctly", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const docPath = tmpPath("chords.yaml");
      const writeCode = await run(["--bulk", csvPath, "--transpose", "2", "--output", docPath]);
      expect(writeCode).toBe(0);

      const rebakedPath = tmpPath("chords-rebaked.yaml");
      const code = await run(["--file", docPath, "--bake-transpose", "--output", rebakedPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(rebakedPath, "utf8");
      expect(text).toContain("x 2 4 4 4 2");
      expect(text).not.toContain("x02220");
      expect(text).not.toContain("transpose");

      const svgPath = tmpPath("chords-rebaked.svg");
      const renderCode = await run(["--file", rebakedPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("--bake-transpose has no effect on a type: chords document referencing an external csvFile (transpose: field kept, no file touched)", async () => {
      const docPath = tmpPath("chords.yaml");
      fs.writeFileSync(docPath, "type: chords\ncsvFile: ./chords.csv\ntranspose: 2\n");

      const rebakedPath = tmpPath("chords-rebaked.yaml");
      const code = await run(["--file", docPath, "--bake-transpose", "--output", rebakedPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(rebakedPath, "utf8");
      expect(text).toContain("csvFile: ./chords.csv");
      expect(text).toContain("transpose: 2");
    });

    it("--bulk --bake-transpose exits 1 cleanly, row-numbered, when a shift would put a note below the nut", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const docPath = tmpPath("chords.yaml");
      const code = await run(["--bulk", csvPath, "--transpose", "-3", "--bake-transpose", "--output", docPath]);
      expect(code).toBe(1);
      expect(fs.existsSync(docPath)).toBe(false);
      expect(cap.stderr).toContain("row 2");
    });

    it("a document written with --transpose renders the transposed shape when later run via --file", async () => {
      const out = tmpPath("transposed.yaml");
      const writeCode = await run(["x02220", "--transpose", "2", "--output", out]);
      expect(writeCode).toBe(0);

      const svgPath = tmpPath("transposed.svg");
      const renderCode = await run(["--file", out, "--output", svgPath]);
      expect(renderCode).toBe(0);
      const svg = fs.readFileSync(svgPath, "utf8");
      expect(svg).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("--transpose combined with --file overrides the document's own transpose: field", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\ntranspose: 2\n');
      const code = await run(["--file", docPath, "--transpose", "0"]);
      expect(code).toBe(0);
      // --transpose 0 overrides the document's own transpose: 2, so the
      // original open A shape renders unchanged.
      expect(cap.stdout).toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("--bulk --transpose shifts every row's chord notation", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--bulk", csvPath, "--transpose", "2"]);
      expect(code).toBe(0);
      expect(cap.stdout).not.toMatch(/chord-glyph-open chord-glyph-string-5/);
    });

    it("--bulk --transpose exits 1 cleanly, row-numbered, when a shift would put a note below the nut", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--bulk", csvPath, "--transpose", "-3"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("row 2");
    });
  });

  it("--label flows through into the rendered SVG output", async () => {
    const code = await run(["320003", "--label", "G Major"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("G Major");
  });

  it("--string-labels flows through: the label text appears near its dot", async () => {
    const code = await run(["320003", "--string-labels", '{"6":"R"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toContain(">R<");
  });

  it("malformed --string-labels JSON exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--string-labels", "{not valid json"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
    expect(cap.stderr).not.toContain("SyntaxError");
  });

  it("--string-labels that parses but isn't an object exits 1 cleanly", async () => {
    const code = await run(["320003", "--string-labels", "[1,2,3]"]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--finger-positions (JSON form) flows through into the rendered SVG output", async () => {
    const code = await run(["320003", "--finger-positions", '{"6":"3"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("chord-finger-label");
    expect(cap.stdout).toContain(">3<");
  });

  it("--finger-positions (notation form) flows through into the rendered SVG output", async () => {
    // 320003 (G major): string 6 fretted at 3 -> label it finger 3.
    const code = await run(["320003", "--finger-positions", "3xxxxx"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('class="chord-finger-label chord-finger-label-string-6"');
  });

  it("--finger-positions never labels an open/muted string, even if given one", async () => {
    // 320003 (G major): strings 4/3/2 are open -- a finger position for one
    // of them must be silently dropped, not rendered.
    const code = await run(["320003", "--finger-positions", '{"4":"1"}']);
    expect(code).toBe(0);
    expect(cap.stdout).not.toContain("chord-finger-label");
  });

  it("malformed --finger-positions exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--finger-positions", "{not valid json"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--finger-positions with an out-of-range finger (e.g. 9) exits 1 cleanly", async () => {
    const code = await run(["320003", "--finger-positions", '{"6":"9"}']);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--string-label-N/--finger-position-N flow through per-string", async () => {
    // 320003 (G major): string 6 fretted at 3, string 1 fretted at 3.
    const code = await run([
      "320003",
      "--string-label-6",
      "R",
      "--finger-position-1",
      "3",
    ]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain(">R<");
    expect(cap.stdout).toContain('class="chord-finger-label chord-finger-label-string-1"');
  });

  it("--string-label-N wins over a same-numbered --string-labels entry", async () => {
    const code = await run([
      "320003",
      "--string-labels",
      '{"6":"aggregate"}',
      "--string-label-6",
      "override",
    ]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain(">override<");
    expect(cap.stdout).not.toContain(">aggregate<");
  });

  it("--finger-position-N with an out-of-range finger (e.g. 9) exits 1 cleanly", async () => {
    const code = await run(["320003", "--finger-position-1", "9"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toContain("string 1");
  });

  it("--note-classes adds the custom class to the targeted string's note", async () => {
    // 320003 (G major): string 6 (index 0) is fretted at 3.
    const code = await run(["320003", "--note-classes", '{"6":"root"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('class="chord-dot chord-dot-string-6 root chord-dot-shape-circle"');
  });

  it("--note-classes applies to an open string too, since a root note can be open", async () => {
    // 320003 (G major): strings 4/3/2 (indices 2/3/4) are open.
    const code = await run(["320003", "--note-classes", '{"4":"root"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("chord-glyph-open chord-glyph-string-4 root");
  });

  it("--note-classes never applies to a muted string", async () => {
    // x02220 has no muted strings in this project's other fixtures, so
    // build one with an actually-muted string: xx0232 mutes strings 6/5.
    const code = await run(["xx0232", "--note-classes", '{"6":"root"}']);
    expect(code).toBe(0);
    expect(cap.stdout).not.toContain("root");
  });

  it("--note-classes combined with --stylesheet actually recolors the targeted note through PNG rasterization", async () => {
    const cssPath = tmpPath("root.css");
    fs.writeFileSync(cssPath, ".root { fill: rgb(0, 200, 0); }");

    const unstyledCode = await run(["320003", "--note-classes", '{"6":"root"}']);
    expect(unstyledCode).toBe(0);
    const svg = cap.stdout;
    const circleTag = /<circle class="chord-dot chord-dot-string-6 root chord-dot-shape-circle"[^>]*\/>/.exec(svg)?.[0];
    expect(circleTag).toBeDefined();
    const cx = Math.round(Number(/cx="([-\d.]+)"/.exec(circleTag!)?.[1]));
    const cy = Math.round(Number(/cy="([-\d.]+)"/.exec(circleTag!)?.[1]));

    const out = tmpPath("root-styled.png");
    const code = await run([
      "320003",
      "--note-classes",
      '{"6":"root"}',
      "--stylesheet",
      cssPath,
      "--output",
      out,
    ]);
    expect(code).toBe(0);

    const png = fs.readFileSync(out);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(png).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const idx = (cy * info.width + cx) * info.channels;
    expect([data[idx], data[idx + 1], data[idx + 2]]).toEqual([0, 200, 0]);
  });

  it("malformed --note-classes JSON exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--note-classes", "{not valid json"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--note-classes that parses but isn't an object exits 1 cleanly", async () => {
    const code = await run(["320003", "--note-classes", "[1,2,3]"]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--note-shapes shapes the targeted string's dot", async () => {
    const code = await run(["320003", "--note-shapes", '{"6":"square"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
  });

  it("--note-shapes supports diamond", async () => {
    const code = await run(["320003", "--note-shapes", '{"6":"diamond"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-diamond"/);
  });

  it("malformed --note-shapes JSON exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--note-shapes", "{not valid json"]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--note-shapes with an invalid shape value exits 1 cleanly", async () => {
    const code = await run(["320003", "--note-shapes", '{"6":"hexagon"}']);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it('--root "6" tags that single string with the "root" class', async () => {
    const code = await run(["320003", "--root", "6"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('class="chord-dot chord-dot-string-6 root chord-dot-shape-circle"');
  });

  it('--root "4,2" (comma-separated, whitespace ignored) tags multiple strings', async () => {
    const code = await run(["320003", "--root", "4, 2"]);
    expect(code).toBe(0);
    // 320003: strings 4 and 2 (indices 2, 4) are open -- root on an open
    // string should tag the open-circle glyph.
    expect(cap.stdout).toContain("chord-glyph-open chord-glyph-string-4 root");
    expect(cap.stdout).toContain("chord-glyph-open chord-glyph-string-2 root");
  });

  it("--note-classes wins over --root when both target the same string", async () => {
    const code = await run(["320003", "--root", "6", "--note-classes", '{"6":"highlight"}']);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('class="chord-dot chord-dot-string-6 highlight chord-dot-shape-circle"');
    expect(cap.stdout).not.toContain("root");
  });

  it("--root with an out-of-range string number exits 1 cleanly", async () => {
    const code = await run(["320003", "--root", "7"]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--root with empty input exits 1 cleanly", async () => {
    const code = await run(["320003", "--root", ""]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--tuning changes the computed pitch and, via its length, the accepted string count", async () => {
    const dropD = await run(["0xxxxx", "--tuning", "DADGBE"]);
    expect(dropD).toBe(0);
    expect(cap.stdout).toContain("<svg"); // open D string, no crash

    const ukulele = await run(["0232", "--tuning", "GCEA"]);
    expect(ukulele).toBe(0);
    expect(cap.stdout).toContain("<svg");
  });

  it("invalid --tuning notation exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--tuning", "HADGBE"]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--label-pitches auto-labels fretted notes with their computed pitch", async () => {
    const code = await run(["320003", "--label-pitches"]); // G major, standard tuning
    expect(code).toBe(0);
    expect(cap.stdout).toContain("chord-dot-label");
    expect(cap.stdout).toContain(">G<");
  });

  it("--label-pitches combined with a custom --tuning computes pitches against that tuning", async () => {
    // Drop D: fret 2 on the (dropped) low string is E, not F#.
    const code = await run(["2xxxxx", "--tuning", "DADGBE", "--label-pitches"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain(">E<");
  });

  it("--label-tuning labels every string with its open pitch, including muted/open ones", async () => {
    const code = await run(["x02220", "--label-tuning"]); // A: muted/open/fretted mix
    expect(code).toBe(0);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(cap.stdout).toContain(`class="chord-tuning-label chord-tuning-label-string-${n}"`);
    }
  });

  it("--label-tuning reflects a custom --tuning", async () => {
    const code = await run(["xxxxxx", "--tuning", "DADGBE", "--label-tuning"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('class="chord-tuning-label chord-tuning-label-string-6"');
    const tag = /<text class="chord-tuning-label chord-tuning-label-string-6"[^>]*>D<\/text>/.exec(
      cap.stdout,
    );
    expect(tag).not.toBeNull();
  });

  it("omits tuning labels entirely when --label-tuning isn't given", async () => {
    const code = await run(["320003"]);
    expect(code).toBe(0);
    expect(cap.stdout).not.toContain("chord-tuning-label");
  });

  it("--stylesheet embeds the CSS file's contents into the rendered SVG", async () => {
    const cssPath = tmpPath("style.css");
    fs.writeFileSync(cssPath, ".chord-dot-string-6 { fill: red; }");
    const code = await run(["320003", "--stylesheet", cssPath]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<style>");
    expect(cap.stdout).toContain(".chord-dot-string-6 { fill: red; }");
  });

  it("--svg-defs embeds raw SVG markup into the rendered SVG as a <defs> element", async () => {
    const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
    const code = await run(["320003", "--svg-defs", defs]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<defs>" + defs + "</defs>");
  });

  it("--svg-defs-file embeds the file's contents into the rendered SVG as a <defs> element", async () => {
    const defsPath = tmpPath("defs.svg");
    const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
    fs.writeFileSync(defsPath, defs);
    const code = await run(["320003", "--svg-defs-file", defsPath]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<defs>" + defs + "</defs>");
  });

  it("combining --svg-defs with --svg-defs-file exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--svg-defs", "<x/>", "--svg-defs-file", tmpPath("does-not-exist.svg")]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toContain("--svg-defs");
  });

  it("--svg-defs-file pointing at a nonexistent file exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--svg-defs-file", tmpPath("does-not-exist.svg")]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
    expect(cap.stderr).not.toContain(".ts:");
    expect(cap.stderr).not.toContain(".js:");
  });

  it("--stylesheet pointing at a nonexistent file exits 1 cleanly instead of crashing", async () => {
    const code = await run(["320003", "--stylesheet", tmpPath("does-not-exist.css")]);
    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr.length).toBeGreaterThan(0);
    expect(cap.stderr).not.toContain(".ts:");
    expect(cap.stderr).not.toContain(".js:");
  });

  it("--stylesheet actually changes the rasterized PNG pixel color for the targeted string's dot (end-to-end through sharp)", async () => {
    const cssPath = tmpPath("style.css");
    // 320003 (G major): string 6 (leftmost, array index 0) is fretted at 3.
    fs.writeFileSync(cssPath, ".chord-dot-string-6 { fill: rgb(255, 0, 0); }");

    // Get the dot's real (cx, cy) from the actual SVG output, rather than
    // assuming geometry -- keeps this test valid regardless of future
    // layout/rendering tweaks.
    const unstyledCode = await run(["320003"]);
    expect(unstyledCode).toBe(0);
    const svg = cap.stdout;
    const circleTag = /<circle class="chord-dot chord-dot-string-6 chord-dot-shape-circle"[^>]*\/>/.exec(svg)?.[0];
    expect(circleTag).toBeDefined();
    const cx = Math.round(Number(/cx="([-\d.]+)"/.exec(circleTag!)?.[1]));
    const cy = Math.round(Number(/cy="([-\d.]+)"/.exec(circleTag!)?.[1]));

    const out = tmpPath("styled.png");
    const code = await run(["320003", "--stylesheet", cssPath, "--output", out]);
    expect(code).toBe(0);

    const png = fs.readFileSync(out);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(png).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const { width, channels } = info;
    const idx = (cy * width + cx) * channels;
    expect([data[idx], data[idx + 1], data[idx + 2]]).toEqual([255, 0, 0]);
  });

  it("--bulk renders a CSV file's rows into one composite SVG on stdout", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes,label\nx02220,A\n320003,G\n");
    const code = await run(["--bulk", csvPath]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("<svg");
    const nested = cap.stdout.match(/<svg[^>]*class="chord-chart"/g) ?? [];
    expect(nested).toHaveLength(2);
  });

  it("--bulk writes a composite PNG when --output ends in .png", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n320003\nxxxxxx\n");
    const out = tmpPath("bulk.png");
    const code = await run(["--bulk", csvPath, "--output", out]);
    expect(code).toBe(0);
    const content = fs.readFileSync(out);
    expect(Array.from(content.subarray(0, 4))).toEqual(PNG_MAGIC_BYTES);
  });

  it("--bulk combined with a notation argument exits 1 cleanly", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n");
    const code = await run(["320003", "--bulk", csvPath]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("missing notation and no --bulk exits 1 cleanly instead of a stack trace", async () => {
    const code = await run([]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
    expect(cap.stderr).not.toContain(".ts:");
  });

  it("--bulk with a nonexistent CSV path exits 1 cleanly", async () => {
    const code = await run(["--bulk", tmpPath("does-not-exist.csv")]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--bulk propagates a row-numbered error for a bad chord in the CSV", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\nqqqqqq\n");
    const code = await run(["--bulk", csvPath]);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("row 3");
  });

  it("--bulk uses command-line flags as per-row defaults (--label-pitches applies to every row)", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\n320003\n");
    const code = await run(["--bulk", csvPath, "--label-pitches"]);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("chord-dot-label");
  });

  it("--columns=2 arranges 4 same-size charts into a 2-wide, 2-tall grid", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n320003\nxxxxxx\n022100\n");
    const code = await run(["--bulk", csvPath, "--columns", "2"]);
    expect(code).toBe(0);
    // All four are plain 6-string nut-position charts: 210px grid + 50px
    // right margin (always reserved now, for the row-1/row-3 fret labels)
    // = 260px wide, 256px tall. 2 columns -> width = 2*260 + 1*gutter(20)
    // = 540; 2 rows -> height = 2*256 + 1*20 = 532.
    expect(/width="([\d.]+)"/.exec(cap.stdout)?.[1]).toBe("540");
    expect(/height="([\d.]+)"/.exec(cap.stdout)?.[1]).toBe("532");
  });

  it("defaults to --columns=4 (all 4 charts in a single row)", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n320003\nxxxxxx\n022100\n");
    const code = await run(["--bulk", csvPath]);
    expect(code).toBe(0);
    // 4 columns -> width = 4*260 + 3*gutter(20) = 1100; 1 row -> height = 256.
    expect(/width="([\d.]+)"/.exec(cap.stdout)?.[1]).toBe("1100");
    expect(/height="([\d.]+)"/.exec(cap.stdout)?.[1]).toBe("256");
  });

  it("--columns with a non-positive value exits 1 cleanly", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n");
    const code = await run(["--bulk", csvPath, "--columns", "0"]);
    expect(code).toBe(1);
    expect(cap.stderr.length).toBeGreaterThan(0);
  });

  it("--collection-label titles the whole composite grid image", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes,label\nx02220,A\n320003,G\n");
    const code = await run(["--bulk", csvPath, "--collection-label", "My Songbook"]);
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/<text class="chord-collection-label"[^>]*>My Songbook<\/text>/);
    // Per-chord labels are untouched.
    expect(cap.stdout).toContain(">A<");
    expect(cap.stdout).toContain(">G<");
  });

  it("omits the collection label entirely when --collection-label isn't given", async () => {
    const csvPath = tmpPath("chords.csv");
    fs.writeFileSync(csvPath, "notes\nx02220\n");
    const code = await run(["--bulk", csvPath]);
    expect(code).toBe(0);
    expect(cap.stdout).not.toContain("chord-collection-label");
  });

  describe("--notes (scale-chart mode)", () => {
    it("fret-number labels are on by default", async () => {
      const code = await run(["--notes", "6:3"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("chord-fret-label");
    });

    it("--no-label-frets omits fret-number labels", async () => {
      const code = await run(["--notes", "6:3", "--no-label-frets"]);
      expect(code).toBe(0);
      expect(cap.stdout).not.toContain("chord-fret-label");
    });

    it("renders a chart from --notes alone, with a marker's label/className/finger all flowing through", async () => {
      const code = await run([
        "--notes",
        '[{"string":6,"fret":3,"label":"R","className":"root","finger":3}]',
      ]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">R<");
      expect(cap.stdout).toContain("root");
      expect(cap.stdout).toContain("chord-finger-label");
      expect(cap.stdout).toContain(">3<");
    });

    it("renders a chart from --notes using compact notation instead of JSON", async () => {
      const code = await run(["--notes", "6:3:R:root:3;6:5:2;5:2:b3"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">R<");
      expect(cap.stdout).toContain(">2<");
      expect(cap.stdout).toContain(">b3<");
      expect(cap.stdout).toContain("root");
      expect(cap.stdout).toContain("chord-finger-label");
    });

    it("a marker's shape (6th compact-notation field) flows through to its dot", async () => {
      const code = await run(["--notes", "6:3:R:root:3:square"]);
      expect(code).toBe(0);
      expect(cap.stdout).toMatch(/<rect class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-square"/);
    });

    it("a marker's shape (JSON form) flows through to its dot", async () => {
      const code = await run(["--notes", '[{"string":6,"fret":3,"shape":"triangle"}]']);
      expect(code).toBe(0);
      expect(cap.stdout).toMatch(/<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-triangle"/);
    });

    it("an invalid shape in compact notation exits 1 cleanly", async () => {
      const code = await run(["--notes", "6:3:R:root:3:hexagon"]);
      expect(code).toBe(1);
      expect(cap.stderr.length).toBeGreaterThan(0);
    });

    it("malformed compact notation exits 1 cleanly with a message showing the expected shape", async () => {
      const code = await run(["--notes", "6"]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("string:fret");
    });

    it("renders an open (fret 0) marker's label on a glyph, not a dot", async () => {
      const code = await run(["--notes", '[{"string":6,"fret":0,"label":"1"}]']);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("chord-glyph-open");
      expect(cap.stdout).toContain("chord-glyph-label");
      expect(cap.stdout).toContain(">1<");
    });

    it("--muted renders 'x' glyphs for the given strings", async () => {
      const code = await run(["--notes", '[{"string":6,"fret":3}]', "--muted", "1,2"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
      expect(cap.stdout).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-2"');
    });

    it("--label-pitches auto-labels a fretted marker with no explicit label, leaving an explicit one alone", async () => {
      const code = await run(["--notes", "6:3;5:5:custom", "--label-pitches"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">G<"); // string 6 fret 3, standard tuning
      expect(cap.stdout).toContain(">custom<");
    });

    it("--notes combined with a notation argument exits 1 cleanly", async () => {
      const code = await run(["320003", "--notes", '[{"string":6,"fret":3}]']);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("--notes");
    });

    it("--notes combined with --bulk exits 1 cleanly", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--bulk", csvPath, "--notes", '[{"string":6,"fret":3}]']);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--notes");
    });

    it("neither a notation argument, --bulk, nor --notes exits 1 with a message listing all three", async () => {
      const code = await run([]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--bulk");
      expect(cap.stderr).toContain("--notes");
    });

    it.each([
      ["malformed JSON", "{not valid json"],
      ["not an array", '{"string":6,"fret":3}'],
      ["array element missing string/fret", "[{}]"],
      ["out-of-range string number", '[{"string":7,"fret":3}]'],
      ["negative fret", '[{"string":6,"fret":-1}]'],
      ["out-of-range finger", '[{"string":6,"fret":3,"finger":9}]'],
    ])("malformed --notes (%s) exits 1 cleanly instead of crashing", async (_label, notesJson) => {
      const code = await run(["--notes", notesJson]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr.length).toBeGreaterThan(0);
    });
  });

  describe("--neck (neck-diagram mode)", () => {
    it("renders a neck diagram from --neck plus --notes", async () => {
      const code = await run(["--neck", "--notes", '[{"string":6,"fret":3,"label":"R"}]']);
      expect(code).toBe(0);
      expect(cap.stdout).toContain('class="neck-diagram"');
      expect(cap.stdout).toContain(">R<");
    });

    it("--neck alone (no --notes) exits 1 with the existing missing-notation message", async () => {
      const code = await run(["--neck"]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("--notes");
    });

    it("--neck combined with a notation argument exits 1, message mentions --neck", async () => {
      const code = await run(["320003", "--neck"]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("--neck");
    });

    it("--neck combined with --bulk exits 1, message mentions --neck", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--bulk", csvPath, "--neck"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--neck");
    });

    it("--first-fret/--last-fret set the shown range and surface fret-number labels", async () => {
      const code = await run([
        "--neck",
        "--notes",
        '[{"string":6,"fret":7}]',
        "--first-fret",
        "5",
        "--last-fret",
        "17",
      ]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("chord-neck-fret-label");
    });

    it("--brackets draws labeled fret-range brackets below the neck", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--brackets", "0-3:E shape;2-5:D shape"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">E shape</text>");
      expect(cap.stdout).toContain("chord-bracket-level-1");
    });

    it("--brackets without --notes exits 1", async () => {
      const code = await run(["x02220", "--brackets", "0-3:E"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--brackets requires --notes");
    });

    it("--brackets works in scale-chart mode (--notes without --neck), drawn left of the grid", async () => {
      const code = await run(["--notes", "6:5;1:8", "--brackets", "5-7:Box 1"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain('class="chord-chart"');
      expect(cap.stdout).toContain(">Box 1</text>");
    });

    it("--brackets is written into a type: scale document", async () => {
      const out = tmpPath("scale.yaml");
      const code = await run(["--notes", "6:5;1:8", "--brackets", "5-7:Box 1", "--compact-notes", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: scale");
      expect(text).toContain("brackets: 5-7:Box 1");
    });

    it("--brackets with --bulk exits 1", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--bulk", csvPath, "--brackets", "1-2:x"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--brackets");
    });

    it("malformed --brackets exits 1", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--brackets", "5-2:x"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("brackets[0]");
    });

    it("--bake-transpose shifts --brackets along with the notes in a written document", async () => {
      const out = tmpPath("baked.yaml");
      const code = await run([
        "--neck",
        "--notes",
        "6:3",
        "--brackets",
        "2-5:C",
        "--transpose",
        "2",
        "--bake-transpose",
        "--compact-notes",
        "--output",
        out,
      ]);
      expect(code).toBe(0);
      expect(fs.readFileSync(out, "utf8")).toContain("brackets: 4-7:C");
    });

    it("expands --first-fret/--last-fret to fit a note outside the range, and prints a stderr warning", async () => {
      const code = await run([
        "--neck",
        "--notes",
        '[{"string":6,"fret":3},{"string":5,"fret":20}]',
        "--first-fret",
        "0",
        "--last-fret",
        "12",
      ]);
      expect(code).toBe(0);
      expect(cap.stderr).toContain("warning:");
      expect(cap.stderr).toContain("[0, 12]");
      expect(cap.stderr).toContain("[0, 20]");
      // Both notes actually render -- the fret-20 one isn't silently dropped.
      expect(cap.stdout).toMatch(/class="chord-dot chord-dot-string-6/);
      expect(cap.stdout).toMatch(/class="chord-dot chord-dot-string-5/);
    });

    it("does not warn when every note already fits within --first-fret/--last-fret", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--first-fret", "0", "--last-fret", "12"]);
      expect(code).toBe(0);
      expect(cap.stderr).toBe("");
    });

    it("fret-number labels are on by default, even at the nut, at the standard inlay frets", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--last-fret", "5"]);
      expect(code).toBe(0);
      for (const fret of [0, 3, 5]) {
        expect(cap.stdout).toContain(`chord-neck-fret-label-${fret}"`);
      }
      expect(cap.stdout).not.toContain("chord-neck-fret-label-1\"");
    });

    it("--no-label-frets omits fret-number labels entirely", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--no-label-frets"]);
      expect(code).toBe(0);
      expect(cap.stdout).not.toContain("chord-neck-fret-label");
    });

    it("--first-fret -1 exits 1 via commander's InvalidArgumentError", async () => {
      const code = await run(["--neck", "--notes", '[{"string":6,"fret":3}]', "--first-fret", "-1"]);
      expect(code).toBe(1);
    });

    it("--last-fret <= --first-fret exits 1 via the generic LayoutError catch", async () => {
      const code = await run([
        "--neck",
        "--notes",
        '[{"string":6,"fret":3}]',
        "--first-fret",
        "10",
        "--last-fret",
        "5",
      ]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr.length).toBeGreaterThan(0);
    });

    it("--muted/--tuning/--label/--label-tuning/--stylesheet/--output all work under --neck", async () => {
      const outPath = tmpPath("neck.svg");
      const stylesheetPath = tmpPath("style.css");
      fs.writeFileSync(stylesheetPath, ".chord-dot { fill: red; }");
      const code = await run([
        "--neck",
        "--notes",
        '[{"string":6,"fret":3}]',
        "--muted",
        "1",
        "--tuning",
        "DADGBE",
        "--label",
        "My Neck",
        "--label-tuning",
        "--stylesheet",
        stylesheetPath,
        "--output",
        outPath,
      ]);
      expect(code).toBe(0);
      const written = fs.readFileSync(outPath, "utf8");
      expect(written).toContain('class="neck-diagram"');
      expect(written).toContain("My Neck");
      expect(written).toContain(".chord-dot { fill: red; }");
      expect(written).toContain('class="chord-glyph chord-glyph-mute chord-glyph-string-1"');
      expect(written).toContain("chord-tuning-label");
    });

    it("--svg-defs embeds raw SVG markup as a <defs> element under --neck", async () => {
      const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
      const code = await run(["--neck", "--notes", '[{"string":6,"fret":3}]', "--svg-defs", defs]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("<defs>" + defs + "</defs>");
    });

    it("--label-pitches auto-labels a fretted marker with no explicit label", async () => {
      const code = await run(["--neck", "--notes", "6:3", "--label-pitches"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">G<"); // string 6 fret 3, standard tuning
    });

    it("a marker's shape flows through to its dot", async () => {
      const code = await run(["--neck", "--notes", "6:3:R:root:2:square"]);
      expect(code).toBe(0);
      expect(cap.stdout).toMatch(/<rect class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-square"/);
    });
  });

  describe("--file (document mode)", () => {
    it("renders a type: chord document", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\nlabel: "A"\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">A<");
    });

    it("renders a type: scale document", async () => {
      const docPath = tmpPath("scale.yaml");
      fs.writeFileSync(docPath, 'type: scale\nnotes: "6:3:R"\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain(">R<");
    });

    it("renders a type: neck document", async () => {
      const docPath = tmpPath("neck.yaml");
      fs.writeFileSync(docPath, 'type: neck\nnotes: "6:7:R"\nfirstFret: 5\nlastFret: 17\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain('class="neck-diagram"');
    });

    it("expands a type: neck document's firstFret/lastFret to fit a note outside the range, and prints a stderr warning", async () => {
      const docPath = tmpPath("neck-wide.yaml");
      fs.writeFileSync(docPath, 'type: neck\nnotes: "6:3;5:20"\nfirstFret: 0\nlastFret: 12\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stderr).toContain("warning:");
      expect(cap.stderr).toContain("[0, 12]");
      expect(cap.stderr).toContain("[0, 20]");
    });

    it("renders a type: chord document with noteShapes", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "320003"\nnoteShapes: \'{"6":"square"}\'\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stdout).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
    });

    it("renders a type: scale document with a marker's shape", async () => {
      const docPath = tmpPath("scale.yaml");
      fs.writeFileSync(docPath, 'type: scale\nnotes: "6:3:R:root:2:triangle"\n');
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      expect(cap.stdout).toMatch(/<polygon class="chord-dot chord-dot-string-6[^"]*chord-dot-shape-triangle"/);
    });

    it("renders a type: chords document (inline csv)", async () => {
      const docPath = tmpPath("chords.yaml");
      fs.writeFileSync(docPath, "type: chords\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n");
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
      const nested = (cap.stdout.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
      expect(nested).toBe(2);
    });

    it("--file combined with a notation argument exits 1 cleanly", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\n');
      const code = await run(["320003", "--file", docPath]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr).toContain("--file");
    });

    it("--file combined with --notes exits 1 cleanly", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\n');
      const code = await run(["--file", docPath, "--notes", "6:3"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--file");
    });

    it("--file combined with --bulk exits 1 cleanly", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\n');
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const code = await run(["--file", docPath, "--bulk", csvPath]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--file");
    });

    it("--file combined with --neck exits 1 cleanly", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\n');
      const code = await run(["--file", docPath, "--neck"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--file");
    });

    it("--file combined with an explicitly-given field flag (e.g. --label) exits 1 cleanly", async () => {
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, 'type: chord\nnotation: "x02220"\n');
      const code = await run(["--file", docPath, "--label", "foo"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--label");
      expect(cap.stderr).toContain("--file");
    });

    it("--file with --columns NOT explicitly given does not false-positive (it always carries a default)", async () => {
      const docPath = tmpPath("chords.yaml");
      fs.writeFileSync(docPath, "type: chords\ncsv: |\n  notes\n  x02220\n");
      const code = await run(["--file", docPath]);
      expect(code).toBe(0);
    });

    it("--file combined with an explicitly-given --columns exits 1 cleanly", async () => {
      const docPath = tmpPath("chords.yaml");
      fs.writeFileSync(docPath, "type: chords\ncsv: |\n  notes\n  x02220\n");
      const code = await run(["--file", docPath, "--columns", "6"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--columns");
      expect(cap.stderr).toContain("--file");
    });

    it("--output overrides the document's own output: field", async () => {
      const outPath = tmpPath("doc-output.svg");
      const overridePath = tmpPath("override.svg");
      const docPath = tmpPath("chord.yaml");
      fs.writeFileSync(docPath, `type: chord\nnotation: "x02220"\noutput: "${outPath}"\n`);
      const code = await run(["--file", docPath, "--output", overridePath]);
      expect(code).toBe(0);
      expect(fs.existsSync(overridePath)).toBe(true);
      expect(fs.existsSync(outPath)).toBe(false);
    });

    it("malformed YAML exits 1 cleanly instead of crashing", async () => {
      const docPath = tmpPath("bad.yaml");
      fs.writeFileSync(docPath, "type: chord\n  bad: [unclosed\n");
      const code = await run(["--file", docPath]);
      expect(code).toBe(1);
      expect(cap.stdout).toBe("");
      expect(cap.stderr.length).toBeGreaterThan(0);
    });

    it("a nonexistent document file exits 1 cleanly", async () => {
      const code = await run(["--file", tmpPath("does-not-exist.yaml")]);
      expect(code).toBe(1);
      expect(cap.stderr.length).toBeGreaterThan(0);
    });
  });

  describe("--output .yaml/.yml/.json (write a chart document instead of rendering)", () => {
    it("a plain chord invocation writes a type: chord document", async () => {
      const out = tmpPath("chord.yaml");
      const code = await run(["320003", "--label", "G", "--root", "6", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: chord");
      // All-digit notation needs quoting -- unquoted, it'd parse back as
      // a YAML number instead of a string (the real `yaml` package's own
      // stringify does this automatically, verified correct elsewhere
      // this session against its parse()).
      expect(text).toContain('notation: "320003"');
      expect(text).toContain("label: G");
      // --root merges into noteClasses (see documentFromSingleOptions) --
      // the document reflects the resolved result, not the original flag.
      expect(text).toContain("noteClasses:");
      expect(text).toContain("root");
    });

    it("a chord invocation with --note-shapes writes noteShapes into the document", async () => {
      const out = tmpPath("chord.yaml");
      const code = await run(["320003", "--note-shapes", '{"6":"square"}', "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: chord");
      expect(text).toContain("noteShapes:");
      expect(text).toContain("square");
    });

    it("a scale-chart invocation writes a type: scale document with a native notes list", async () => {
      const out = tmpPath("scale.yaml");
      const code = await run(["--notes", "6:3:R:root;6:5:2", "--muted", "1,2", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: scale");
      expect(text).toMatch(/notes:\s*\n\s*-\s*string:\s*6/);
      expect(text).toContain("mutedStrings: 1,2");
    });

    it("a scale-chart invocation with a marker shape writes shape into the native notes list", async () => {
      const out = tmpPath("scale.yaml");
      const code = await run(["--notes", "6:3:R:root:2:square", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("shape: square");
    });

    it("a scale-chart invocation with --label-pitches writes labelPitches: true into the document", async () => {
      const out = tmpPath("scale.yaml");
      const code = await run(["--notes", "6:3", "--label-pitches", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: scale");
      expect(text).toContain("labelPitches: true");
    });

    it("a scale-chart invocation with --no-label-frets writes labelFrets: false into the document, and it round-trips via --file", async () => {
      const docPath = tmpPath("scale.yaml");
      const writeCode = await run(["--notes", "6:3", "--no-label-frets", "--output", docPath]);
      expect(writeCode).toBe(0);
      const text = fs.readFileSync(docPath, "utf8");
      expect(text).toContain("labelFrets: false");

      const svgPath = tmpPath("scale.svg");
      const renderCode = await run(["--file", docPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).not.toContain("chord-fret-label");
    });

    it("--compact-notes writes a scale document's notes as compact notation, one marker per line, and it round-trips via --file", async () => {
      const docPath = tmpPath("scale-compact.yaml");
      const writeCode = await run([
        "--notes",
        "6:3:R:root;6:5:2;5:2:b3",
        "--compact-notes",
        "--output",
        docPath,
      ]);
      expect(writeCode).toBe(0);
      const text = fs.readFileSync(docPath, "utf8");
      expect(text).toContain("notes: |");
      expect(text).toContain("6:3:R:root\n");
      expect(text).toContain("6:5:2\n");
      expect(text).toContain("5:2:b3");
      expect(text).not.toContain("- { string:");

      const svgPath = tmpPath("scale-compact.svg");
      const renderCode = await run(["--file", docPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      const svg = fs.readFileSync(svgPath, "utf8");
      expect(svg).toMatch(/class="chord-dot chord-dot-string-6 root/);
      expect(svg).toContain(">b3<");
    });

    it("--compact-notes writes a neck document's single-marker notes as a plain scalar, not a block", async () => {
      const docPath = tmpPath("neck-compact.yaml");
      const code = await run(["--neck", "--notes", "6:3:R", "--compact-notes", "--output", docPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(docPath, "utf8");
      expect(text).toContain("notes: 6:3:R\n");
      expect(text).not.toContain("notes: |");
    });

    it("--compact-notes has no effect on a chord-notation document (no notes field to compact)", async () => {
      const docPath = tmpPath("chord-compact.yaml");
      const code = await run(["x02220", "--compact-notes", "--output", docPath]);
      expect(code).toBe(0);
      const text = fs.readFileSync(docPath, "utf8");
      expect(text).toContain("type: chord");
      expect(text).not.toContain("notes");
    });

    it("combining --compact-notes with --file exits 1 cleanly instead of crashing", async () => {
      const docPath = tmpPath("scale.yaml");
      fs.writeFileSync(docPath, 'type: scale\nnotes: "6:3"\n');
      const code = await run(["--file", docPath, "--compact-notes"]);
      expect(code).toBe(1);
      expect(cap.stderr).toContain("--compact-notes");
    });

    it("a --neck invocation writes a type: neck document with firstFret/lastFret", async () => {
      const out = tmpPath("neck.yaml");
      const code = await run(["--neck", "--notes", "6:7:R", "--first-fret", "5", "--last-fret", "17", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: neck");
      expect(text).toContain("firstFret: 5");
      expect(text).toContain("lastFret: 17");
    });

    it("a --neck invocation with --label-pitches writes labelPitches: true into the document", async () => {
      const out = tmpPath("neck.yaml");
      const code = await run(["--neck", "--notes", "6:3", "--label-pitches", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: neck");
      expect(text).toContain("labelPitches: true");
    });

    it("writes genuine JSON for a .json output path", async () => {
      const out = tmpPath("chord.json");
      const code = await run(["x02220", "--label", "A", "--output", out]);
      expect(code).toBe(0);
      const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(parsed).toMatchObject({ type: "chord", notation: "x02220", label: "A" });
    });

    it("embeds --stylesheet's file content inline (not a path) in the generated document", async () => {
      const cssPath = tmpPath("style.css");
      fs.writeFileSync(cssPath, ".chord-dot { fill: red; }");
      const out = tmpPath("chord.yaml");
      const code = await run(["x02220", "--stylesheet", cssPath, "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain(".chord-dot { fill: red; }");
      expect(text).not.toContain(cssPath);
    });

    it("embeds --svg-defs-file's file content inline (not a path) in the generated document, and it round-trips via --file", async () => {
      const defsPath = tmpPath("defs.svg");
      const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
      fs.writeFileSync(defsPath, defs);
      const out = tmpPath("chord.yaml");
      const code = await run(["x02220", "--svg-defs-file", defsPath, "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain(defs);
      expect(text).not.toContain(defsPath);

      const svgPath = tmpPath("chord.svg");
      const renderCode = await run(["--file", out, "--output", svgPath]);
      expect(renderCode).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).toContain("<defs>" + defs + "</defs>");
    });

    it("still validates the notation and exits 1 cleanly for invalid input, without writing a file", async () => {
      const out = tmpPath("bad.yaml");
      const code = await run(["qqqqqq", "--output", out]);
      expect(code).toBe(1);
      expect(fs.existsSync(out)).toBe(false);
    });

    it("a document written from one invocation can be rendered via --file", async () => {
      const docPath = tmpPath("roundtrip.yaml");
      const writeCode = await run(["x02220", "--label", "A Major", "--output", docPath]);
      expect(writeCode).toBe(0);

      const svgPath = tmpPath("roundtrip.svg");
      const renderCode = await run(["--file", docPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      const svg = fs.readFileSync(svgPath, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("A Major");
    });

    it("a --bulk invocation writes a type: chords document with the CSV embedded inline", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes,label\nx02220,A\n320003,G\n");
      const out = tmpPath("chords.yaml");
      const code = await run(["--bulk", csvPath, "--columns", "2", "--collection-label", "Open Chords", "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain("type: chords");
      expect(text).toContain("columns: 2");
      expect(text).toContain("collectionLabel: Open Chords");
      expect(text).toContain("notes,label");
      expect(text).toContain("x02220,A");
    });

    it("--bulk with --stylesheet embeds the CSS content inline (not a path) in the generated document", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const cssPath = tmpPath("style.css");
      fs.writeFileSync(cssPath, ".root { fill: red; }");
      const out = tmpPath("chords.yaml");
      const code = await run(["--bulk", csvPath, "--stylesheet", cssPath, "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain(".root { fill: red; }");
      expect(text).not.toContain(cssPath);
      // Not smuggled into defaults either (which rejects a
      // stylesheet/stylesheetPath key entirely -- see ChordsDocument's
      // own doc comment).
      expect(text).not.toContain("defaults:\n  stylesheetPath");
    });

    it("--bulk with --svg-defs embeds the defs content inline (not a path) in the generated document", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes\nx02220\n");
      const defs = '<linearGradient id="g" />';
      const out = tmpPath("chords.yaml");
      const code = await run(["--bulk", csvPath, "--svg-defs", defs, "--output", out]);
      expect(code).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      expect(text).toContain(defs);

      const svgPath = tmpPath("chords.svg");
      const renderCode = await run(["--file", out, "--output", svgPath]);
      expect(renderCode).toBe(0);
      expect(fs.readFileSync(svgPath, "utf8")).toContain("<defs>" + defs + "</defs>");
    });

    it("a --bulk-written document round-trips through --file", async () => {
      const csvPath = tmpPath("chords.csv");
      fs.writeFileSync(csvPath, "notes,label\nx02220,A\n320003,G\n");
      const docPath = tmpPath("chords-roundtrip.yaml");
      const writeCode = await run(["--bulk", csvPath, "--output", docPath]);
      expect(writeCode).toBe(0);

      const svgPath = tmpPath("chords-roundtrip.svg");
      const renderCode = await run(["--file", docPath, "--output", svgPath]);
      expect(renderCode).toBe(0);
      const svg = fs.readFileSync(svgPath, "utf8");
      const nested = (svg.match(/<svg[^>]*class="chord-chart"/g) ?? []).length;
      expect(nested).toBe(2);
    });
  });

  describe("--version / --help", () => {
    it("--version prints package.json's version and exits 0", async () => {
      const code = await run(["--version"]);
      expect(code).toBe(0);
      expect(cap.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("-V does the same as --version", async () => {
      const code = await run(["-V"]);
      expect(code).toBe(0);
      expect(cap.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("--help exits 0 and includes the Modes summary and the full option list", async () => {
      const code = await run(["--help"]);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("Modes (pick exactly one)");
      expect(cap.stdout).toContain("--bulk <path>");
      expect(cap.stdout).toContain("--file <path>");
    });
  });
});
