import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTriads } from "./triadsCli";
import { parseFloor, parseStrings } from "./triads";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (out.push(String(c)), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => (err.push(String(c)), true));
  return {
    restore: () => (o.mockRestore(), e.mockRestore()),
    get stdout() {
      return out.join("");
    },
    get stderr() {
      return err.join("");
    },
  };
}

describe("parseStrings", () => {
  it("accepts ranges, lists, and mixes", () => {
    expect(parseStrings("1-4")).toEqual([1, 2, 3, 4]);
    expect(parseStrings("4,3, 2")).toEqual([2, 3, 4]);
    expect(parseStrings("1-3,5")).toEqual([1, 2, 3, 5]);
    expect(() => parseStrings("a")).toThrow();
  });
});

describe("parseFloor", () => {
  it("reads one number as a fret and two as string+fret", () => {
    expect(parseFloor("5")).toEqual({ kind: "fret", fret: 5 });
    expect(parseFloor("5,3")).toEqual({ kind: "pitch", string: 5, fret: 3 });
    expect(parseFloor("5:3")).toEqual({ kind: "pitch", string: 5, fret: 3 });
    expect(parseFloor("5 3")).toEqual({ kind: "pitch", string: 5, fret: 3 });
    expect(() => parseFloor("1,2,3")).toThrow();
  });
});

describe("runTriads", () => {
  let cap: ReturnType<typeof capture>;
  beforeEach(() => (cap = capture()));
  afterEach(() => cap.restore());

  it("writes a CSV to stdout", async () => {
    expect(await runTriads(["D", "Bm", "G", "A", "--strings", "1-3"])).toBe(0);
    const lines = cap.stdout.trim().split("\n");
    expect(lines[0]).toBe("notes,label,root,string-labels");
    expect(lines.slice(1).map((l) => l.split(",")[1])).toEqual(["D", "Bm", "G", "A"]);
  });

  it("writes to --output", async () => {
    const file = path.join(os.tmpdir(), `triads-${process.pid}.csv`);
    try {
      expect(await runTriads(["G", "C", "--output", file])).toBe(0);
      expect(fs.readFileSync(file, "utf8")).toMatch(/^notes,label,root,string-labels\n/);
      expect(cap.stdout).toBe("");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("includes the tuning column when --tuning is given", async () => {
    expect(await runTriads(["D", "G", "--tuning", "DADGBE"])).toBe(0);
    expect(cap.stdout.split("\n")[0]).toMatch(/,tuning$/);
  });

  it("reports bad input on stderr", async () => {
    expect(await runTriads(["C13"])).toBe(1);
    expect(cap.stderr).toMatch(/unsupported chord quality/);
    expect(await runTriads(["C", "--direction", "sideways"])).toBe(1);
    expect(await runTriads(["C", "--key", "G"])).toBe(1);
    expect(cap.stderr).toMatch(/key's root/);
  });
});
