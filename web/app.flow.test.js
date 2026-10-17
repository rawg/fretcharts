/**
 * End-to-end DOM-level tests for the web UI's upload -> edit -> download
 * flow: uploading a document auto-populates the tab matching its type,
 * and any tab's "Document" (download) button serializes its current
 * (possibly just-edited) field values back into a document file.
 *
 * Each test builds a fresh, isolated jsdom window from the real
 * index.html + app.js + documentSync.js (no bundler, no build step --
 * same files the browser actually loads), rather than relying on
 * vitest's global jsdom environment: this keeps every test's DOM fully
 * isolated and lets the rest of the suite (src/**) stay on the default
 * node environment untouched.
 *
 * app.js's real entry point is a `DOMContentLoaded` listener; rather than
 * depend on jsdom's event timing relative to when these scripts get
 * evaluated, loadApp() calls the same init functions that listener calls,
 * directly and deterministically. jsdom does still fire DOMContentLoaded
 * afterward, so loadApp() keeps app.js from registering that listener at
 * all -- otherwise every init would run a second time.
 */

import { compareVersions, isVersion } from '../src/version';
import { describe, it, expect } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

// `lastTab` stands in for the tab a returning visitor used last (see
// restoreLastTab). It defaults to Single chord so most tests start on a
// form, without the Start tab's gallery rendering in the background;
// pass null to simulate a first visit.
function loadApp(url, { lastTab = 'tab-single' } = {}) {
  const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
  // Suppresses jsdom's own "not implemented" noise (e.g. anchor-click
  // navigation for the download links below) without swallowing genuine
  // console output from the page's own scripts.
  const virtualConsole = new VirtualConsole();
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });

  const dom = new JSDOM(html, { url: url || 'http://localhost/', runScripts: 'dangerously', virtualConsole });
  const window = dom.window;

  // Stands in for engine.js (a build artifact -- see scripts/build-web.mjs),
  // so these tests don't depend on a build; tests that submit a form
  // replace render() with stubRender below.
  window.ChordChartsEngine = {
    render: function () {
      return Promise.reject(new Error('no render stubbed for this test'));
    },
  };

  // documentSync.js/app.js are loaded as <script src> tags in index.html,
  // which jsdom won't fetch here (no resource loading configured) -- run
  // their real file contents via actual injected <script> elements
  // instead of window.eval(): both start with 'use strict', and a
  // strict-mode indirect eval's top-level function declarations stay
  // confined to the eval's own scope rather than attaching to `window`
  // (unlike a real <script> tag, strict or not, which always does) --
  // verified experimentally; this matters here since loadApp() below
  // needs to call app.js's init functions directly afterward.
  const addEventListener = window.document.addEventListener;
  window.document.addEventListener = function (type) {
    if (type === 'DOMContentLoaded') return;
    return addEventListener.apply(this, arguments);
  };
  ['documentSync.js', 'gallery.js', 'app.js'].forEach(function (file) {
    var script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(WEB_DIR, file), 'utf8');
    window.document.body.appendChild(script);
  });

  if (lastTab) window.localStorage.setItem('fretcharts.lastTab', lastTab);
  else window.localStorage.removeItem('fretcharts.lastTab');

  window.initModeToggle();
  ['single', 'bulk'].forEach(function (formPrefix) {
    window.JSON_OR_PER_STRING_FIELD_NAMES.forEach(function (name) {
      window.initJsonOrPerStringField(formPrefix + '-' + name);
    });
  });
  ['single', 'bulk', 'triads', 'scale', 'neck'].forEach(function (formPrefix) {
    window.initThemePicker(formPrefix);
  });
  window.initSingleForm();
  window.initBulkForm();
  window.initTriadsForm();
  window.initMarkerRows('scale');
  window.initScaleForm();
  window.initMarkerRows('neck');
  window.initNeckForm();
  window.initDocumentUpload();
  window.initDocumentForm();
  window.initDownloadButtons();
  window.initShareButtons();
  window.initDocumentPreviews();
  window.initQuickExamples();
  window.initGallery();
  window.initStartPrint();
  window.restoreLastTab();
  window.loadFromPermalink();

  return window;
}

function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  return new Promise(function (resolve, reject) {
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > (timeoutMs || 1000)) return reject(new Error('waitFor timed out'));
      setTimeout(check, 5);
    })();
  });
}

/** Simulates picking `text` as a local file in the Document tab's upload-file input, then waits for app.js's FileReader-driven handling to finish. */
async function uploadFile(window, text, filename) {
  const input = window.document.getElementById('upload-file');
  const textArea = window.document.getElementById('document-text');
  const file = new window.File([text], filename || 'test.yaml', { type: 'text/yaml' });
  Object.defineProperty(input, 'files', { value: [file], writable: false, configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await waitFor(function () {
    return textArea.value === text;
  });
}

function readBlobText(window, blob) {
  return new Promise(function (resolve, reject) {
    const reader = new window.FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ''));
    };
    reader.onerror = function () {
      reject(new Error('failed to read blob'));
    };
    reader.readAsText(blob);
  });
}

/** Clicks a tab's "Document" (download) button and returns the downloaded text, stubbing URL.createObjectURL to capture the Blob (jsdom doesn't implement it, and real browsers navigating a blob: URL isn't observable in a test anyway). */
async function clickDownload(window, prefix) {
  let capturedBlob;
  window.URL.createObjectURL = function (blob) {
    capturedBlob = blob;
    return 'blob:mock';
  };
  window.URL.revokeObjectURL = function () {};
  window.document.getElementById(prefix + '-download').click();
  expect(capturedBlob).toBeTruthy();
  return readBlobText(window, capturedBlob);
}

/** Clicks a tab's "Copy link" button, stubbing navigator.clipboard.writeText (jsdom doesn't implement it) to capture what would have been copied. Waits a tick for the copy promise to settle before returning. */
async function clickShare(window, prefix) {
  let capturedText;
  window.navigator.clipboard = {
    writeText: function (text) {
      capturedText = text;
      return Promise.resolve();
    },
  };
  window.document.getElementById(prefix + '-share').click();
  await waitFor(function () {
    return capturedText !== undefined;
  });
  return capturedText;
}

function isActive(window, panelId) {
  return window.document.getElementById(panelId).classList.contains('active');
}

describe('web UI: document upload populates the matching tab', () => {
  it('a type: chord document populates and switches to the Single chord tab', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: chord\nnotation: x02220\nlabel: A Major\nroot: "5"\n');

    expect(isActive(window, 'panel-single')).toBe(true);
    expect(window.document.getElementById('single-notation').value).toBe('x02220');
    expect(window.document.getElementById('single-label').value).toBe('A Major');
    expect(window.document.getElementById('single-root').value).toBe('5');
  });

  it('a type: scale document populates marker rows and switches to the Scale chart tab', async () => {
    const window = loadApp();
    await uploadFile(
      window,
      'type: scale\nlabel: Test Scale\nnotes:\n  - { string: 6, fret: 3, label: R }\n  - { string: 5, fret: 2, label: b3 }\n',
    );

    expect(isActive(window, 'panel-scale')).toBe(true);
    expect(window.document.getElementById('scale-label').value).toBe('Test Scale');
    const rows = window.document.querySelectorAll('#scale-marker-rows .marker-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.marker-string').value).toBe('6');
    expect(rows[0].querySelector('.marker-fret').value).toBe('3');
    expect(rows[0].querySelector('.marker-label').value).toBe('R');
    expect(rows[1].querySelector('.marker-fret').value).toBe('2');
  });

  it('a type: neck document populates firstFret/lastFret and switches to the Neck diagram tab', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: neck\nnotes: "6:7:R"\nfirstFret: 5\nlastFret: 17\n');

    expect(isActive(window, 'panel-neck')).toBe(true);
    expect(window.document.getElementById('neck-firstFret').value).toBe('5');
    expect(window.document.getElementById('neck-lastFret').value).toBe('17');
    const rows = window.document.querySelectorAll('#neck-marker-rows .marker-row');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.marker-string').value).toBe('6');
  });

  it('a type: chords document populates the CSV and switches to the Multiple chords tab', async () => {
    const window = loadApp();
    await uploadFile(
      window,
      'type: chords\ncollectionLabel: Open Chords\ncsv: |\n  notes,label\n  x02220,A\n  320003,G\n',
    );

    expect(isActive(window, 'panel-bulk')).toBe(true);
    expect(window.document.getElementById('bulk-collectionLabel').value).toBe('Open Chords');
    expect(window.document.getElementById('bulk-csv').value).toBe('notes,label\nx02220,A\n320003,G\n');
  });

  it('a document with an external stylesheetFile shows a message in the Document tab\'s error box and switches there', async () => {
    const window = loadApp();
    // Triggering the file input doesn't require actually being on the
    // Document tab in this test (jsdom doesn't enforce visibility the way
    // clicking through a real browser would) -- start from the
    // Single chord tab specifically (loadApp's default), to prove the explicit switch-to-
    // Document-on-failure behavior itself, not just "it stayed put".
    await uploadFile(window, 'type: chord\nnotation: x02220\nstylesheetFile: ./theme.css\n');

    expect(isActive(window, 'panel-document')).toBe(true);
    expect(isActive(window, 'panel-single')).toBe(false);
    expect(window.document.getElementById('document-error').classList.contains('hidden')).toBe(false);
    expect(window.document.getElementById('document-error').textContent).toContain('stylesheetFile');
  });

  it('a document with an external defsFile shows a message in the Document tab\'s error box and switches there', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: chord\nnotation: x02220\ndefsFile: ./gradient.svg\n');

    expect(isActive(window, 'panel-document')).toBe(true);
    expect(window.document.getElementById('document-error').classList.contains('hidden')).toBe(false);
    expect(window.document.getElementById('document-error').textContent).toContain('defsFile');
  });

  it("unparseable content shows a message in the Document tab's error box, with the raw text loaded", async () => {
    const window = loadApp();
    const raw = 'not a valid document at all {{{';
    await uploadFile(window, raw);

    expect(isActive(window, 'panel-document')).toBe(true);
    expect(window.document.getElementById('document-error').classList.contains('hidden')).toBe(false);
    expect(window.document.getElementById('document-text').value).toBe(raw);
  });
});

describe('web UI: download document from any tab', () => {
  it('the Single chord tab downloads a type: chord document reflecting its current fields', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    window.document.getElementById('single-label').value = 'A Major';

    const text = await clickDownload(window, 'single');
    expect(text).toContain('type: chord');
    expect(text).toContain('notation: x02220');
    expect(text).toContain('label: A Major');
  });

  it('the Single chord tab downloads its SVG defs field, and it round-trips back on upload', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    window.document.getElementById('single-defs').value = '<linearGradient id="g" />';

    const text = await clickDownload(window, 'single');
    expect(text).toContain('defs:');
    expect(window.DocumentSync.parse(text).fields.defs).toBe('<linearGradient id="g" />');

    await uploadFile(window, text);
    expect(window.document.getElementById('single-defs').value).toBe('<linearGradient id="g" />');
  });

  it('the Single chord tab downloads its Transpose field (including 0), and it round-trips back on upload', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    window.document.getElementById('single-transpose').value = '2';

    const text = await clickDownload(window, 'single');
    expect(text).toContain('transpose: 2');

    await uploadFile(window, text);
    expect(window.document.getElementById('single-transpose').value).toBe('2');

    // 0 is a meaningful, explicit value -- must not be treated as blank.
    window.document.getElementById('single-transpose').value = '0';
    const zeroText = await clickDownload(window, 'single');
    expect(zeroText).toContain('transpose: 0');
  });

  it('the Neck diagram tab downloads its Transpose field alongside firstFret/lastFret', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '7';
    window.document.getElementById('neck-firstFret').value = '5';
    window.document.getElementById('neck-lastFret').value = '17';
    window.document.getElementById('neck-transpose').value = '3';

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('firstFret: 5');
    expect(text).toContain('lastFret: 17');
    expect(text).toContain('transpose: 3');
  });

  it('the Scale chart tab\'s "Bake into notes" checkbox writes the shifted fret directly and omits transpose:', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    row.querySelector('.marker-label').value = 'R';
    window.document.getElementById('scale-transpose').value = '2';
    window.document.getElementById('scale-bakeTranspose').checked = true;

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('notes: 6:5:R');
    expect(text).not.toContain('transpose');
  });

  it('the Neck diagram tab\'s "Bake into notes" checkbox shifts markers and firstFret/lastFret, omitting transpose:', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '7';
    row.querySelector('.marker-label').value = 'R';
    window.document.getElementById('neck-firstFret').value = '5';
    window.document.getElementById('neck-lastFret').value = '17';
    window.document.getElementById('neck-transpose').value = '3';
    window.document.getElementById('neck-bakeTranspose').checked = true;

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('notes: 6:10:R');
    expect(text).toContain('firstFret: 8');
    expect(text).toContain('lastFret: 20');
    expect(text).not.toContain('transpose');
  });

  it('the Neck diagram tab starts with no bracket rows and adds one per "+ Add bracket" click', () => {
    const window = loadApp();
    const rows = () => window.document.querySelectorAll('#neck-bracket-rows .bracket-row');
    expect(rows()).toHaveLength(0);
    window.document.getElementById('neck-add-bracket').click();
    window.document.getElementById('neck-add-bracket').click();
    expect(rows()).toHaveLength(2);
    rows()[0].querySelector('.marker-row-remove').click();
    expect(rows()).toHaveLength(1);
  });

  it('the Neck diagram tab downloads its bracket rows, skipping incomplete ones and defaulting a blank end fret', async () => {
    const window = loadApp();
    window.document.querySelector('#neck-marker-rows .marker-row .marker-fret').value = '3';
    const add = window.document.getElementById('neck-add-bracket');
    add.click();
    add.click();
    add.click();
    const rows = window.document.querySelectorAll('#neck-bracket-rows .bracket-row');
    rows[0].querySelector('.bracket-start').value = '2';
    rows[0].querySelector('.bracket-end').value = '5';
    rows[0].querySelector('.bracket-label').value = 'C shape';
    rows[0].querySelector('.bracket-class').value = 'caged-c';
    rows[1].querySelector('.bracket-start').value = '7';
    rows[1].querySelector('.bracket-label').value = 'one fret';
    rows[2].querySelector('.bracket-start').value = '9'; // no label -- skipped

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('brackets: |\n  2-5:C shape:caged-c\n  7-7:one fret\n');
    expect(text).not.toContain('9-');
  });

  it('the Neck diagram tab\'s "Bake into notes" checkbox shifts brackets too', async () => {
    const window = loadApp();
    window.document.querySelector('#neck-marker-rows .marker-row .marker-fret').value = '3';
    window.document.getElementById('neck-add-bracket').click();
    const row = window.document.querySelector('#neck-bracket-rows .bracket-row');
    row.querySelector('.bracket-start').value = '2';
    row.querySelector('.bracket-end').value = '5';
    row.querySelector('.bracket-label').value = 'C';
    window.document.getElementById('neck-transpose').value = '3';
    window.document.getElementById('neck-bakeTranspose').checked = true;

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('brackets: 5-8:C');
    expect(text).not.toContain('transpose');
  });

  it('the Scale chart tab has its own bracket rows, downloaded into a type: scale document', async () => {
    const window = loadApp();
    window.document.querySelector('#scale-marker-rows .marker-row .marker-fret').value = '5';
    window.document.getElementById('scale-add-bracket').click();
    expect(window.document.querySelectorAll('#neck-bracket-rows .bracket-row')).toHaveLength(0);
    const row = window.document.querySelector('#scale-bracket-rows .bracket-row');
    row.querySelector('.bracket-start').value = '5';
    row.querySelector('.bracket-end').value = '7';
    row.querySelector('.bracket-label').value = 'Box 1';

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('type: scale');
    expect(text).toContain('brackets: 5-7:Box 1');
  });

  it('a type: scale document with brackets populates the Scale chart tab\'s bracket rows', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: scale\nnotes: "6:5"\nbrackets: "5-7:Box 1"\n');
    const rows = window.document.querySelectorAll('#scale-bracket-rows .bracket-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.bracket-label').value).toBe('Box 1');
  });

  it('a type: neck document with brackets populates bracket rows', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: neck\nnotes: "6:7:R"\nbrackets: "5-8:E shape;7-10:D shape:caged-d"\n');
    const rows = window.document.querySelectorAll('#neck-bracket-rows .bracket-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('.bracket-start').value).toBe('7');
    expect(rows[1].querySelector('.bracket-end').value).toBe('10');
    expect(rows[1].querySelector('.bracket-label').value).toBe('D shape');
    expect(rows[1].querySelector('.bracket-class').value).toBe('caged-d');
  });

  it('leaving "Bake into notes" unchecked keeps the original frets plus a transpose: field (default)', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    window.document.getElementById('scale-transpose').value = '2';

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('notes: 6:3');
    expect(text).toContain('transpose: 2');
  });

  it('baking is a no-op without a Transpose value, even if "Bake into notes" is checked', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    window.document.getElementById('scale-bakeTranspose').checked = true;

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('notes: 6:3');
    expect(text).not.toContain('transpose');
  });

  it('alerts and leaves notes unbaked when baking would put a marker below the nut', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '1';
    window.document.getElementById('scale-transpose').value = '-2';
    window.document.getElementById('scale-bakeTranspose').checked = true;
    let alertCalls = [];
    window.alert = function (message) {
      alertCalls.push(message);
    };

    const text = await clickDownload(window, 'scale');
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0]).toContain('below the nut');
    // Left unbaked -- the original fret plus the transpose: field survive.
    expect(text).toContain('notes: 6:1');
    expect(text).toContain('transpose: -2');
  });

  it('the live preview silently leaves notes unbaked (no alert) when baking would put a marker below the nut', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '1';
    window.document.getElementById('scale-bakeTranspose').checked = true;
    let alertCalls = [];
    window.alert = function (message) {
      alertCalls.push(message);
    };

    typeInto(window.document.getElementById('scale-transpose'), '-2');
    const preview = window.document.getElementById('scale-document-preview').textContent;
    expect(alertCalls.length).toBe(0);
    expect(preview).toContain('notes: 6:1');
    expect(preview).toContain('transpose: -2');
  });

  it('the Bulk tab downloads a type: chords document reflecting its current CSV', async () => {
    const window = loadApp();
    window.document.getElementById('bulk-csv').value = 'notes,label\nx02220,A\n';
    window.document.getElementById('bulk-columns').value = '2';

    const text = await clickDownload(window, 'bulk');
    expect(text).toContain('type: chords');
    expect(text).toContain('columns: 2');
    expect(text).toContain('notes,label');
  });

  it('the Neck diagram tab downloads a type: neck document reflecting its current marker rows', async () => {
    const window = loadApp();
    const rows = window.document.querySelectorAll('#neck-marker-rows .marker-row');
    rows[0].querySelector('.marker-string').value = '6';
    rows[0].querySelector('.marker-fret').value = '5';
    window.document.getElementById('neck-firstFret').value = '3';

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('type: neck');
    expect(text).toContain('notes: 6:5');
    expect(text).toContain('firstFret: 3');
  });

  it("the Document tab downloads its own text as-is", async () => {
    const window = loadApp();
    window.document.getElementById('document-text').value = 'type: chord\nnotation: x02220\n';

    const text = await clickDownload(window, 'document');
    expect(text).toBe('type: chord\nnotation: x02220\n');
  });

  it('the Scale chart and Neck diagram tabs\' "Label pitches" checkbox is written as labelPitches: true', async () => {
    const window = loadApp();
    window.document.getElementById('scale-labelPitches').checked = true;
    expect(await clickDownload(window, 'scale')).toContain('labelPitches: true');

    window.document.getElementById('neck-labelPitches').checked = true;
    expect(await clickDownload(window, 'neck')).toContain('labelPitches: true');
  });
});

describe('web UI: full flow -- upload, edit, download', () => {
  it('uploads a document, edits the populated tab, and downloads it back with the edit applied', async () => {
    const window = loadApp();

    // Upload.
    await uploadFile(
      window,
      'type: chord\nnotation: x02220\nlabel: A Major\nroot: "5"\ntuning: EADGBE\n',
    );
    expect(isActive(window, 'panel-single')).toBe(true);
    expect(window.document.getElementById('single-label').value).toBe('A Major');

    // Edit: change the label, leave everything else as populated.
    window.document.getElementById('single-label').value = 'A Major (capo 2)';

    // Download.
    const text = await clickDownload(window, 'single');
    expect(text).toContain('type: chord');
    expect(text).toContain('notation: x02220');
    expect(text).toContain('label: A Major (capo 2)');
    expect(text).not.toContain('label: A Major\n'); // the pre-edit value is gone
    expect(text).toContain('root: "5"'); // untouched fields survive the edit
    expect(text).toContain('tuning: EADGBE');

    // The downloaded text is itself a valid document the renderer/CLI would
    // accept -- round-trip it through DocumentSync one more time as a
    // sanity check that it's not just plausible-looking text.
    const reparsed = window.DocumentSync.parse(text);
    expect(reparsed.type).toBe('chord');
    expect(reparsed.fields.label).toBe('A Major (capo 2)');
    expect(reparsed.fields.notation).toBe('x02220');
  });

  it('uploads a scale document, edits a marker row, and downloads it back with the edit applied', async () => {
    const window = loadApp();

    await uploadFile(
      window,
      'type: scale\nlabel: Pentatonic\nnotes:\n  - { string: 6, fret: 3, label: R }\n  - { string: 5, fret: 2, label: b3 }\n',
    );
    expect(isActive(window, 'panel-scale')).toBe(true);

    const rows = window.document.querySelectorAll('#scale-marker-rows .marker-row');
    expect(rows.length).toBe(2);
    rows[0].querySelector('.marker-fret').value = '5'; // edit: 3 -> 5

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('type: scale');
    expect(text).toContain('notes: |\n  6:5:R\n  5:2:b3');

    const reparsed = window.DocumentSync.parse(text);
    expect(reparsed.fields.notes).toEqual([
      { string: 6, fret: 5, label: 'R' },
      { string: 5, fret: 2, label: 'b3' },
    ]);
  });
});

describe('web UI: quick-start example buttons', () => {
  it('"A major" populates the Single chord tab', () => {
    const window = loadApp();
    window.document.querySelector('[data-example="single-a-major"]').click();
    expect(window.document.getElementById('single-notation').value).toBe('x02220');
    expect(window.document.getElementById('single-label').value).toBe('A Major');
    expect(window.document.getElementById('single-root').value).toBe('5');
  });

  it('"Minor pentatonic box" populates the Scale chart tab\'s marker rows', () => {
    const window = loadApp();
    window.document.querySelector('[data-example="scale-pentatonic-box"]').click();
    expect(window.document.getElementById('scale-label').value).toBe('Minor Pentatonic Box (partial)');
    expect(window.document.getElementById('scale-mutedStrings').value).toBe('1,2');
    const rows = window.document.querySelectorAll('#scale-marker-rows .marker-row');
    expect(rows.length).toBe(4);
    expect(rows[0].querySelector('.marker-string').value).toBe('6');
    expect(rows[0].querySelector('.marker-fret').value).toBe('3');
  });

  it('"Root-5 shape" populates the Neck diagram tab, including firstFret/lastFret', () => {
    const window = loadApp();
    window.document.querySelector('[data-example="neck-root-5-shape"]').click();
    expect(window.document.getElementById('neck-label').value).toBe('Root-5 shape');
    expect(window.document.getElementById('neck-firstFret').value).toBe('5');
    expect(window.document.getElementById('neck-lastFret').value).toBe('17');
    const rows = window.document.querySelectorAll('#neck-marker-rows .marker-row');
    expect(rows.length).toBe(3);
  });

  it('a populated example can be rendered without further edits (button is type="button", never submits the form)', () => {
    const window = loadApp();
    window.document.querySelector('[data-example="single-g-major"]').click();
    const form = window.document.getElementById('form-single');
    expect(form.checkValidity()).toBe(true);
  });
});

describe('web UI: shareable permalinks', () => {
  it('"Copy link" on the Single chord tab produces a #doc= URL that decodes back to the current document', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    window.document.getElementById('single-label').value = 'A Major';

    const url = await clickShare(window, 'single');
    expect(url).toMatch(/^http:\/\/localhost\/#doc=/);

    const encoded = url.split('#doc=')[1];
    const decoded = window.decodeURIComponent(window.escape(window.atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
    expect(decoded).toContain('type: chord');
    expect(decoded).toContain('notation: x02220');
    expect(decoded).toContain('label: A Major');
  });

  it('shows the plain link when the Clipboard API is unavailable', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    // Deliberately no navigator.clipboard stub -- jsdom leaves it
    // undefined by default, matching a non-secure-context browser.
    window.document.getElementById('single-share').click();
    await waitFor(function () {
      return !window.document.getElementById('single-share-status').classList.contains('hidden');
    });
    expect(window.document.getElementById('single-share-status').textContent).toMatch(/^http:\/\/localhost\/#doc=/);
  });

  it('updates the visible address bar (history.replaceState) to match the copied link', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    const url = await clickShare(window, 'single');
    expect(window.location.href).toBe(url);
  });

  it('the Document tab shares its raw text as-is, with no DocumentSync.stringify round-trip', async () => {
    const window = loadApp();
    window.document.getElementById('document-text').value = 'type: chord\nnotation: x02220\n';
    const url = await clickShare(window, 'document');
    const encoded = url.split('#doc=')[1];
    const decoded = window.DocumentSync.parse(
      window.decodeURIComponent(window.escape(window.atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))),
    );
    expect(decoded.fields.notation).toBe('x02220');
  });

  it('opening a permalink URL auto-populates the matching tab, same as an upload', () => {
    const yamlText = 'type: scale\nlabel: Shared Scale\nnotes: "6:3:R"\n';
    const encoded = Buffer.from(yamlText, 'utf8').toString('base64url');
    const window = loadApp('http://localhost/#doc=' + encoded);

    expect(isActive(window, 'panel-scale')).toBe(true);
    expect(window.document.getElementById('scale-label').value).toBe('Shared Scale');
    expect(window.document.getElementById('document-text').value).toBe(yamlText);
  });

  it('a corrupted permalink shows a clear error and switches to the Document tab instead of crashing', () => {
    const window = loadApp('http://localhost/#doc=%%%not-valid-base64%%%');
    expect(isActive(window, 'panel-document')).toBe(true);
    expect(window.document.getElementById('document-error').classList.contains('hidden')).toBe(false);
    expect(window.document.getElementById('document-error').textContent).toContain("couldn't be decoded");
  });

  it('a page load with no #doc= fragment is unaffected (default tab stays active)', () => {
    const window = loadApp('http://localhost/');
    expect(isActive(window, 'panel-single')).toBe(true);
    expect(window.document.getElementById('document-error').classList.contains('hidden')).toBe(true);
  });

  it('round-trips a label containing a non-ASCII character through a permalink', async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = 'x02220';
    window.document.getElementById('single-label').value = 'A♭ Major';
    const url = await clickShare(window, 'single');

    const window2 = loadApp(url);
    expect(window2.document.getElementById('single-label').value).toBe('A♭ Major');
  });
});

/** Sets an input/textarea's value and dispatches a bubbling 'input' event, same as a real keystroke. */
function typeInto(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

/** Sets a checkbox's checked state and dispatches a bubbling 'change' event, same as a real click. */
function setChecked(el, checked) {
  el.checked = checked;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

describe('web UI: live document preview', () => {
  it('the Single chord tab\'s preview starts as a bare "type: chord" document and updates as fields are typed', () => {
    const window = loadApp();
    const preview = window.document.getElementById('single-document-preview');
    expect(preview.textContent).toBe('type: chord\n');

    typeInto(window.document.getElementById('single-notation'), 'x02220');
    typeInto(window.document.getElementById('single-label'), 'A Major');

    expect(preview.textContent).toBe('type: chord\nnotation: x02220\nlabel: A Major\n');
  });

  it('the Scale chart tab\'s preview renders notes in compact notation, reflecting marker-row edits and additions which are click/input driven rather than form-field changes', () => {
    const window = loadApp();
    const preview = window.document.getElementById('scale-document-preview');

    const firstRow = window.document.querySelector('#scale-marker-rows .marker-row');
    typeInto(firstRow.querySelector('.marker-fret'), '3');
    typeInto(firstRow.querySelector('.marker-label'), 'R');
    expect(preview.textContent).toContain('notes: 6:3:R');
    expect(preview.textContent).not.toContain('- {'); // not the native YAML list form

    window.document.getElementById('scale-add-marker').click();
    const rows = window.document.querySelectorAll('#scale-marker-rows .marker-row');
    expect(rows.length).toBe(2);
    typeInto(rows[1].querySelector('.marker-fret'), '5');
    expect(preview.textContent).toContain('notes: |\n  6:3:R\n  6:5');

    rows[1].querySelector('.marker-row-remove').click();
    expect(preview.textContent).toContain('notes: 6:3:R');
    expect(preview.textContent).not.toContain('notes: |'); // back to one marker -- a plain scalar line, not a block
  });

  it('the Scale chart tab\'s "Compact notation for notes" checkbox is on by default and toggles the preview between compact and native-list form', async () => {
    const window = loadApp();
    const checkbox = window.document.getElementById('scale-document-preview-compact');
    const preview = window.document.getElementById('scale-document-preview');
    expect(checkbox.checked).toBe(true);

    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    typeInto(row.querySelector('.marker-fret'), '3');
    typeInto(row.querySelector('.marker-label'), 'R');
    expect(preview.textContent).toContain('notes: 6:3:R');

    setChecked(checkbox, false);
    expect(preview.textContent).toContain('- { string: 6, fret: 3, label: R }');
    expect(preview.textContent).not.toContain('6:3:R');
    // unchecked, the preview now matches exactly what "Document" downloads.
    expect(await clickDownload(window, 'scale')).toBe(preview.textContent);

    setChecked(checkbox, true);
    expect(preview.textContent).toContain('notes: 6:3:R');
  });

  it('the Neck diagram tab\'s preview matches the downloaded document\'s notes -- both compact by default, both native once unchecked', async () => {
    const window = loadApp();
    typeInto(window.document.getElementById('neck-label'), 'Root-5 shape');
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    typeInto(row.querySelector('.marker-fret'), '7');
    typeInto(row.querySelector('.marker-label'), 'R');

    const preview = window.document.getElementById('neck-document-preview').textContent;
    expect(preview).toContain('notes: 6:7:R\n');

    const downloaded = await clickDownload(window, 'neck');
    expect(downloaded).toContain('notes: 6:7:R\n');

    setChecked(window.document.getElementById('neck-document-preview-compact'), false);
    const nativePreview = window.document.getElementById('neck-document-preview').textContent;
    expect(nativePreview).toContain('- { string: 6, fret: 7, label: R }\n');
    const nativeDownloaded = await clickDownload(window, 'neck');
    expect(nativeDownloaded).toContain('- { string: 6, fret: 7, label: R }\n');

    expect(window.DocumentSync.parse(preview).fields.notes).toEqual(
      window.DocumentSync.parse(downloaded).fields.notes,
    );
  });

  it('matches exactly what the "Document" button would download, for a tab with no notes list to compact', async () => {
    const window = loadApp();
    typeInto(window.document.getElementById('bulk-csv'), 'notes,label\nx02220,A\n');
    typeInto(window.document.getElementById('bulk-collectionLabel'), 'My Chords');

    const preview = window.document.getElementById('bulk-document-preview').textContent;
    const downloaded = await clickDownload(window, 'bulk');
    expect(downloaded).toBe(preview);
  });

  it('updates after a document upload auto-populates a tab (a programmatic value change with no input/change event of its own)', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: chord\nnotation: x02220\nlabel: A Major\n');

    expect(window.document.getElementById('single-document-preview').textContent).toBe(
      'type: chord\nnotation: x02220\nlabel: A Major\n',
    );
  });

  it('updates after a quick-start example populates a tab', () => {
    const window = loadApp();
    window.document.querySelector('[data-example="single-g-major"]').click();

    expect(window.document.getElementById('single-document-preview').textContent).toBe(
      'type: chord\nnotation: "320003"\nlabel: G Major\nroot: "6"\n',
    );
  });
});

describe('web UI: note shapes', () => {
  it("the Single chord tab's per-string Note shapes control (default mode) flows into the downloaded document", async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = '320003';
    // Per-string mode is checked by default for this field (see index.html).
    expect(
      window.document.querySelector('input[name="single-noteShapes-mode"][value="per-string"]').checked,
    ).toBe(true);
    window.document.getElementById('single-noteShapes-string-6').value = 'square';

    const text = await clickDownload(window, 'single');
    expect(text).toContain('noteShapes: "{\\"6\\":\\"square\\"}"');
    const parsed = window.DocumentSync.parse(text);
    expect(JSON.parse(parsed.fields.noteShapes)).toEqual({ 6: 'square' });
  });

  it("the Single chord tab's Note shapes JSON view is an alternative to the per-string selects", async () => {
    const window = loadApp();
    window.document.getElementById('single-notation').value = '320003';
    window.document.querySelector('input[name="single-noteShapes-mode"][value="text"]').checked = true;
    window.document.getElementById('single-noteShapes-text').value = '{"6":"triangle"}';

    const text = await clickDownload(window, 'single');
    expect(text).toContain('noteShapes: "{\\"6\\":\\"triangle\\"}"');
  });

  it("the Scale chart tab's Shape marker-row column flows into the downloaded document's native marker list", async () => {
    const window = loadApp();
    window.document.getElementById('scale-document-preview-compact').checked = false;
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    row.querySelector('.marker-shape').value = 'square';

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('shape: square');
    const parsed = window.DocumentSync.parse(text);
    expect(parsed.fields.notes[0]).toMatchObject({ string: 6, fret: 3, shape: 'square' });
  });

  it("the Neck diagram tab's Shape marker-row column flows into the downloaded document's native marker list", async () => {
    const window = loadApp();
    window.document.getElementById('neck-document-preview-compact').checked = false;
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    row.querySelector('.marker-shape').value = 'triangle';

    const text = await clickDownload(window, 'neck');
    expect(text).toContain('shape: triangle');
  });

  it('a marker row\'s Shape select defaults to "Default" (unset), omitting shape from the document entirely', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    expect(row.querySelector('.marker-shape').value).toBe('');
    row.querySelector('.marker-fret').value = '3';

    const text = await clickDownload(window, 'scale');
    expect(text).not.toContain('shape');
  });

  it('uploading a document with a marker shape populates the matching marker row\'s Shape select', async () => {
    const window = loadApp();
    await uploadFile(
      window,
      'type: scale\nnotes:\n  - { string: 6, fret: 3, shape: square }\n',
    );
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    expect(row.querySelector('.marker-shape').value).toBe('square');
  });

  it('uploading a type: chord document with noteShapes populates the Single chord tab\'s JSON view', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: chord\nnotation: "320003"\nnoteShapes: \'{"6":"square"}\'\n');
    expect(window.document.getElementById('single-noteShapes-text').value).toBe('{"6":"square"}');
    expect(
      window.document.querySelector('input[name="single-noteShapes-mode"][value="text"]').checked,
    ).toBe(true);
  });
});

describe('web UI: label frets (default on, opt-out)', () => {
  it("the Scale chart and Neck diagram tabs' Label frets checkbox is checked by default", () => {
    const window = loadApp();
    expect(window.document.getElementById('scale-labelFrets').checked).toBe(true);
    expect(window.document.getElementById('neck-labelFrets').checked).toBe(true);
  });

  it('unchecking Label frets sends labelFrets: false explicitly, not just omitting the field', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';
    window.document.getElementById('scale-labelFrets').checked = false;

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('labelFrets: false');
  });

  it('leaving Label frets checked writes labelFrets: true explicitly (the web UI always sends an explicit value, never omits this field)', async () => {
    const window = loadApp();
    const row = window.document.querySelector('#scale-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';

    const text = await clickDownload(window, 'scale');
    expect(text).toContain('labelFrets: true');
  });

  it('uploading a document with labelFrets: false unchecks the Neck diagram tab\'s Label frets checkbox', async () => {
    const window = loadApp();
    await uploadFile(window, 'type: neck\nnotes: "6:3"\nlabelFrets: false\n');
    expect(window.document.getElementById('neck-labelFrets').checked).toBe(false);
  });
});

describe('web UI: neck fret-range warnings', () => {
  /** Stubs the engine's render() to resolve with `data`, and returns the captured request body once a render is requested. */
  function stubRender(window, data) {
    let capturedBody;
    window.ChordChartsEngine.render = function (route, body) {
      capturedBody = body;
      return Promise.resolve({ ok: true, data: data });
    };
    return function () {
      return capturedBody;
    };
  }

  it('shows the renderer\'s warnings array in the Neck diagram tab\'s warning box after rendering', async () => {
    const window = loadApp();
    stubRender(window, {
      format: 'svg',
      svg: '<svg></svg>',
      warnings: ['notes fall outside frets [0, 12] -- expanded to [0, 20] to fit them all'],
    });
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '20';

    window.document.getElementById('form-neck').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(function () {
      return !window.document.getElementById('neck-warning').classList.contains('hidden');
    });

    expect(window.document.getElementById('neck-warning').textContent).toContain('expanded to [0, 20]');
  });

  it('hides the warning box (and clears its text) when a response has no warnings', async () => {
    const window = loadApp();
    const warningEl = window.document.getElementById('neck-warning');
    warningEl.textContent = 'stale warning from a previous render';
    warningEl.classList.remove('hidden');

    stubRender(window, { format: 'svg', svg: '<svg></svg>' });
    const row = window.document.querySelector('#neck-marker-rows .marker-row');
    row.querySelector('.marker-fret').value = '3';

    window.document.getElementById('form-neck').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(function () {
      return window.document.getElementById('neck-result').innerHTML.indexOf('<svg') !== -1;
    });

    expect(warningEl.classList.contains('hidden')).toBe(true);
    expect(warningEl.textContent).toBe('');
  });

  it('shows a type: neck FretCharts file\'s warnings in the Document tab\'s own warning box', async () => {
    const window = loadApp();
    stubRender(window, {
      format: 'svg',
      svg: '<svg></svg>',
      warnings: ['notes fall outside frets [0, 12] -- expanded to [0, 20] to fit them all'],
    });
    window.document.getElementById('document-text').value = 'type: neck\nnotes: "6:3;5:20"\n';

    window.document.getElementById('form-document').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(function () {
      return !window.document.getElementById('document-warning').classList.contains('hidden');
    });

    expect(window.document.getElementById('document-warning').textContent).toContain('expanded to [0, 20]');
  });
});

describe('web UI: triads tab', () => {
  const CSV = 'notes,label,root,string-labels\nxxx787,G,2,"{""1"":""3"",""2"":""R"",""3"":""5""}"\n';

  /** Stubs the engine's render() to resolve with `result`, returning a getter for the captured request {route, body}. */
  function stubRender(window, result) {
    let captured;
    window.ChordChartsEngine.render = function (route, body) {
      captured = { route: route, body: body };
      return Promise.resolve(result);
    };
    return function () {
      return captured;
    };
  }

  function submitTriads(window) {
    window.document.getElementById('form-triads').dispatchEvent(new window.Event('submit', { cancelable: true }));
  }

  it('is a tab that activates its panel', () => {
    const window = loadApp();
    window.document.getElementById('tab-triads').click();
    expect(isActive(window, 'panel-triads')).toBe(true);
    expect(isActive(window, 'panel-single')).toBe(false);
  });

  it('posts only the filled-in fields to /triads', async () => {
    const window = loadApp();
    const request = stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg></svg>', csv: CSV } });
    window.document.getElementById('triads-chords').value = 'G C D';
    window.document.getElementById('triads-strings').value = '1-3';
    window.document.getElementById('triads-floor').value = '5,3';
    window.document.getElementById('triads-direction').value = 'above';
    window.document.getElementById('triads-maxSpan').value = '3';

    submitTriads(window);
    await waitFor(function () {
      return request() !== undefined;
    });

    expect(request().route).toBe('/triads');
    expect(request().body).toEqual({
      chords: 'G C D',
      strings: '1-3',
      floor: '5,3',
      direction: 'above',
      maxSpan: 3,
      format: 'svg',
    });
  });

  it('shows the grid and the CSV, and enables the CSV buttons, after a successful search', async () => {
    const window = loadApp();
    stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg id="grid"></svg>', csv: CSV } });
    const download = window.document.getElementById('triads-download');
    const toBulk = window.document.getElementById('triads-to-bulk');
    expect(download.disabled).toBe(true);
    expect(toBulk.disabled).toBe(true);

    window.document.getElementById('triads-chords').value = 'G';
    submitTriads(window);
    await waitFor(function () {
      return !download.disabled;
    });

    expect(window.document.getElementById('triads-result').innerHTML).toContain('id="grid"');
    expect(window.document.getElementById('triads-csv').textContent).toBe(CSV);
    expect(window.document.getElementById('triads-csv-panel').classList.contains('hidden')).toBe(false);
    expect(toBulk.disabled).toBe(false);
  });

  it('shows the render error and keeps the CSV buttons disabled on failure', async () => {
    const window = loadApp();
    stubRender(window, { ok: false, error: 'unsupported chord quality "13" in "C13"' });
    window.document.getElementById('triads-chords').value = 'C13';
    submitTriads(window);
    const errorEl = window.document.getElementById('triads-error');
    await waitFor(function () {
      return !errorEl.classList.contains('hidden');
    });
    expect(errorEl.textContent).toContain('unsupported chord quality');
    expect(window.document.getElementById('triads-download').disabled).toBe(true);
  });

  it('requires at least one chord before sending anything', () => {
    const window = loadApp();
    let called = false;
    window.ChordChartsEngine.render = function () {
      called = true;
      return Promise.reject(new Error('should not be called'));
    };
    submitTriads(window);
    expect(called).toBe(false);
    expect(window.document.getElementById('triads-error').textContent).toContain('at least one chord');
  });

  it('downloads the CSV', async () => {
    const window = loadApp();
    stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg></svg>', csv: CSV } });
    window.document.getElementById('triads-chords').value = 'G';
    submitTriads(window);
    await waitFor(function () {
      return !window.document.getElementById('triads-download').disabled;
    });

    let capturedBlob;
    window.URL.createObjectURL = function (blob) {
      capturedBlob = blob;
      return 'blob:mock';
    };
    window.URL.revokeObjectURL = function () {};
    window.document.getElementById('triads-download').click();
    expect(capturedBlob.type).toBe('text/csv');
    expect(await readBlobText(window, capturedBlob)).toBe(CSV);
  });

  it('sends the CSV and shared grid options to the Multiple chords tab', async () => {
    const window = loadApp();
    stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg></svg>', csv: CSV } });
    window.document.getElementById('triads-chords').value = 'G';
    window.document.getElementById('triads-collectionLabel').value = 'G triads';
    window.document.getElementById('triads-columns').value = '3';
    window.document.getElementById('triads-stylesheet').value = '.root { fill: red; }';
    submitTriads(window);
    await waitFor(function () {
      return !window.document.getElementById('triads-to-bulk').disabled;
    });

    window.document.getElementById('triads-to-bulk').click();

    expect(isActive(window, 'panel-bulk')).toBe(true);
    expect(window.document.getElementById('bulk-csv').value).toBe(CSV.trim());
    expect(window.document.getElementById('bulk-collectionLabel').value).toBe('G triads');
    expect(window.document.getElementById('bulk-columns').value).toBe('3');
    expect(window.document.getElementById('bulk-stylesheet').value).toBe('.root { fill: red; }');
    expect(window.document.getElementById('bulk-document-preview').textContent).toContain('xxx787');
  });
});

describe('Start tab', () => {
  it('opens on a first visit and renders every gallery example', async () => {
    const window = loadApp('http://localhost/', { lastTab: null });
    const routes = [];
    window.ChordChartsEngine.render = function (route, body) {
      routes.push(route);
      return Promise.resolve({ ok: true, data: { format: 'svg', svg: '<svg class="stub"></svg>' } });
    };
    expect(isActive(window, 'panel-start')).toBe(true);
    expect(isActive(window, 'panel-single')).toBe(false);
    const cards = window.document.querySelectorAll('#gallery-list .gallery-card');
    expect(cards.length).toBe(window.GALLERY_EXAMPLES.length);
    await waitFor(function () {
      return window.document.querySelectorAll('#gallery-list .result-box img').length === cards.length;
    });
    // Rendered as images, so one example's <style> can't restyle another's.
    expect(window.document.querySelectorAll('#gallery-list svg').length).toBe(0);
    expect(routes.length).toBe(cards.length);
    expect(new Set(routes)).toEqual(new Set(['/document']));
  });

  it('reopens the last-used tab instead, and renders the gallery only once Start is opened', async () => {
    const window = loadApp('http://localhost/', { lastTab: 'tab-neck' });
    const routes = [];
    window.ChordChartsEngine.render = function (route, body) {
      routes.push(route);
      return Promise.resolve({ ok: true, data: { format: 'svg', svg: '<svg class="stub"></svg>' } });
    };
    expect(isActive(window, 'panel-neck')).toBe(true);
    expect(isActive(window, 'panel-start')).toBe(false);
    await new Promise(function (resolve) {
      setTimeout(resolve, 20);
    });
    expect(routes).toEqual([]);

    window.document.getElementById('tab-start').click();
    window.document.getElementById('tab-start').click();
    expect(isActive(window, 'panel-start')).toBe(true);
    const cards = window.document.querySelectorAll('#gallery-list .gallery-card');
    await waitFor(function () {
      return window.document.querySelectorAll('#gallery-list .result-box img').length === cards.length;
    });
    expect(routes.length).toBe(cards.length);
  });

  it('remembers the tab a visitor switches to', () => {
    const window = loadApp();
    window.document.getElementById('tab-scale').click();
    expect(window.localStorage.getItem('fretcharts.lastTab')).toBe('tab-scale');
  });

  it('falls back to Start when the remembered tab no longer exists', () => {
    const window = loadApp('http://localhost/', { lastTab: 'tab-gallery' });
    // Landing on Start renders the gallery a tick later; give it something to render.
    window.ChordChartsEngine.render = function () {
      return Promise.resolve({ ok: true, data: { format: 'svg', svg: '<svg></svg>' } });
    };
    expect(isActive(window, 'panel-start')).toBe(true);
  });

  it('a #doc= link opens its own tab, not the remembered one', () => {
    const window = loadApp('http://localhost/#doc=%%%not-valid-base64%%%', { lastTab: 'tab-neck' });
    expect(isActive(window, 'panel-document')).toBe(true);
    expect(isActive(window, 'panel-neck')).toBe(false);
  });

  it('shows a card\'s render error in that card', async () => {
    const window = loadApp();
    window.ChordChartsEngine.render = function () {
      return Promise.resolve({ ok: false, error: 'boom' });
    };
    window.document.getElementById('tab-start').click();
    const firstError = window.document.querySelector('#gallery-list .gallery-card .error-box');
    await waitFor(function () {
      return !firstError.classList.contains('hidden');
    });
    expect(firstError.textContent).toBe('boom');
  });

  it('"Open in editor" loads the example into the tab matching its type', () => {
    const window = loadApp();
    const example = window.GALLERY_EXAMPLES.filter(function (ex) {
      return /^type: chord$/m.test(ex.document);
    })[0];
    window.document.querySelector('#gallery-' + example.id + ' .gallery-open').click();
    expect(isActive(window, 'panel-single')).toBe(true);
    expect(window.document.getElementById('single-notation').value).not.toBe('');
    expect(window.document.getElementById('document-text').value).toBe(example.document);
  });
});

describe('Printing', () => {
  function stubRender(window, result) {
    window.ChordChartsEngine.render = function () {
      return Promise.resolve(result);
    };
  }

  function submit(window, formId) {
    window.document.getElementById(formId).dispatchEvent(new window.Event('submit', { cancelable: true }));
  }

  function toolbarFor(window, resultId) {
    const prev = window.document.getElementById(resultId).previousElementSibling;
    return prev && prev.classList.contains('result-toolbar') ? prev : null;
  }

  it('shows a Print button once a tab has a result, and it opens the print dialog', async () => {
    const window = loadApp();
    let printed = 0;
    window.print = function () {
      printed++;
    };
    expect(toolbarFor(window, 'single-result')).toBeNull();

    stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg width="100" height="100"></svg>' } });
    window.document.getElementById('single-notation').value = 'x02220';
    submit(window, 'form-single');
    await waitFor(function () {
      const toolbar = toolbarFor(window, 'single-result');
      return toolbar && !toolbar.classList.contains('hidden');
    });

    toolbarFor(window, 'single-result').querySelector('.print-btn').click();
    expect(printed).toBe(1);
    // A single chart has no grid, so it prints as-is.
    expect(window.document.querySelector('#panel-single .print-grid')).toBeNull();
  });

  it('hides the Print button again when a later render fails', async () => {
    const window = loadApp();
    stubRender(window, { ok: true, data: { format: 'svg', svg: '<svg></svg>' } });
    window.document.getElementById('single-notation').value = 'x02220';
    submit(window, 'form-single');
    await waitFor(function () {
      const toolbar = toolbarFor(window, 'single-result');
      return toolbar && !toolbar.classList.contains('hidden');
    });

    stubRender(window, { ok: false, error: 'bad notation' });
    submit(window, 'form-single');
    await waitFor(function () {
      return !window.document.getElementById('single-error').classList.contains('hidden');
    });
    expect(toolbarFor(window, 'single-result').classList.contains('hidden')).toBe(true);
  });

  it('lays out a grid render chart by chart, keeping its charts per row and title', async () => {
    const window = loadApp();
    const chart = function (width) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="100"></svg>';
    };
    stubRender(window, {
      ok: true,
      data: {
        format: 'svg',
        svg: '<svg></svg>',
        grid: { charts: [chart(100), chart(100), chart(50), chart(100), chart(100)], columns: 2, collectionLabel: 'Open chords' },
      },
    });
    window.document.getElementById('bulk-csv').value = 'notes\nx02220\n';
    submit(window, 'form-bulk');
    await waitFor(function () {
      return window.document.querySelector('#panel-bulk .print-grid') !== null;
    });

    const grid = window.document.querySelector('#panel-bulk .print-grid');
    expect(window.document.getElementById('bulk-result').classList.contains('has-print-grid')).toBe(true);
    expect(grid.querySelector('.print-grid-title').textContent).toBe('Open chords');
    const rows = grid.querySelectorAll('.print-grid-row');
    expect(Array.from(rows).map((r) => r.children.length)).toEqual([2, 2, 1]);
    expect(rows[0].style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    // Narrower charts keep their size relative to the widest.
    expect(rows[1].querySelectorAll('img')[0].style.width).toBe('50%');

    // A re-render replaces the print copy rather than adding another.
    submit(window, 'form-bulk');
    await waitFor(function () {
      return window.document.getElementById('bulk-loading').classList.contains('hidden');
    });
    expect(window.document.querySelectorAll('#panel-bulk .print-grid')).toHaveLength(1);
  });

  it('the Start tab has its own Print button', () => {
    const window = loadApp();
    let printed = 0;
    window.print = function () {
      printed++;
    };
    window.document.getElementById('start-print').click();
    expect(printed).toBe(1);
  });
});

describe('web UI: FretCharts file versions', () => {
  // The stub engine from loadApp has no version; give it the real helpers.
  function withVersion(window, version) {
    window.ChordChartsEngine.VERSION = version;
    window.ChordChartsEngine.compareVersions = compareVersions;
    window.ChordChartsEngine.isVersion = isVersion;
    return window;
  }

  it('stamps a downloaded file with the current version, right after type', async () => {
    const window = withVersion(loadApp(), '1.2.3');
    window.document.getElementById('single-notation').value = 'x02220';
    const text = await clickDownload(window, 'single');
    expect(text.split('\n').slice(0, 2)).toEqual(['type: chord', 'version: 1.2.3']);
  });

  it('populates the matching tab for a file from this version or older', async () => {
    const window = withVersion(loadApp(), '1.2.3');
    await uploadFile(window, 'type: chord\nversion: 1.2.3-rc.1\nnotation: x02220\n');
    expect(isActive(window, 'panel-single')).toBe(true);
    expect(window.document.getElementById('document-warning').classList.contains('hidden')).toBe(true);
  });

  it('keeps a file from a newer version as text on the Document tab, with a warning', async () => {
    const window = withVersion(loadApp(), '1.2.3');
    await uploadFile(window, 'type: chord\nversion: 1.3.0\nnotation: x02220\nsparkle: true\n');
    expect(isActive(window, 'panel-document')).toBe(true);
    const warning = window.document.getElementById('document-warning');
    expect(warning.classList.contains('hidden')).toBe(false);
    expect(warning.textContent).toContain('FretCharts 1.3.0, newer than this one (1.2.3)');
    expect(window.document.getElementById('single-notation').value).toBe('');
  });
});

