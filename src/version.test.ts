import { describe, it, expect } from "vitest";
import { VERSION, compareVersions, isVersion } from "./version";

describe("VERSION", () => {
  it("is package.json's version", () => {
    expect(VERSION).toBe(require("../package.json").version);
    expect(isVersion(VERSION)).toBe(true);
  });
});

describe("isVersion", () => {
  it("accepts X.Y.Z with optional v, prerelease, and build metadata", () => {
    for (const v of ["0.1.0", "v1.2.3", "1.2.3-rc.1", "1.2.3+release", "1.2.3-beta.2+release"]) {
      expect(isVersion(v)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const v of ["", "1", "1.2", "1.2.3.4", "next", "1.2.x"]) {
      expect(isVersion(v)).toBe(false);
    }
  });
});

describe("compareVersions", () => {
  it("orders by semver precedence", () => {
    const ordered = [
      "0.9.9",
      "0.10.0-alpha",
      "0.10.0-alpha.1",
      "0.10.0-alpha.beta",
      "0.10.0-beta.2",
      "0.10.0-beta.11",
      "0.10.0-rc.1",
      "0.10.0",
      "0.10.1",
      "1.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
    }
  });

  it("ignores a leading v and build metadata", () => {
    expect(compareVersions("v1.2.3", "1.2.3+release")).toBe(0);
  });

  it("throws for a non-version", () => {
    expect(() => compareVersions("1.2.3", "nope")).toThrow(/nope/);
  });
});
