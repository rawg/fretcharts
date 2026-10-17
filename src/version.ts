/**
 * The running FretCharts version, and the semver comparison FretCharts
 * files use to tell whether they were written by a newer release.
 *
 * package.json's `version` is the single source of truth: the release
 * workflow refuses a tag that doesn't match it, so a build from any tagged
 * commit reports that tag's version -- including an npm/tarball install,
 * which has no git history to read a tag from.
 */

// Read at runtime (not a TS import) so it works identically whether this
// runs as compiled dist/version.js or as src/version.ts under a test
// runner -- "../package.json" resolves the same way from both, since src/
// and dist/ are both direct children of the repo root. tsconfig's rootDir
// ("src") would reject a real `import` of a file outside it; require()
// isn't compile-checked, so it isn't affected. esbuild inlines it for the
// browser bundle.
export const VERSION: string = (require("../package.json") as { version: string }).version;

/** `X.Y.Z`, an optional `-prerelease`, and optional `+build` metadata. A leading `v` is tolerated. */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function isVersion(text: string): boolean {
  return SEMVER.test(text);
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum !== bNum) return aNum ? -1 : 1; // numeric identifiers sort first
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence: negative if `a` is older than `b`, positive if newer,
 * 0 if equal. A prerelease sorts before its release (`0.2.0-rc.1` <
 * `0.2.0`); build metadata is ignored.
 *
 * @throws {Error} if either side isn't a version string (see isVersion).
 */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma || !mb) throw new Error(`not a version: ${JSON.stringify(ma ? b : a)}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  const preA = ma[4];
  const preB = mb[4];
  if (preA === undefined || preB === undefined) {
    return preA === preB ? 0 : preA === undefined ? 1 : -1;
  }
  const idsA = preA.split(".");
  const idsB = preB.split(".");
  for (let i = 0; i < Math.min(idsA.length, idsB.length); i++) {
    const diff = compareIdentifiers(idsA[i], idsB[i]);
    if (diff !== 0) return diff;
  }
  return Math.sign(idsA.length - idsB.length);
}
