'use strict';

// All rendering happens in the browser: engine.js (built from
// src/browser/engine.ts by `npm run build:web`) must load before this
// script and sets window.ChordChartsEngine.

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Central request-body builder.
//
// `fields` is an array of descriptors: { name, el, type }
//   type: 'text'    -> included only if the trimmed value is non-empty
//         'checkbox' -> included (as true) only if checked; never sends false
//         'number'   -> included only if non-empty, parsed as a number
//
// This keeps the "omit blank/unchecked fields" rule in one place instead of
// repeating it for every field on every form.
// ---------------------------------------------------------------------------

function collectFields(fields) {
  var body = {};
  fields.forEach(function (field) {
    var el = field.el;
    if (field.type === 'checkbox') {
      if (el.checked) {
        body[field.name] = true;
      }
    } else if (field.type === 'number') {
      var raw = el.value.trim();
      if (raw !== '') {
        var num = Number(raw);
        if (!Number.isNaN(num)) {
          body[field.name] = num;
        }
      }
    } else {
      var value = el.value.trim();
      if (value !== '') {
        body[field.name] = value;
      }
    }
  });
  return body;
}

function getCheckedRadioValue(form, name) {
  var checked = form.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : undefined;
}

// ---------------------------------------------------------------------------
// JSON-or-per-string fields: string labels, finger positions, and note
// classes can each be edited as raw text (JSON, or -- for finger positions
// -- chord-notation-style shorthand, unchanged from before) or as 6
// individual per-string inputs. Per-string mode is assembled into the same
// JSON text here in JS before the request is built, so the renderer only
// ever sees one shape regardless of which mode was used.
//
// `prefix` identifies one field's whole markup block, e.g.
// "single-stringLabels" or "bulk-noteClasses" -- see index.html for the
// ids/name this expects: `${prefix}-mode` (radio group), `${prefix}-text`
// (the raw text input), and `${prefix}-string-N` for N in 1..6.
// ---------------------------------------------------------------------------

var STRING_NUMBERS = [6, 5, 4, 3, 2, 1];
var JSON_OR_PER_STRING_FIELD_NAMES = ['stringLabels', 'fingerPositions', 'noteClasses'];

function isPerStringMode(prefix) {
  var checked = document.querySelector('input[name="' + prefix + '-mode"]:checked');
  return !!checked && checked.value === 'per-string';
}

function initJsonOrPerStringField(prefix) {
  var textView = $(prefix + '-text-view');
  var perStringView = $(prefix + '-per-string-view');
  var radios = document.querySelectorAll('input[name="' + prefix + '-mode"]');

  function update() {
    if (isPerStringMode(prefix)) {
      show(perStringView);
      hide(textView);
    } else {
      show(textView);
      hide(perStringView);
    }
  }

  radios.forEach(function (radio) {
    radio.addEventListener('change', update);
  });

  // Sync visibility to whichever radio is actually checked, rather than
  // relying on index.html's hidden-class markup to already agree with it.
  update();
}

// Returns text ready to send to the renderer (built from the 6 per-string
// inputs if that mode is active, otherwise the raw text input as-is), or
// '' if nothing was entered -- matching collectFields' "omit if blank" rule.
// Per-string inputs become compact text like "- - - 5 R 3" (see
// parsePerStringText in src/chartFieldResolver.ts), except fingerPositions,
// whose own notation is different and stays JSON.
function getJsonOrPerStringValue(prefix) {
  if (isPerStringMode(prefix)) {
    var obj = {};
    STRING_NUMBERS.forEach(function (n) {
      var el = $(prefix + '-string-' + n);
      var value = el ? el.value.trim() : '';
      if (value !== '') {
        obj[n] = value;
      }
    });
    if (Object.keys(obj).length === 0) return '';
    var engine = window.ChordChartsEngine;
    if (!/-fingerPositions$/.test(prefix) && engine && engine.stringifyPerStringCompact) {
      return engine.stringifyPerStringCompact(obj, perStringCount(prefix));
    }
    return JSON.stringify(obj);
  }
  var textEl = $(prefix + '-text');
  return textEl ? textEl.value.trim() : '';
}

// The string count positional per-string text is written for: the form's
// tuning when it has one, else 6. Fields are prefixed "<form>-<name>".
// A value typed for a string the tuning doesn't have makes
// stringifyPerStringCompact fall back to JSON, so it isn't silently lost.
function perStringCount(prefix) {
  var tuningEl = $(prefix.split('-')[0] + '-tuning');
  var tuning = tuningEl && tuningEl.value.trim() !== '' ? tuningEl.value.trim() : undefined;
  return window.ChordChartsEngine.stringCountFor(tuning);
}

// Reads all 3 JSON-or-per-string fields for a form (prefixed "single" or
// "bulk") and merges any non-blank ones into `target`.
function mergeJsonOrPerStringFields(target, formPrefix) {
  JSON_OR_PER_STRING_FIELD_NAMES.forEach(function (name) {
    var value = getJsonOrPerStringValue(formPrefix + '-' + name);
    if (value !== '') {
      target[name] = value;
    }
  });
}

// Populates a JSON-or-per-string field from an uploaded document's raw
// value, always into the "text" (JSON) view -- a document's field is
// already exactly that raw JSON/notation string (see chartFieldResolver.ts:
// these fields stay string-only in the document schema), so there's no
// per-string breakdown to reconstruct. Switches the field's mode radio to
// "text" so the populated value is actually visible.
function setJsonOrPerStringField(prefix, value) {
  var textEl = $(prefix + '-text');
  var textView = $(prefix + '-text-view');
  var perStringView = $(prefix + '-per-string-view');
  var textRadio = document.querySelector('input[name="' + prefix + '-mode"][value="text"]');
  if (!textEl) return;
  textEl.value = value || '';
  if (textRadio) textRadio.checked = true;
  if (textView) show(textView);
  if (perStringView) hide(perStringView);
}

// ---------------------------------------------------------------------------
// Stylesheet theme presets: picking one from the "Theme" <select> just
// fills in the Stylesheet textarea below it with a starting point -- these
// are plain CSS text, sent to the renderer the exact same way as anything
// hand-typed there. See the README's Styling section for the full list of
// available classes; class names below match those exactly.
// ---------------------------------------------------------------------------

var CHART_THEMES = {
  dark: [
    '.chord-chart-background, .chord-collection-background { fill: #1c1c21; }',
    '.chord-fret-marker { fill: #3a3a42; }',
    '.chord-string { stroke: #d8d8dc; }',
    '.chord-fret { stroke: #d8d8dc; }',
    '.chord-dot { fill: #ef8a3d; }',
    '.chord-dot-label { fill: #1c1c21; font-weight: bold; }',
    '.chord-glyph-mute { fill: #d8d8dc; }',
    '.chord-glyph-open { stroke: #d8d8dc; }',
    '.chord-finger-label { fill: #d8d8dc; }',
    '.chord-tuning-label { fill: #9a9aa2; }',
    '.chord-fret-label { fill: #9a9aa2; }',
    '.chord-title, .chord-collection-label { fill: #f2f2f4; font-weight: bold; }',
    'circle.root, rect.root, polygon.root { fill: #ef4d4d; }',
    'text.root { fill: #1c1c21; font-weight: bold; }'
  ].join('\n'),

  colorful: [
    '.chord-chart-background, .chord-collection-background { fill: #fffbea; }',
    '.chord-fret-marker { fill: #ffd166; }',
    '.chord-fret { stroke: #333333; }',
    '.chord-string-6 { stroke: #e63946; }',
    '.chord-string-5 { stroke: #f3722c; }',
    '.chord-string-4 { stroke: #f9c74f; }',
    '.chord-string-3 { stroke: #90be6d; }',
    '.chord-string-2 { stroke: #43aa8b; }',
    '.chord-string-1 { stroke: #577590; }',
    '.chord-dot-string-6 { fill: #e63946; }',
    '.chord-dot-string-5 { fill: #f3722c; }',
    '.chord-dot-string-4 { fill: #f9c74f; }',
    '.chord-dot-string-3 { fill: #90be6d; }',
    '.chord-dot-string-2 { fill: #43aa8b; }',
    '.chord-dot-string-1 { fill: #577590; }',
    '.chord-dot-label { fill: #1a1a1a; font-weight: bold; }',
    '.chord-glyph-mute { fill: #333333; }',
    '.chord-glyph-open { stroke: #333333; }',
    '.chord-finger-label { fill: #333333; font-weight: bold; }',
    '.chord-tuning-label { fill: #6b6b6b; }',
    '.chord-title, .chord-collection-label { fill: #d62828; font-weight: bold; }',
    'circle.root, rect.root, polygon.root { fill: #ffd166; stroke: #333333; stroke-width: 2; }',
    'text.root { fill: #333333; font-weight: bold; }'
  ].join('\n'),

  // Same overall look as no stylesheet at all, just softer: lighter
  // strings/frets/glyphs/labels (dots and the title stay full-contrast
  // black, unchanged), plus a light blue root node.
  soft: [
    '.chord-string { stroke: #a0a0a0; }',
    '.chord-fret { stroke: #a0a0a0; }',
    '.chord-fret-marker { fill: #e6e6e6; }',
    '.chord-glyph-mute { fill: #808080; }',
    '.chord-glyph-open { stroke: #808080; }',
    '.chord-finger-label { fill: #808080; }',
    '.chord-tuning-label { fill: #a0a0a0; }',
    '.chord-fret-label { fill: #a0a0a0; }',
    'circle.root, rect.root, polygon.root { fill: #8ecae6; }',
    'text.root { fill: #14395c; font-weight: bold; }'
  ].join('\n'),

  // Minimal, near-monochrome neck (strings/frets/non-root dots all share
  // one near-black dark grey) with just the root note popping in orange.
  orangeCrush: [
    '.chord-string { stroke: #1e1e1e; }',
    '.chord-fret { stroke: #1e1e1e; }',
    '.chord-dot { fill: #1e1e1e; }',
    'circle.root, rect.root, polygon.root { fill: #FA9115; }',
    'text.root { fill: #1e1e1e; font-weight: bold; }'
  ].join('\n'),

  // White-on-blue technical-drawing look.
  blueprint: [
    '.chord-chart-background, .chord-collection-background { fill: #1f4e79; }',
    '.chord-fret-marker { fill: #2d6496; }',
    '.chord-string { stroke: #e8f1fa; }',
    '.chord-fret { stroke: #e8f1fa; }',
    '.chord-dot { fill: #e8f1fa; }',
    '.chord-dot-label { fill: #1f4e79; font-weight: bold; }',
    '.chord-glyph-mute { fill: #e8f1fa; }',
    '.chord-glyph-open { stroke: #e8f1fa; }',
    '.chord-finger-label { fill: #bcd4ea; }',
    '.chord-tuning-label { fill: #bcd4ea; }',
    '.chord-fret-label { fill: #bcd4ea; }',
    '.chord-neck-fret-label { fill: #bcd4ea; }',
    '.chord-title, .chord-collection-label { fill: #ffffff; font-weight: bold; }',
    'circle.root, rect.root, polygon.root { fill: #ffd166; }',
    'text.root { fill: #1f4e79; font-weight: bold; }'
  ].join('\n'),

  // Warm parchment background with a wood-toned fretboard.
  vintage: [
    '.chord-chart-background, .chord-collection-background { fill: #f3e9d2; }',
    '.chord-neck { fill: #c69c6d; }',
    '.chord-fret-marker { fill: #f3e9d2; }',
    '.chord-string { stroke: #4a3520; }',
    '.chord-fret { stroke: #8a6a45; }',
    '.chord-dot { fill: #4a3520; }',
    '.chord-dot-label { fill: #f3e9d2; font-weight: bold; }',
    '.chord-glyph-mute { fill: #4a3520; }',
    '.chord-glyph-open { stroke: #4a3520; }',
    '.chord-finger-label { fill: #6b4f32; }',
    '.chord-tuning-label { fill: #8a6a45; }',
    '.chord-fret-label { fill: #8a6a45; }',
    '.chord-neck-fret-label { fill: #8a6a45; }',
    '.chord-title, .chord-collection-label { fill: #4a3520; font-weight: bold; font-family: Georgia, serif; }',
    'circle.root, rect.root, polygon.root { fill: #9c2c2c; }',
    'text.root { fill: #f3e9d2; font-weight: bold; }'
  ].join('\n'),

  // Dark background with glowing cyan notes and a magenta root.
  neon: [
    '.chord-chart-background, .chord-collection-background { fill: #0d0d1a; }',
    '.chord-fret-marker { fill: #26264d; }',
    '.chord-string { stroke: #5a5a8c; }',
    '.chord-fret { stroke: #5a5a8c; }',
    '.chord-dot { fill: #00e5ff; }',
    '.chord-dot-label { fill: #0d0d1a; font-weight: bold; }',
    '.chord-glyph-mute { fill: #ff4fd8; }',
    '.chord-glyph-open { stroke: #00e5ff; }',
    '.chord-finger-label { fill: #9a9ad0; }',
    '.chord-tuning-label { fill: #9a9ad0; }',
    '.chord-fret-label { fill: #9a9ad0; }',
    '.chord-neck-fret-label { fill: #9a9ad0; }',
    '.chord-title, .chord-collection-label { fill: #00e5ff; font-weight: bold; }',
    'circle.root, rect.root, polygon.root { fill: #ff4fd8; }',
    'text.root { fill: #0d0d1a; font-weight: bold; }'
  ].join('\n'),

  // Black and white only, for printing; the root is a hollow ring instead
  // of a color so it still stands out on paper.
  print: [
    '.chord-chart-background, .chord-collection-background { fill: #ffffff; }',
    '.chord-fret-marker { fill: #dddddd; }',
    '.chord-string { stroke: #000000; }',
    '.chord-fret { stroke: #000000; }',
    '.chord-dot { fill: #000000; }',
    '.chord-dot-label { fill: #ffffff; font-weight: bold; }',
    '.chord-title, .chord-collection-label { fill: #000000; font-weight: bold; }',
    'circle.root, rect.root, polygon.root { fill: #ffffff; stroke: #000000; stroke-width: 2.5; }',
    'text.root { fill: #000000; font-weight: bold; }'
  ].join('\n')
};

function initThemePicker(formPrefix) {
  var select = $(formPrefix + '-theme');
  var textarea = $(formPrefix + '-stylesheet');
  if (!select || !textarea) return;

  select.addEventListener('change', function () {
    var theme = CHART_THEMES[select.value];
    if (theme) {
      textarea.value = theme;
    }
    // Reset to the placeholder immediately -- this is a one-shot "insert a
    // starting point" action, not a persistent binding to the textarea, so
    // re-picking the same theme again (e.g. after editing it away) should
    // always re-trigger a 'change' event.
    select.value = '';
  });
}

// ---------------------------------------------------------------------------
// Rendering the engine's output into a result container.
// ---------------------------------------------------------------------------

function renderResult(resultEl, data) {
  resultEl.innerHTML = '';
  if (data.format === 'svg' && typeof data.svg === 'string') {
    // This is the tool's own generated SVG markup, not arbitrary user HTML,
    // so injecting it directly is fine.
    resultEl.innerHTML = data.svg;
  } else if (data.format === 'png' && typeof data.pngUrl === 'string') {
    var img = document.createElement('img');
    img.src = data.pngUrl;
    img.alt = 'Rendered chord chart';
    resultEl.appendChild(img);
  } else {
    resultEl.textContent = 'The renderer returned an unexpected result.';
  }
}

// ---------------------------------------------------------------------------
// Printing
//
// Printing shows only the active tab's result (see the print rules in
// styles.css). A grid render -- Chord sheet, Triads, or a type: chords
// file -- is one composite SVG on screen, which a browser can't split
// across pages, so it also gets a print-only copy built from the charts
// one by one (data.grid, see src/api/result.ts): one row of cells per
// line, each row kept whole, so a long sheet continues onto the next page.
// ---------------------------------------------------------------------------

// The Print button sits just above the result, created the first time a
// tab renders something and hidden again while there's nothing to print.
function printToolbarFor(resultEl) {
  var toolbar = resultEl.previousElementSibling;
  if (toolbar && toolbar.classList.contains('result-toolbar')) return toolbar;
  toolbar = document.createElement('div');
  toolbar.className = 'result-toolbar hidden';
  var printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'btn-secondary btn-sm print-btn';
  printBtn.textContent = 'Print';
  printBtn.addEventListener('click', function () {
    window.print();
  });
  toolbar.appendChild(printBtn);
  resultEl.parentNode.insertBefore(toolbar, resultEl);
  return toolbar;
}

function svgWidth(svg) {
  var match = /^<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  return match ? Number(match[1]) : 0;
}

// Charts keep their relative sizes: the widest fills its cell and the
// rest scale by the same factor, matching the composite on screen.
// Images rather than inline SVG, so each chart's embedded <style> stays
// scoped to that chart -- same reason as the gallery.
function buildPrintGrid(grid) {
  var root = document.createElement('div');
  root.className = 'print-grid';

  if (grid.collectionLabel) {
    var title = document.createElement('h2');
    title.className = 'print-grid-title';
    title.textContent = grid.collectionLabel;
    root.appendChild(title);
  }

  var widest = Math.max.apply(null, grid.charts.map(svgWidth));
  var sections = Array.isArray(grid.sections) ? grid.sections : [{ charts: grid.charts }];
  sections.forEach(function (section) {
    if (section.header) {
      var heading = document.createElement('h3');
      heading.className = 'print-grid-section-title';
      heading.textContent = section.header;
      root.appendChild(heading);
    }
    var row;
    section.charts.forEach(function (svg, i) {
      if (i % grid.columns === 0) {
        row = document.createElement('div');
        row.className = 'print-grid-row';
        row.style.gridTemplateColumns = 'repeat(' + grid.columns + ', minmax(0, 1fr))';
        root.appendChild(row);
      }
      var cell = document.createElement('div');
      cell.className = 'print-grid-cell';
      var img = document.createElement('img');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      img.alt = '';
      if (widest > 0) img.style.width = (svgWidth(svg) / widest) * 100 + '%';
      cell.appendChild(img);
      row.appendChild(cell);
    });
  });
  return root;
}

function clearPrintable(resultEl) {
  var next = resultEl.nextElementSibling;
  if (next && next.classList.contains('print-grid')) next.remove();
  resultEl.classList.remove('has-print-grid');
  var toolbar = resultEl.previousElementSibling;
  if (toolbar && toolbar.classList.contains('result-toolbar')) hide(toolbar);
}

function showPrintable(resultEl, data) {
  clearPrintable(resultEl);
  if (data.grid && Array.isArray(data.grid.charts) && data.grid.charts.length > 0) {
    resultEl.parentNode.insertBefore(buildPrintGrid(data.grid), resultEl.nextSibling);
    resultEl.classList.add('has-print-grid');
  }
  show(printToolbarFor(resultEl));
}

function initStartPrint() {
  $('start-print').addEventListener('click', function () {
    window.print();
  });
}

// Currently only /neck (and /document for a type: neck file) can return
// this -- a note outside firstFret/lastFret auto-expanded the range
// instead of being silently dropped (see the README's Neck diagrams
// section). `warningEl` is optional so a form with nothing that could
// produce warnings doesn't need one.
function renderWarnings(warningEl, data) {
  if (!warningEl) return;
  if (Array.isArray(data.warnings) && data.warnings.length > 0) {
    warningEl.textContent = data.warnings.join(' ');
    show(warningEl);
  } else {
    hide(warningEl);
    warningEl.textContent = '';
  }
}

function showError(errorEl, message) {
  errorEl.textContent = message;
  show(errorEl);
}

// ---------------------------------------------------------------------------
// Shared render/loading/error/result flow for every form. `route` picks
// the renderer (/chart, /bulk, /neck, /document, /triads -- see src/api).

// ---------------------------------------------------------------------------

function submitChart(route, body, ui) {
  hide(ui.errorEl);
  ui.errorEl.textContent = '';
  if (ui.warningEl) {
    hide(ui.warningEl);
    ui.warningEl.textContent = '';
  }
  ui.resultEl.innerHTML = '';
  clearPrintable(ui.resultEl);
  show(ui.loadingEl);
  ui.submitBtn.disabled = true;
  var originalLabel = ui.submitBtn.textContent;
  ui.submitBtn.textContent = 'Rendering...';

  // Deferred a tick so the "Rendering..." state paints before a large
  // render (which runs synchronously on this thread) starts.
  new Promise(function (resolve) {
    setTimeout(resolve, 0);
  })
    .then(function () {
      return window.ChordChartsEngine.render(route, body);
    })
    .then(function (result) {
      if (!result.ok) {
        showError(ui.errorEl, result.error || 'Something went wrong. Please try again.');
        return;
      }
      renderResult(ui.resultEl, result.data);
      showPrintable(ui.resultEl, result.data);
      renderWarnings(ui.warningEl, result.data);
      if (ui.onSuccess) ui.onSuccess(result.data);
    })
    .catch(function (err) {
      console.error(err);
      showError(ui.errorEl, 'Something went wrong while rendering. Please try again.');
    })
    .finally(function () {
      hide(ui.loadingEl);
      ui.submitBtn.disabled = false;
      ui.submitBtn.textContent = originalLabel;
    });
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

var MODE_TABS = [
  { tab: 'tab-start', panel: 'panel-start' },
  { tab: 'tab-single', panel: 'panel-single' },
  { tab: 'tab-bulk', panel: 'panel-bulk' },
  { tab: 'tab-triads', panel: 'panel-triads' },
  { tab: 'tab-scale', panel: 'panel-scale' },
  { tab: 'tab-neck', panel: 'panel-neck' },
  { tab: 'tab-document', panel: 'panel-document' }
];

var DEFAULT_TAB = 'tab-start';
var LAST_TAB_KEY = 'fretcharts.lastTab';

// Exposes programmatic tab switching (beyond the click listeners below) so
// the upload/permalink-loading flows can jump to the tab matching a
// document's type -- populated by initModeToggle, called by
// initDocumentUpload/loadFromPermalink. onActivate lets a tab do work only
// once it's actually shown (the Start tab's gallery renders that way).
var TabControl = {
  activateTab: function () {},
  onActivate: function () {}
};

// Storage can be missing or throw (private windows, blocked site data), so
// both helpers fail quietly -- remembering the tab is only a convenience.
function readLastTab() {
  try {
    return window.localStorage.getItem(LAST_TAB_KEY);
  } catch (err) {
    return null;
  }
}

function saveLastTab(tabId) {
  try {
    window.localStorage.setItem(LAST_TAB_KEY, tabId);
  } catch (err) {
    // ignore
  }
}

function initModeToggle() {
  var entries = MODE_TABS.map(function (m) {
    return { tabEl: $(m.tab), panelEl: $(m.panel), listeners: [] };
  });

  function activate(active) {
    entries.forEach(function (entry) {
      var isActive = entry === active;
      entry.tabEl.classList.toggle('active', isActive);
      entry.tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
      entry.panelEl.classList.toggle('active', isActive);
    });
    saveLastTab(active.tabEl.id);
    active.listeners.forEach(function (fn) {
      fn();
    });
  }

  function find(tabId) {
    return entries.filter(function (entry) {
      return entry.tabEl.id === tabId;
    })[0];
  }

  entries.forEach(function (entry) {
    entry.tabEl.addEventListener('click', function () {
      activate(entry);
    });
  });

  TabControl.activateTab = function (tabId) {
    var match = find(tabId);
    if (match) activate(match);
  };

  TabControl.onActivate = function (tabId, fn) {
    var match = find(tabId);
    if (match) match.listeners.push(fn);
  };
}

// Called once at startup, after every tab's init has run: reopens whichever
// tab was used last, or Start for a first visit. A #doc= permalink picks
// its own tab instead (see loadFromPermalink), so this stays out of its way.
function restoreLastTab() {
  if (/(?:^|[#&])doc=/.test(window.location.hash)) return;
  var tabId = readLastTab();
  var known = MODE_TABS.some(function (m) {
    return m.tab === tabId;
  });
  TabControl.activateTab(known ? tabId : DEFAULT_TAB);
}

// ---------------------------------------------------------------------------
// Single chord mode
// ---------------------------------------------------------------------------

// Collects the Single chord tab's current field values into a plain
// object -- shape matches both /chart's request body (once `format` is
// added) AND a type: chord document's fields 1:1 (the internal camelCase
// names are identical in both places by design). Shared by the submit
// handler and the "FretCharts File" button below.
function buildSingleFields() {
  var fields = [
    { name: 'label', el: $('single-label'), type: 'text' },
    { name: 'tuning', el: $('single-tuning'), type: 'text' },
    { name: 'root', el: $('single-root'), type: 'text' },
    { name: 'transpose', el: $('single-transpose'), type: 'number' },
    { name: 'labelPitches', el: $('single-labelPitches'), type: 'checkbox' },
    { name: 'labelTuning', el: $('single-labelTuning'), type: 'checkbox' },
    { name: 'stylesheet', el: $('single-stylesheet'), type: 'text' },
    { name: 'defs', el: $('single-defs'), type: 'text' }
  ];
  var body = collectFields(fields);
  mergeJsonOrPerStringFields(body, 'single');
  // Note shapes: single-chord-tab-only (see initJsonOrPerStringField's own
  // call site below) -- not part of JSON_OR_PER_STRING_FIELD_NAMES/
  // mergeJsonOrPerStringFields since those also drive the Bulk tab's
  // "Shared defaults" pane, which has no matching Note shapes control.
  var noteShapes = getJsonOrPerStringValue('single-noteShapes');
  if (noteShapes !== '') body.noteShapes = noteShapes;
  var notation = $('single-notation').value.trim();
  if (notation) body.notation = notation;
  return body;
}

// The reverse of buildSingleFields: populates the Single chord tab's
// fields from an uploaded type: chord document's fields.
function populateSingleForm(fields) {
  $('single-notation').value = fields.notation || '';
  $('single-label').value = fields.label || '';
  $('single-tuning').value = fields.tuning || '';
  $('single-root').value = fields.root || '';
  $('single-transpose').value = fields.transpose !== undefined ? String(fields.transpose) : '';
  $('single-labelPitches').checked = !!fields.labelPitches;
  $('single-labelTuning').checked = !!fields.labelTuning;
  $('single-stylesheet').value = fields.stylesheet || '';
  $('single-defs').value = fields.defs || '';
  setJsonOrPerStringField('single-stringLabels', fields.stringLabels);
  setJsonOrPerStringField('single-fingerPositions', fields.fingerPositions);
  setJsonOrPerStringField('single-noteClasses', fields.noteClasses);
  setJsonOrPerStringField('single-noteShapes', fields.noteShapes);
}

function initSingleForm() {
  var form = $('form-single');
  var errorEl = $('single-error');
  var loadingEl = $('single-loading');
  var resultEl = $('single-result');
  var submitBtn = $('single-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var body = buildSingleFields();
    if (!body.notation) {
      showError(errorEl, 'Notation is required.');
      return;
    }
    body.format = getCheckedRadioValue(form, 'format') || 'svg';

    submitChart('/chart', body, {
      errorEl: errorEl,
      loadingEl: loadingEl,
      resultEl: resultEl,
      submitBtn: submitBtn
    });
  });
}

// ---------------------------------------------------------------------------
// Bulk / CSV mode
// ---------------------------------------------------------------------------

// Collects the Multiple chords tab's current field values -- shape
// matches both /bulk's request body AND a type: chords document's fields
// 1:1. Shared by the submit handler and the "FretCharts File" button.
function buildBulkFields() {
  var topLevelFields = [
    { name: 'collectionLabel', el: $('bulk-collectionLabel'), type: 'text' },
    { name: 'columns', el: $('bulk-columns'), type: 'number' },
    { name: 'transpose', el: $('bulk-transpose'), type: 'number' },
    { name: 'stylesheet', el: $('bulk-stylesheet'), type: 'text' },
    { name: 'defs', el: $('bulk-defs'), type: 'text' }
  ];
  var defaultFields = [
    { name: 'tuning', el: $('bulk-tuning'), type: 'text' },
    { name: 'labelPitches', el: $('bulk-labelPitches'), type: 'checkbox' },
    { name: 'labelTuning', el: $('bulk-labelTuning'), type: 'checkbox' }
  ];

  var body = collectFields(topLevelFields);
  var csv = $('bulk-csv').value.trim();
  if (csv) body.csv = csv;

  var defaults = collectFields(defaultFields);
  mergeJsonOrPerStringFields(defaults, 'bulk');
  if (Object.keys(defaults).length > 0) {
    body.defaults = defaults;
  }
  return body;
}

// The reverse of buildBulkFields: populates the Multiple chords tab's
// fields from an uploaded type: chords document's fields. defaults.root
// and the per-string defaults.stringLabel1..6/fingerPosition1..6
// overrides have no matching UI field on this tab (it only exposes the
// aggregate JSON-or-per-string fields), so they're silently skipped, same
// as this tab's own "FretCharts File" button never emits them either.
function populateBulkForm(fields) {
  $('bulk-csv').value = fields.csv || '';
  $('bulk-collectionLabel').value = fields.collectionLabel || '';
  $('bulk-columns').value = fields.columns !== undefined ? String(fields.columns) : '';
  $('bulk-transpose').value = fields.transpose !== undefined ? String(fields.transpose) : '';
  $('bulk-stylesheet').value = fields.stylesheet || '';
  $('bulk-defs').value = fields.defs || '';
  var defaults = fields.defaults || {};
  $('bulk-tuning').value = defaults.tuning || '';
  $('bulk-labelPitches').checked = !!defaults.labelPitches;
  $('bulk-labelTuning').checked = !!defaults.labelTuning;
  setJsonOrPerStringField('bulk-stringLabels', defaults.stringLabels);
  setJsonOrPerStringField('bulk-fingerPositions', defaults.fingerPositions);
  setJsonOrPerStringField('bulk-noteClasses', defaults.noteClasses);
}

function initBulkForm() {
  var form = $('form-bulk');
  var errorEl = $('bulk-error');
  var loadingEl = $('bulk-loading');
  var resultEl = $('bulk-result');
  var submitBtn = $('bulk-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var body = buildBulkFields();
    if (!body.csv) {
      showError(errorEl, 'CSV input is required.');
      return;
    }
    body.format = getCheckedRadioValue(form, 'format') || 'svg';

    submitChart('/bulk', body, {
      errorEl: errorEl,
      loadingEl: loadingEl,
      resultEl: resultEl,
      submitBtn: submitBtn
    });
  });
}

// ---------------------------------------------------------------------------
// Triads mode
//
// Posts the progression and search constraints to /triads, which returns
// the rendered grid plus the bulk-mode CSV it was rendered from. The CSV
// is shown below the grid and can be downloaded, or sent to the Multiple
// chords tab -- where the existing FretCharts File/Copy link buttons and
// per-chart defaults all apply to it, so this tab doesn't duplicate them.
// ---------------------------------------------------------------------------

// The most recent successful /triads response's CSV, or null.
var lastTriadsCsv = null;

function buildTriadsFields() {
  var body = collectFields([
    { name: 'chords', el: $('triads-chords'), type: 'text' },
    { name: 'key', el: $('triads-key'), type: 'text' },
    { name: 'strings', el: $('triads-strings'), type: 'text' },
    { name: 'floor', el: $('triads-floor'), type: 'text' },
    { name: 'direction', el: $('triads-direction'), type: 'text' },
    { name: 'maxSpan', el: $('triads-maxSpan'), type: 'number' },
    { name: 'maxFret', el: $('triads-maxFret'), type: 'number' },
    { name: 'tuning', el: $('triads-tuning'), type: 'text' },
    { name: 'collectionLabel', el: $('triads-collectionLabel'), type: 'text' },
    { name: 'columns', el: $('triads-columns'), type: 'number' },
    { name: 'stylesheet', el: $('triads-stylesheet'), type: 'text' },
    { name: 'defs', el: $('triads-defs'), type: 'text' }
  ]);
  return body;
}

function setTriadsCsv(csv) {
  lastTriadsCsv = csv;
  $('triads-csv').textContent = csv || '';
  $('triads-download').disabled = !csv;
  $('triads-to-bulk').disabled = !csv;
  if (csv) show($('triads-csv-panel'));
  else hide($('triads-csv-panel'));
}

function initTriadsForm() {
  var form = $('form-triads');
  var errorEl = $('triads-error');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var body = buildTriadsFields();
    if (!body.chords) {
      showError(errorEl, 'Enter at least one chord.');
      return;
    }
    body.format = getCheckedRadioValue(form, 'format') || 'svg';

    setTriadsCsv(null);
    submitChart('/triads', body, {
      errorEl: errorEl,
      loadingEl: $('triads-loading'),
      resultEl: $('triads-result'),
      submitBtn: $('triads-submit'),
      onSuccess: function (data) {
        setTriadsCsv(typeof data.csv === 'string' ? data.csv : null);
      }
    });
  });

  $('triads-download').addEventListener('click', function () {
    if (lastTriadsCsv) triggerDownload('triads.csv', lastTriadsCsv, 'text/csv');
  });

  $('triads-to-bulk').addEventListener('click', function () {
    if (!lastTriadsCsv) return;
    var body = buildTriadsFields();
    populateBulkForm({
      csv: lastTriadsCsv.trim(),
      collectionLabel: body.collectionLabel,
      columns: body.columns,
      stylesheet: body.stylesheet,
      defs: body.defs
    });
    TabControl.activateTab('tab-bulk');
    refreshAllDocumentPreviews();
  });
}

// ---------------------------------------------------------------------------
// Marker rows: shared by Scale chart and Neck diagram mode, both of which
// render an unbounded list of {string, fret, label, className, finger, shape}
// markers -- unlike every other multi-value field in this app (all fixed
// at 6 slots, one per string), this is a genuinely dynamic add/remove-row
// table rather than a toggle over a fixed set of inputs. Rows have no ids
// (an arbitrary-length list can't use the "${prefix}-string-N" convention
// the fixed-6-slot fields use); they're read back purely by class via
// querySelectorAll, scoped to the given form's own "${prefix}-marker-rows"
// container so Scale chart and Neck diagram keep independent row lists.
// ---------------------------------------------------------------------------

function createMarkerRow() {
  var row = document.createElement('div');
  row.className = 'marker-row';
  row.innerHTML =
    '<select class="marker-string">' +
    STRING_NUMBERS.map(function (n) {
      return '<option value="' + n + '">' + n + '</option>';
    }).join('') +
    '</select>' +
    '<input type="number" class="marker-fret" min="0" step="1" placeholder="3" />' +
    '<input type="text" class="marker-label" placeholder="R" />' +
    '<input type="text" class="marker-class" placeholder="root" />' +
    '<input type="number" class="marker-finger" min="1" max="5" step="1" placeholder="2" />' +
    '<select class="marker-shape">' +
    '<option value="">○ Default</option>' +
    '<option value="circle">○ Circle</option>' +
    '<option value="square">□ Square</option>' +
    '<option value="triangle">△ Triangle</option>' +
    '<option value="diamond">◇ Diamond</option>' +
    '</select>' +
    '<button type="button" class="marker-row-remove" aria-label="Remove marker">&times;</button>';
  row.querySelector('.marker-row-remove').addEventListener('click', function () {
    row.remove();
  });
  return row;
}

function initMarkerRows(prefix) {
  var addBtn = $(prefix + '-add-marker');
  var list = $(prefix + '-marker-rows');
  if (!addBtn || !list) return;

  addBtn.addEventListener('click', function () {
    list.appendChild(createMarkerRow());
  });

  list.appendChild(createMarkerRow()); // start with one empty row
}

// A row with a blank Fret is treated as unused and skipped -- String's
// <select> always has *some* value (it's not free-text), so Fret is the
// right "is this row actually filled in" signal, not "both blank".
function collectMarkers(prefix) {
  var rows = document.querySelectorAll('#' + prefix + '-marker-rows .marker-row');
  var markers = [];
  rows.forEach(function (row) {
    var fret = row.querySelector('.marker-fret').value.trim();
    if (fret === '') return;

    var marker = {
      string: Number(row.querySelector('.marker-string').value),
      fret: Number(fret)
    };

    var label = row.querySelector('.marker-label').value.trim();
    if (label !== '') marker.label = label;

    var className = row.querySelector('.marker-class').value.trim();
    if (className !== '') marker.className = className;

    var finger = row.querySelector('.marker-finger').value.trim();
    if (finger !== '') marker.finger = Number(finger);

    var shape = row.querySelector('.marker-shape').value.trim();
    if (shape !== '') marker.shape = shape;

    markers.push(marker);
  });
  return markers;
}

// Scale/neck only (chord notation isn't handled here -- see the "Bake
// into notes" checkbox's own hint text): when checked and a Transpose
// value is set, shifts every marker's fret (and, for neck, an explicit
// firstFret/lastFret window) by that amount and drops `fields.transpose`
// entirely, instead of leaving the original frets plus a separate
// transpose: field for buildDocument to apply at render time. This is a
// client-side convenience mirroring transposeMarkers/transposeFretRange
// (src/transpose.ts) -- not authoritative, so a shift that would put any
// marker below the nut (fret 0) just leaves everything unbaked rather
// than attempting the shift, alerting the user only when `alertOnFailure`
// (true for the actual Document/Copy link buttons; false for the live
// preview, which would otherwise pop an alert on every keystroke).
function applyBakeTranspose(prefix, fields, alertOnFailure) {
  var bakeEl = $(prefix + '-bakeTranspose');
  if (!bakeEl || !bakeEl.checked || fields.transpose === undefined) return;

  var amount = fields.transpose;
  var shifted = fields.notes.map(function (marker) {
    var copy = {};
    for (var key in marker) {
      if (Object.prototype.hasOwnProperty.call(marker, key)) copy[key] = marker[key];
    }
    copy.fret = marker.fret + amount;
    return copy;
  });
  // Same idea for brackets (client-side transposeBrackets).
  var shiftedBrackets = (fields.brackets || []).map(function (b) {
    var copy = { startFret: b.startFret + amount, endFret: b.endFret + amount, label: b.label };
    if (b.className !== undefined) copy.className = b.className;
    return copy;
  });
  if (
    shifted.some(function (marker) { return marker.fret < 0; }) ||
    shiftedBrackets.some(function (b) { return b.startFret < 0; })
  ) {
    if (alertOnFailure) {
      window.alert(
        'Transposing by ' + amount + ' would put a note or bracket below the nut (fret 0) -- notes were left ' +
          'unbaked, with transpose: ' + amount + ' still applied at render time.'
      );
    }
    return;
  }

  fields.notes = shifted;
  if (fields.brackets !== undefined) fields.brackets = shiftedBrackets;
  if (fields.firstFret !== undefined) fields.firstFret = Math.max(0, fields.firstFret + amount);
  if (fields.lastFret !== undefined) fields.lastFret = fields.lastFret + amount;
  delete fields.transpose;
}

// Shared by initDownloadButtons/initShareButtons/initDocumentPreviews --
// `alertOnFailure` distinguishes an actual save/share action (alert on a
// failed bake) from the live preview (stay silent; see
// applyBakeTranspose's own comment).
function collectScaleFields(alertOnFailure) {
  var fields = buildScaleFields();
  fields.notes = collectMarkers('scale');
  var brackets = collectBrackets('scale');
  if (brackets.length > 0) fields.brackets = brackets;
  applyBakeTranspose('scale', fields, alertOnFailure);
  return fields;
}

function collectNeckFields(alertOnFailure) {
  var fields = buildNeckFields();
  fields.notes = collectMarkers('neck');
  var brackets = collectBrackets('neck');
  if (brackets.length > 0) fields.brackets = brackets;
  applyBakeTranspose('neck', fields, alertOnFailure);
  return fields;
}

// The reverse of collectMarkers: replaces a form's marker rows with one
// row per given marker (used when an uploaded document's fields populate
// this tab). Always leaves at least one row, matching initMarkerRows'
// "start with one empty row" convention, so the UI never looks broken.
function populateMarkerRows(prefix, markers) {
  var list = $(prefix + '-marker-rows');
  if (!list) return;
  list.innerHTML = '';
  (markers && markers.length > 0 ? markers : [{}]).forEach(function (marker) {
    var row = createMarkerRow();
    if (marker.string !== undefined) row.querySelector('.marker-string').value = String(marker.string);
    if (marker.fret !== undefined) row.querySelector('.marker-fret').value = String(marker.fret);
    if (marker.label !== undefined) row.querySelector('.marker-label').value = String(marker.label);
    if (marker.className !== undefined) row.querySelector('.marker-class').value = String(marker.className);
    if (marker.finger !== undefined) row.querySelector('.marker-finger').value = String(marker.finger);
    if (marker.shape !== undefined) row.querySelector('.marker-shape').value = String(marker.shape);
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Bracket rows: shared by Scale chart and Neck diagram mode, each with its
// own "${prefix}-bracket-rows" list. Same dynamic add/remove-row pattern
// as the marker rows above, for {startFret, endFret, label, className}
// fret-range brackets. Unlike marker rows, the list starts empty --
// brackets are optional, and most charts have none.
// ---------------------------------------------------------------------------

function createBracketRow() {
  var row = document.createElement('div');
  row.className = 'bracket-row';
  row.innerHTML =
    '<input type="number" class="bracket-start" min="0" step="1" placeholder="2" aria-label="Start fret" />' +
    '<input type="number" class="bracket-end" min="0" step="1" placeholder="5" aria-label="End fret" />' +
    '<input type="text" class="bracket-label" placeholder="C shape" aria-label="Label" />' +
    '<input type="text" class="bracket-class" placeholder="caged-c" aria-label="Class" />' +
    '<button type="button" class="marker-row-remove" aria-label="Remove bracket">&times;</button>';
  row.querySelector('.marker-row-remove').addEventListener('click', function () {
    row.remove();
  });
  return row;
}

function initBracketRows(prefix) {
  var addBtn = $(prefix + '-add-bracket');
  var list = $(prefix + '-bracket-rows');
  if (!addBtn || !list) return;
  addBtn.addEventListener('click', function () {
    var row = createBracketRow();
    list.appendChild(row);
    row.querySelector('.bracket-start').focus();
  });
}

// Rows missing a start fret or label are skipped as unused (same spirit
// as collectMarkers' blank-Fret rule); a blank end fret means a
// single-fret bracket.
function collectBrackets(prefix) {
  var rows = document.querySelectorAll('#' + prefix + '-bracket-rows .bracket-row');
  var brackets = [];
  rows.forEach(function (row) {
    var start = row.querySelector('.bracket-start').value.trim();
    var label = row.querySelector('.bracket-label').value.trim();
    if (start === '' || label === '') return;
    var end = row.querySelector('.bracket-end').value.trim();
    var bracket = { startFret: Number(start), endFret: Number(end === '' ? start : end), label: label };
    var className = row.querySelector('.bracket-class').value.trim();
    if (className !== '') bracket.className = className;
    brackets.push(bracket);
  });
  return brackets;
}

// The reverse of collectBrackets. Leaves the list empty when there are
// no brackets (unlike populateMarkerRows' "at least one row").
function populateBracketRows(prefix, brackets) {
  var list = $(prefix + '-bracket-rows');
  if (!list) return;
  list.innerHTML = '';
  (Array.isArray(brackets) ? brackets : []).forEach(function (b) {
    var row = createBracketRow();
    row.querySelector('.bracket-start').value = String(b.startFret);
    row.querySelector('.bracket-end').value = String(b.endFret);
    row.querySelector('.bracket-label').value = String(b.label);
    if (b.className !== undefined) row.querySelector('.bracket-class').value = String(b.className);
    list.appendChild(row);
  });
}

// Collects the Scale chart tab's non-marker field values -- shape matches
// both /chart's request body and a type: scale document's fields (minus
// `notes`, which the caller adds separately since the submit handler
// wants it JSON-stringified but the download button wants the raw marker
// array -- see buildScaleFields' two call sites).
function buildScaleFields() {
  var fields = [
    { name: 'label', el: $('scale-label'), type: 'text' },
    { name: 'tuning', el: $('scale-tuning'), type: 'text' },
    { name: 'mutedStrings', el: $('scale-mutedStrings'), type: 'text' },
    { name: 'transpose', el: $('scale-transpose'), type: 'number' },
    { name: 'labelPitches', el: $('scale-labelPitches'), type: 'checkbox' },
    { name: 'labelTuning', el: $('scale-labelTuning'), type: 'checkbox' },
    { name: 'stylesheet', el: $('scale-stylesheet'), type: 'text' },
    { name: 'defs', el: $('scale-defs'), type: 'text' }
  ];
  var body = collectFields(fields);
  // labelFrets defaults to ON in the renderer, unlike every other checkbox
  // here (which default to off/omitted) -- collectFields' checkbox type
  // only ever sends `true`, never `false`, so it can't express "explicitly
  // turned off." Set it explicitly instead, always, so unchecking this box
  // actually reaches the renderer as `labelFrets: false`.
  body.labelFrets = $('scale-labelFrets').checked;
  return body;
}

// The reverse of buildScaleFields (+ marker rows): populates the Scale
// chart tab from an uploaded type: scale document's fields.
function populateScaleForm(fields) {
  $('scale-label').value = fields.label || '';
  $('scale-tuning').value = fields.tuning || '';
  $('scale-mutedStrings').value = fields.mutedStrings || '';
  $('scale-transpose').value = fields.transpose !== undefined ? String(fields.transpose) : '';
  $('scale-labelPitches').checked = !!fields.labelPitches;
  $('scale-labelTuning').checked = !!fields.labelTuning;
  // undefined means "on" for this one (see buildScaleFields' comment).
  $('scale-labelFrets').checked = fields.labelFrets !== false;
  $('scale-stylesheet').value = fields.stylesheet || '';
  $('scale-defs').value = fields.defs || '';
  populateMarkerRows('scale', fields.notes);
  populateBracketRows('scale', fields.brackets);
}

function initScaleForm() {
  initBracketRows('scale');
  var form = $('form-scale');
  var errorEl = $('scale-error');
  var loadingEl = $('scale-loading');
  var resultEl = $('scale-result');
  var submitBtn = $('scale-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var markers = collectMarkers('scale');
    if (markers.length === 0) {
      showError(errorEl, 'At least one marker (with a fret) is required.');
      return;
    }

    var body = buildScaleFields();
    // The client already has real marker objects from the row inputs, so
    // this just sends JSON text -- exactly like the JSON-or-per-string
    // toggle's JSON mode already does -- letting the renderer's already-
    // tested parser handle it, no compact-notation string-building needed
    // here.
    body.notes = JSON.stringify(markers);
    var brackets = collectBrackets('scale');
    if (brackets.length > 0) body.brackets = JSON.stringify(brackets);
    body.format = getCheckedRadioValue(form, 'format') || 'svg';

    submitChart('/chart', body, {
      errorEl: errorEl,
      loadingEl: loadingEl,
      resultEl: resultEl,
      submitBtn: submitBtn
    });
  });
}

// ---------------------------------------------------------------------------
// Neck diagram mode
//
// Same marker model/UI as Scale chart (see above), posted to a separate
// endpoint (/neck) with its own fret-range fields (firstFret/lastFret).
// Unlike Scale chart, there's no notation-argument alternative to guard
// against -- markers are always required, mirroring how buildNeckDiagram
// takes `notes` as a required positional parameter.
// ---------------------------------------------------------------------------

// Same split as buildScaleFields -- non-marker fields only, notes handled
// separately by each caller (see buildScaleFields' comment).
function buildNeckFields() {
  var fields = [
    { name: 'label', el: $('neck-label'), type: 'text' },
    { name: 'tuning', el: $('neck-tuning'), type: 'text' },
    { name: 'mutedStrings', el: $('neck-mutedStrings'), type: 'text' },
    { name: 'labelPitches', el: $('neck-labelPitches'), type: 'checkbox' },
    { name: 'labelTuning', el: $('neck-labelTuning'), type: 'checkbox' },
    { name: 'firstFret', el: $('neck-firstFret'), type: 'number' },
    { name: 'lastFret', el: $('neck-lastFret'), type: 'number' },
    { name: 'transpose', el: $('neck-transpose'), type: 'number' },
    { name: 'stylesheet', el: $('neck-stylesheet'), type: 'text' },
    { name: 'defs', el: $('neck-defs'), type: 'text' }
  ];
  var body = collectFields(fields);
  // labelFrets defaults to ON in the renderer -- see buildScaleFields' comment.
  body.labelFrets = $('neck-labelFrets').checked;
  return body;
}

// The reverse of buildNeckFields (+ marker rows): populates the Neck
// diagram tab from an uploaded type: neck document's fields.
function populateNeckForm(fields) {
  $('neck-label').value = fields.label || '';
  $('neck-tuning').value = fields.tuning || '';
  $('neck-mutedStrings').value = fields.mutedStrings || '';
  $('neck-labelPitches').checked = !!fields.labelPitches;
  $('neck-labelTuning').checked = !!fields.labelTuning;
  // undefined means "on" for this one (see buildScaleFields' comment).
  $('neck-labelFrets').checked = fields.labelFrets !== false;
  $('neck-firstFret').value = fields.firstFret !== undefined ? String(fields.firstFret) : '';
  $('neck-lastFret').value = fields.lastFret !== undefined ? String(fields.lastFret) : '';
  $('neck-transpose').value = fields.transpose !== undefined ? String(fields.transpose) : '';
  $('neck-stylesheet').value = fields.stylesheet || '';
  $('neck-defs').value = fields.defs || '';
  populateMarkerRows('neck', fields.notes);
  populateBracketRows('neck', fields.brackets);
}

function initNeckForm() {
  initBracketRows('neck');
  var form = $('form-neck');
  var errorEl = $('neck-error');
  var warningEl = $('neck-warning');
  var loadingEl = $('neck-loading');
  var resultEl = $('neck-result');
  var submitBtn = $('neck-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var markers = collectMarkers('neck');
    if (markers.length === 0) {
      showError(errorEl, 'At least one marker (with a fret) is required.');
      return;
    }

    var body = buildNeckFields();
    // Same "real marker objects -> JSON text" approach as Scale chart mode.
    body.notes = JSON.stringify(markers);
    var brackets = collectBrackets('neck');
    if (brackets.length > 0) body.brackets = JSON.stringify(brackets);
    body.format = getCheckedRadioValue(form, 'format') || 'svg';

    submitChart('/neck', body, {
      errorEl: errorEl,
      warningEl: warningEl,
      loadingEl: loadingEl,
      resultEl: resultEl,
      submitBtn: submitBtn
    });
  });
}

// ---------------------------------------------------------------------------
// Document mode
//
// Unlike every other form, the whole chart definition lives in one text
// blob (the document itself) rather than individual fields -- styling
// included, since a document carries its own stylesheet/stylesheetFile
// and defs/defsFile fields -- so there's no separate theme picker here.
// The file picker is a client-side convenience only: it reads a local
// file's text into the textarea via FileReader; nothing is uploaded until
// Render is clicked, and external stylesheetFile/defsFile/csvFile
// references inside the document text still aren't supported in the web UI
// (see the field's hint text in index.html) -- the picker just saves
// re-typing/pasting.
//
// Uploading tries to auto-populate the tab matching the document's type:
// (see TYPE_TO_TAB/POPULATE_FOR_TYPE below), using documentSync.js's own
// small parser -- a convenience layer, not the authoritative one (the
// /document renderer, backed by the real `yaml` package, is what
// actually renders). If it can't confidently parse the file (outside
// documentSync.js's deliberately narrow scope -- see that file's doc
// comment) or the document references an external stylesheetFile/defsFile/
// csvFile (which no tab's fields can represent), auto-populate is skipped: a
// clear message shows in the Document tab's own error box, switching
// there (from wherever the file was picked, or on initial page load for
// a permalink -- see loadFromPermalink) so it's immediately visible, and
// the raw text lands in the Document tab's textarea regardless.
// ---------------------------------------------------------------------------

var TYPE_TO_TAB = {
  chord: 'tab-single',
  scale: 'tab-scale',
  neck: 'tab-neck',
  chords: 'tab-bulk'
};

var POPULATE_FOR_TYPE = {
  chord: populateSingleForm,
  scale: populateScaleForm,
  neck: populateNeckForm,
  chords: populateBulkForm
};

// Shared by initDocumentUpload (below) and loadFromPermalink -- both start
// from raw document text obtained a different way (a picked file vs. a
// URL fragment) but do the exact same thing with it from here on: always
// load the raw text into the Document tab (so it's never lost, even on
// success elsewhere), then try to also auto-populate + switch to the
// matching tab, falling back to the Document tab alone with a clear
// message when that's not possible.
function applyDocumentText(text) {
  var textArea = $('document-text');
  var errorEl = $('document-error');
  if (!textArea) return;
  textArea.value = text;
  hide(errorEl);
  hide($('document-warning'));

  var parsed;
  try {
    parsed = DocumentSync.parse(text);
  } catch (err) {
    showError(
      errorEl,
      "Couldn't auto-fill a matching tab (" +
        err.message +
        '). Loaded as text below instead -- you can edit and render it directly here.'
    );
    TabControl.activateTab('tab-document');
    return;
  }

  if (
    parsed.fields.stylesheetFile !== undefined ||
    parsed.fields.defsFile !== undefined ||
    (parsed.type === 'chords' && parsed.fields.csvFile !== undefined)
  ) {
    showError(
      errorEl,
      'This FretCharts file references an external stylesheetFile/defsFile/csvFile, which no tab\'s ' +
        'fields can represent. Loaded as text below instead -- edit it here, or use inline ' +
        'stylesheet:/defs:/csv: fields instead.'
    );
    TabControl.activateTab('tab-document');
    return;
  }

  // A newer file may use fields no tab here knows about, which populating
  // a tab would silently drop -- render it as text instead, where the
  // renderer does a best-effort job and lists what it had to ignore.
  if (isNewerVersion(parsed.fields.version)) {
    var warningEl = $('document-warning');
    warningEl.textContent =
      'This file was written by FretCharts ' +
      parsed.fields.version +
      ', newer than this one (' +
      currentVersion() +
      '). Loaded as text below instead of into a tab, so nothing it uses is lost -- ' +
      'rendering it here is a best effort, and some features may be missing or look different.';
    show(warningEl);
    TabControl.activateTab('tab-document');
    return;
  }

  var populate = POPULATE_FOR_TYPE[parsed.type];
  var tabId = TYPE_TO_TAB[parsed.type];
  if (populate && tabId) {
    populate(parsed.fields);
    refreshAllDocumentPreviews();
    TabControl.activateTab(tabId);
  }
}

function initDocumentUpload() {
  var fileInput = $('upload-file');
  if (!fileInput) return;

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      applyDocumentText(String(reader.result || ''));
    };
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// Download as document: every tab (including Document mode itself) gets a
// button that serializes its CURRENT field values into document YAML/text
// and triggers a browser download -- client-side only, nothing leaves
// the browser. Combined with upload-populates-tab above, this is what lets
// a document be uploaded, edited on its matching tab, and re-downloaded
// with the edits.
// ---------------------------------------------------------------------------

function triggerDownload(filename, text, mimeType) {
  var blob = new Blob([text], { type: mimeType || 'text/yaml' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Scale/neck's "Compact notation for notes" checkbox (id
// "${prefix}-document-preview-compact") started as a preview-only control
// (see the Live document preview section below), but it reads more like a
// standing format preference than a preview toggle -- so the Download/
// Copy link buttons honor it too, via this shared lookup, rather than
// adding a second, redundant checkbox just for those buttons. Every
// generated file is also stamped with this release's version (see
// src/version.ts), the minimum needed to render it.
function stringifyOptions(prefix) {
  var toggle = $(prefix + '-document-preview-compact');
  return { compactNotes: toggle ? toggle.checked : undefined, version: currentVersion() };
}

function currentVersion() {
  var engine = window.ChordChartsEngine;
  return engine && engine.VERSION ? engine.VERSION : undefined;
}

function initVersionFooter() {
  var slot = $('app-version');
  var version = currentVersion();
  if (slot && version) slot.textContent = ' v' + version;
}

// True when `version` (a parsed file's own `version` field) names a newer
// release than this one. Anything that isn't a well-formed version is left
// for the real parser behind /document to reject.
function isNewerVersion(version) {
  var engine = window.ChordChartsEngine;
  if (!engine || !engine.VERSION || typeof version !== 'string' || !engine.isVersion(version)) return false;
  return engine.compareVersions(version, engine.VERSION) > 0;
}

// `collectFn` returns a fields object matching `docType`'s document
// schema (the same `build*Fields`/collectMarkers helpers each tab's
// submit handler already uses) -- `null` skips wiring for a tab that
// doesn't apply (defensive; every tab currently has a button).
function initDownloadButton(prefix, docType, collectFn) {
  var btn = $(prefix + '-download');
  if (!btn || !collectFn) return;
  btn.addEventListener('click', function () {
    var yamlText = DocumentSync.stringify(docType, collectFn(), stringifyOptions(prefix));
    triggerDownload(prefix + '.yaml', yamlText);
  });
}

function initDownloadButtons() {
  initDownloadButton('single', 'chord', buildSingleFields);
  initDownloadButton('bulk', 'chords', buildBulkFields);
  initDownloadButton('scale', 'scale', function () {
    return collectScaleFields(true);
  });
  initDownloadButton('neck', 'neck', function () {
    return collectNeckFields(true);
  });

  // Document mode's own text is already exactly what would be
  // downloaded -- no DocumentSync.stringify needed, just save it as-is.
  var documentDownloadBtn = $('document-download');
  if (documentDownloadBtn) {
    documentDownloadBtn.addEventListener('click', function () {
      var text = $('document-text').value;
      if (!text.trim()) return;
      triggerDownload('document.yaml', text);
    });
  }
}

// ---------------------------------------------------------------------------
// Shareable permalinks: the current tab's document, encoded straight into
// the URL (a "#doc=..." fragment, never sent to any server -- unlike
// a query string, a fragment isn't part of the HTTP request at all) so a
// chart/scale/neck diagram/CSV grid can be shared with just a link, no
// file involved. Loading one back on page load reuses the exact same
// applyDocumentText this tab already uses for uploads (see above) --
// a permalink and an uploaded file are the same kind of event from the
// app's point of view, just sourced differently.
//
// btoa/atob only handle Latin1 text; encodeURIComponent/decodeURIComponent
// + escape/unescape is the standard, dependency-free way to make that
// UTF-8-safe (so e.g. a "♭" in a label survives). The plain base64
// alphabet's "+"/"/"/"=" are then swapped for URL-safe equivalents
// ("base64url") purely so the link behaves well when pasted into things
// that might mangle those characters (chat clients, some URL shorteners)
// -- a fragment doesn't strictly require it, but it's cheap insurance.
// ---------------------------------------------------------------------------

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64url) {
  var base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return base64;
}

function encodeDocumentForUrl(text) {
  return toBase64Url(utf8ToBase64(text));
}

function decodeDocumentFromUrl(encoded) {
  return base64ToUtf8(fromBase64Url(encoded));
}

// navigator.clipboard.writeText requires a secure context (https, or
// localhost for local testing) -- both this app's real deployment and
// its documented local-dev setup already satisfy that. Where it's
// unavailable, shareDocumentText's caller falls back to just displaying
// the link for the user to copy manually, rather than reaching for a
// legacy execCommand('copy') shim for an edge case this narrow.
function copyToClipboard(text) {
  if (window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
    return window.navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Clipboard API not available'));
}

function showShareStatus(el, message) {
  if (!el) return;
  el.textContent = message;
  show(el);
}

// Encodes `text` into the URL (updating the visible address bar via
// replaceState -- no navigation/reload -- so it visibly matches what's
// on the clipboard), then tries to copy the resulting link, showing
// either a success confirmation or the link itself to copy by hand.
function shareDocumentText(text, statusEl) {
  var hash = '#doc=' + encodeDocumentForUrl(text);
  window.history.replaceState(null, '', hash);
  var url = window.location.origin + window.location.pathname + hash;
  copyToClipboard(url).then(
    function () {
      showShareStatus(statusEl, 'Link copied to clipboard!');
    },
    function () {
      showShareStatus(statusEl, url);
    }
  );
}

// `collectFn` mirrors initDownloadButton's -- see its comment.
function initShareButton(prefix, docType, collectFn) {
  var btn = $(prefix + '-share');
  var statusEl = $(prefix + '-share-status');
  if (!btn || !collectFn) return;
  btn.addEventListener('click', function () {
    shareDocumentText(DocumentSync.stringify(docType, collectFn(), stringifyOptions(prefix)), statusEl);
  });
}

function initShareButtons() {
  initShareButton('single', 'chord', buildSingleFields);
  initShareButton('bulk', 'chords', buildBulkFields);
  initShareButton('scale', 'scale', function () {
    return collectScaleFields(true);
  });
  initShareButton('neck', 'neck', function () {
    return collectNeckFields(true);
  });

  // Document mode's own text is already exactly what would be shared --
  // no DocumentSync.stringify needed, just share it as-is.
  var documentShareBtn = $('document-share');
  if (documentShareBtn) {
    documentShareBtn.addEventListener('click', function () {
      var text = $('document-text').value;
      if (!text.trim()) return;
      shareDocumentText(text, $('document-share-status'));
    });
  }
}

// ---------------------------------------------------------------------------
// Live document preview: an optional collapsible section on each of the
// single/bulk/scale/neck tabs showing the document text that tab's current
// field values represent (same docType/collectFn pairing as
// initDownloadButtons/initShareButtons above -- see initDownloadButton's
// comment). Scale chart/Neck diagram also get a "Compact notation for
// notes" checkbox (id "${prefix}-document-preview-compact") toggling
// `notes` between a compact-notation string ("6:3:R;5:2:b3") and the native
// YAML list -- see stringifyOptions above, which the Download/Copy link
// buttons also read from this same checkbox, so the preview always matches
// what actually gets downloaded/shared. Single/Bulk have no such checkbox
// (no notes field), so they always preview the one form their document
// type has.
//
// Kept in sync via one delegated listener per form -- 'input'/'change'
// cover every field edit (including the compact-notation checkbox itself),
// and 'click' catches the marker-row add/remove buttons (scale/neck) and
// the theme picker, none of which touch a value in a way 'input'/'change'
// would see directly, but which do bubble a click/change up to the form
// after they've already updated the DOM/fields.
//
// Programmatic populates (document upload, permalinks, quick examples) set
// field values directly without dispatching any events, so those call
// refreshAllDocumentPreviews() themselves afterward -- see applyDocumentText
// and initQuickExamples below.
// ---------------------------------------------------------------------------

var DOCUMENT_PREVIEW_REFRESHERS = {};

// `collectFn` mirrors initDownloadButton's -- see its comment.
function initDocumentPreview(prefix, docType, collectFn) {
  var form = $('form-' + prefix);
  var pre = $(prefix + '-document-preview');
  if (!form || !pre || !collectFn) return;

  function refresh() {
    pre.textContent = DocumentSync.stringify(docType, collectFn(), stringifyOptions(prefix));
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('click', refresh);

  DOCUMENT_PREVIEW_REFRESHERS[prefix] = refresh;
  refresh();
}

function initDocumentPreviews() {
  initDocumentPreview('single', 'chord', buildSingleFields);
  initDocumentPreview('bulk', 'chords', buildBulkFields);
  initDocumentPreview('scale', 'scale', function () {
    return collectScaleFields(false);
  });
  initDocumentPreview('neck', 'neck', function () {
    return collectNeckFields(false);
  });
}

function refreshAllDocumentPreviews() {
  Object.keys(DOCUMENT_PREVIEW_REFRESHERS).forEach(function (prefix) {
    DOCUMENT_PREVIEW_REFRESHERS[prefix]();
  });
}

// Called once at startup: if the page was opened via a permalink
// ("#doc=..."), decode and load it the same way an uploaded file would
// be. Absent or unparseable-as-base64 is silently ignored (not every
// page load has one -- that's the common case, not an error); a
// corrupted encoding gets a clear message instead of a raw exception.
function loadFromPermalink() {
  var match = /(?:^|[#&])doc=([^&]+)/.exec(window.location.hash);
  if (!match) return;
  var text;
  try {
    text = decodeDocumentFromUrl(match[1]);
  } catch (err) {
    // document-error lives inside the Document tab's panel (hidden along
    // with the rest of it unless that tab is active) -- switch there so
    // this is actually visible, same as applyDocumentText's own failure
    // paths already do.
    showError($('document-error'), "This link's FretCharts file data couldn't be decoded -- it may be corrupted or truncated.");
    TabControl.activateTab('tab-document');
    return;
  }
  applyDocumentText(text);
}

function initDocumentForm() {
  var form = $('form-document');
  var errorEl = $('document-error');
  var warningEl = $('document-warning');
  var loadingEl = $('document-loading');
  var resultEl = $('document-result');
  var submitBtn = $('document-submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var text = $('document-text').value.trim();
    if (!text) {
      showError(errorEl, 'FretCharts file text is required (paste one in, or load a file above).');
      return;
    }

    var body = {
      document: text,
      format: getCheckedRadioValue(form, 'format') || 'svg'
    };

    submitChart('/document', body, {
      errorEl: errorEl,
      warningEl: warningEl,
      loadingEl: loadingEl,
      resultEl: resultEl,
      submitBtn: submitBtn
    });
  });
}

// ---------------------------------------------------------------------------
// Quick-start examples
//
// One-click "Try:" buttons on the Single chord/Scale chart/Neck diagram
// tabs (index.html's .quick-examples), for a first-time visitor who
// hasn't learned the notation grammar yet. Reuses the exact same
// populate*Form functions the document-upload flow already relies on --
// an example is just fields data, the same shape a parsed document's
// fields already take.
// ---------------------------------------------------------------------------

var QUICK_EXAMPLES = {
  'single-a-major': function () {
    populateSingleForm({ notation: 'x02220', label: 'A Major', root: '5' });
  },
  'single-g-major': function () {
    populateSingleForm({ notation: '320003', label: 'G Major', root: '6' });
  },
  'single-e-minor': function () {
    populateSingleForm({ notation: '022000', label: 'E Minor' });
  },
  'scale-pentatonic-box': function () {
    populateScaleForm({
      label: 'Minor Pentatonic Box (partial)',
      notes: [
        { string: 6, fret: 3, label: 'R', className: 'root' },
        { string: 6, fret: 5, label: '2' },
        { string: 5, fret: 2, label: 'b3' },
        { string: 5, fret: 5, label: '4' }
      ],
      mutedStrings: '1,2'
    });
  },
  'neck-root-5-shape': function () {
    populateNeckForm({
      notes: [
        { string: 6, fret: 7, label: 'R' },
        { string: 5, fret: 7, label: '5' },
        { string: 4, fret: 7, label: 'R' }
      ],
      firstFret: 5,
      lastFret: 17,
      label: 'Root-5 shape',
      tuning: 'DADGBE'
    });
  }
};

function initQuickExamples() {
  var buttons = document.querySelectorAll('.example-btn');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var apply = QUICK_EXAMPLES[btn.getAttribute('data-example')];
      if (apply) {
        apply();
        refreshAllDocumentPreviews();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Gallery
//
// One card per GALLERY_EXAMPLES entry (gallery.js): the FretCharts file's
// text on the left, its render on the right. Cards are built up front but
// only rendered the first time the Start tab is shown, so a returning
// visitor who lands on another tab doesn't pay for a dozen renders.
// "Open in editor" goes through applyDocumentText, the same path an
// uploaded file takes, so it lands on the tab matching the file's type.
// ---------------------------------------------------------------------------

function buildGalleryCard(example) {
  var card = document.createElement('article');
  card.className = 'gallery-card';
  card.id = 'gallery-' + example.id;

  var header = document.createElement('header');
  header.className = 'gallery-card-header';
  var kind = document.createElement('span');
  kind.className = 'gallery-kind';
  kind.textContent = example.kind;
  var title = document.createElement('h3');
  title.textContent = example.title;
  var description = document.createElement('p');
  description.className = 'gallery-description';
  description.textContent = example.description;
  header.appendChild(kind);
  header.appendChild(title);
  header.appendChild(description);

  var source = document.createElement('div');
  source.className = 'gallery-source';
  var pre = document.createElement('pre');
  pre.className = 'document-preview-text gallery-document';
  pre.textContent = example.document;
  var openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn-secondary btn-sm gallery-open';
  openBtn.textContent = 'Open in editor';
  openBtn.addEventListener('click', function () {
    applyDocumentText(example.document);
    $('tab-start').scrollIntoView({ block: 'nearest' });
  });
  source.appendChild(pre);
  source.appendChild(openBtn);

  var output = document.createElement('div');
  output.className = 'gallery-output';
  var errorEl = document.createElement('div');
  errorEl.className = 'error-box hidden';
  errorEl.setAttribute('role', 'alert');
  var resultEl = document.createElement('div');
  resultEl.className = 'result-box';
  output.appendChild(errorEl);
  output.appendChild(resultEl);

  var body = document.createElement('div');
  body.className = 'gallery-card-body';
  body.appendChild(source);
  body.appendChild(output);

  card.appendChild(header);
  card.appendChild(body);
  return { el: card, example: example, errorEl: errorEl, resultEl: resultEl };
}

function renderGalleryCard(card) {
  return window.ChordChartsEngine.render('/document', { document: card.example.document, format: 'svg' }).then(
    function (result) {
      if (!result.ok) {
        showError(card.errorEl, result.error || 'This example failed to render.');
        return;
      }

      // An <img>, not inline markup: an inline SVG's <style> applies to
      // the whole page, so a dozen of them would restyle each other (and
      // every other tab's result). Inside an <img> each one's CSS stays
      // scoped to its own chart.
      var img = document.createElement('img');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.data.svg);
      img.alt = card.example.title;
      card.resultEl.innerHTML = '';
      card.resultEl.appendChild(img);
    }
  );
}

function initGallery() {
  var list = $('gallery-list');
  if (!list || typeof GALLERY_EXAMPLES === 'undefined') return;

  var cards = GALLERY_EXAMPLES.map(buildGalleryCard);
  cards.forEach(function (card) {
    list.appendChild(card.el);
  });

  var rendered = false;
  TabControl.onActivate('tab-start', function () {
    if (rendered) return;
    rendered = true;
    // One at a time, each a tick apart, so the tab paints right away
    // and the cards fill in top to bottom instead of all at once.
    cards.reduce(function (previous, card) {
      return previous.then(function () {
        return new Promise(function (resolve) {
          setTimeout(resolve, 0);
        }).then(function () {
          return renderGalleryCard(card);
        });
      });
    }, Promise.resolve()).catch(function (err) {
      console.error(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  initModeToggle();
  ['single', 'bulk'].forEach(function (formPrefix) {
    JSON_OR_PER_STRING_FIELD_NAMES.forEach(function (name) {
      initJsonOrPerStringField(formPrefix + '-' + name);
    });
  });
  // Note shapes: single-chord-tab-only -- see buildSingleFields' comment.
  initJsonOrPerStringField('single-noteShapes');
  ['single', 'bulk', 'triads', 'scale', 'neck'].forEach(function (formPrefix) {
    initThemePicker(formPrefix);
  });
  initSingleForm();
  initBulkForm();
  initTriadsForm();
  initMarkerRows('scale');
  initScaleForm();
  initMarkerRows('neck');
  initNeckForm();
  initDocumentUpload();
  initDocumentForm();
  initDownloadButtons();
  initShareButtons();
  initDocumentPreviews();
  initQuickExamples();
  initGallery();
  initStartPrint();
  initVersionFooter();
  restoreLastTab();
  loadFromPermalink();
});
