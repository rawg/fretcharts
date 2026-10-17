/**
 * A small YAML-ish reader/writer scoped exactly to this tool's own
 * FretCharts file schema (see src/document.ts's ChartDocument) -- NOT a
 * general-purpose YAML parser. The web UI has no build step and no
 * external dependencies (see README.md's Web UI section), so this exists
 * purely as a client-side convenience: `parse` lets an uploaded FretCharts
 * file auto-populate the matching tab's fields for editing, and `stringify`
 * lets any tab's current field values be downloaded as a FretCharts file.
 * The `/document` renderer (backed by the real `yaml` package)
 * remains the authoritative parser for actually rendering one --
 * if a hand-written file uses YAML syntax this module doesn't understand,
 * the worst case is that upload-populate declines with a clear message
 * (see documentSync.ParseError below); the user can still paste/submit
 * the raw text directly via the FretCharts File tab, unaffected by any
 * limitation here.
 *
 * Supported shape (deliberately narrower than YAML in general):
 *   - Top-level `key: value` pairs, 0-indented.
 *   - Scalar values: bare, single- or double-quoted strings; bare
 *     integers; bare true/false. (No floats, dates, anchors, tags, flow
 *     sequences/mappings at the top level, etc.)
 *   - `key: |` followed by an indented block of raw multi-line text
 *     (stylesheet/defs/csv).
 *   - `key:` followed by a nested one-level-deep map of `key: value`
 *     pairs, each indented exactly 2 spaces (`defaults`).
 *   - `key:` followed by a list of marker objects, each either a
 *     flow mapping (`  - { string: 6, fret: 3 }`) or a block mapping
 *     (`  - string: 6` then `    fret: 3` on following 4-space-indented
 *     lines) (`notes`).
 *   - `#`-prefixed full-line or trailing comments outside block scalars.
 *
 * Works both as a browser global (`DocumentSync`, via a plain <script>
 * tag, no bundler) and as a CommonJS module (for this file's own tests).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.DocumentSync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ParseError(message) {
    this.name = 'DocumentSyncParseError';
    this.message = message;
  }
  ParseError.prototype = Object.create(Error.prototype);
  ParseError.prototype.constructor = ParseError;

  // ---------------------------------------------------------------------
  // stringify
  // ---------------------------------------------------------------------

  function needsQuoting(str) {
    if (str === '') return true;
    if (/^\s|\s$/.test(str)) return true;
    if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(str)) return true;
    if (/: |:$/.test(str)) return true;
    if (/ #/.test(str)) return true;
    if (/^(true|false|null|~|yes|no|on|off)$/i.test(str)) return true;
    if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(str)) return true;
    if (str.indexOf('"') !== -1 || str.indexOf('\\') !== -1) return true;
    return false;
  }

  function quoteString(str) {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function scalarFor(str) {
    return needsQuoting(str) ? quoteString(str) : str;
  }

  /**
   * Same as scalarFor, but for a value embedded inside a `{ ... }` flow
   * mapping (this module's own "notes" list format, e.g.
   * `- { string: 6, fret: 3, className: root }`) -- a bare `,`/`{`/`}`/
   * `[`/`]` there is a flow-mapping delimiter, not literal content
   * (unquoted, it would be misread as ending the field early or opening a
   * nested collection), so it must be quoted even in cases where a
   * top-level `key: value` scalar wouldn't need to be (needsQuoting only
   * flags those characters when *leading* the string, which is correct
   * for a top-level scalar but not sufficient once the value is
   * comma-separated from siblings inside `{ }`).
   */
  function scalarForFlow(str) {
    return /[,{}[\]]/.test(str) ? quoteString(str) : scalarFor(str);
  }

  /**
   * Like appendField, but for a boolean that defaults to `true` in the renderer
   * (currently only `labelFrets`) -- appendField's own "skip false" rule
   * would silently mean "on" once the document is reloaded, so an explicit
   * `false` has to survive here even though every other boolean field
   * omits its default value the same way.
   */
  function appendDefaultTrueBoolean(lines, key, value) {
    if (value === false) lines.push(key + ': false');
    else if (value === true) lines.push(key + ': true');
  }

  /** Appends `key: value` (or a block scalar for multi-line strings), skipping undefined/null/''/false. */
  function appendField(lines, key, value) {
    if (value === undefined || value === null) return;
    if (typeof value === 'boolean') {
      if (value) lines.push(key + ': true');
      return;
    }
    if (typeof value === 'number') {
      if (!isFinite(value)) return;
      lines.push(key + ': ' + value);
      return;
    }
    if (typeof value !== 'string' || value === '') return;
    if (value.indexOf('\n') !== -1) {
      lines.push(key + ': |');
      var normalized = value.replace(/\r\n/g, '\n');
      var textLines = normalized.split('\n');
      if (textLines[textLines.length - 1] === '') textLines.pop();
      textLines.forEach(function (l) {
        lines.push(l === '' ? '' : '  ' + l);
      });
      return;
    }
    lines.push(key + ': ' + scalarFor(value));
  }

  function appendDefaults(lines, defaults) {
    if (!defaults || typeof defaults !== 'object') return;
    var keys = Object.keys(defaults).filter(function (k) {
      var v = defaults[k];
      return v !== undefined && v !== null && v !== '' && v !== false;
    });
    if (keys.length === 0) return;
    lines.push('defaults:');
    keys.forEach(function (k) {
      var v = defaults[k];
      if (typeof v === 'boolean') {
        lines.push('  ' + k + ': true');
      } else if (typeof v === 'number') {
        lines.push('  ' + k + ': ' + v);
      } else {
        lines.push('  ' + k + ': ' + scalarFor(String(v)));
      }
    });
  }

  /**
   * The reverse of parseCompactNotes below: one marker as
   * "string:fret[:label[:className[:finger[:shape]]]]", trimming trailing
   * omitted fields but keeping empty placeholders (e.g. "6:3::root") for
   * any omitted field that has a later one set, since position is all that
   * identifies a field in this format.
   */
  function compactNote(m) {
    var trailing = [
      m.label !== undefined && m.label !== '' ? String(m.label) : '',
      m.className !== undefined && m.className !== '' ? String(m.className) : '',
      m.finger !== undefined && m.finger !== '' ? String(m.finger) : '',
      m.shape !== undefined && m.shape !== '' ? String(m.shape) : '',
    ];
    while (trailing.length > 0 && trailing[trailing.length - 1] === '') trailing.pop();
    return [String(m.string), String(m.fret)].concat(trailing).join(':');
  }

  /**
   * One marker per line -- `appendField` below already emits a multi-line
   * string as a `notes: |` block scalar (same as it already does for a
   * multi-line stylesheet/defs), so a single marker degrades to one plain
   * `notes: 6:3:R` line, and only becomes a block scalar once there's more
   * than one.
   */
  function stringifyCompactNotes(notes) {
    return notes.map(compactNote).join('\n');
  }

  /** `compact: true` emits an array as compact-notation text (see stringifyCompactNotes) instead of a native YAML list. */
  function appendNotes(lines, notes, compact) {
    if (notes === undefined || notes === null) return;
    if (typeof notes === 'string') {
      appendField(lines, 'notes', notes);
      return;
    }
    if (!Array.isArray(notes) || notes.length === 0) return;
    if (compact) {
      appendField(lines, 'notes', stringifyCompactNotes(notes));
      return;
    }
    lines.push('notes:');
    notes.forEach(function (m) {
      var parts = ['string: ' + m.string, 'fret: ' + m.fret];
      if (m.label !== undefined && m.label !== '') parts.push('label: ' + scalarForFlow(String(m.label)));
      if (m.className !== undefined && m.className !== '') {
        parts.push('className: ' + scalarForFlow(String(m.className)));
      }
      if (m.finger !== undefined && m.finger !== '') parts.push('finger: ' + m.finger);
      if (m.shape !== undefined && m.shape !== '') parts.push('shape: ' + scalarForFlow(String(m.shape)));
      lines.push('  - { ' + parts.join(', ') + ' }');
    });
  }

  /** One bracket as compact "startFret-endFret:label[:className]" -- see src/chartFieldResolver.ts's parseBrackets. */
  function compactBracket(b) {
    return b.startFret + '-' + b.endFret + ':' + b.label + (b.className ? ':' + b.className : '');
  }

  /**
   * Scale/neck only. Same shape rules as appendNotes: a string is written as-is,
   * an array as a native YAML list -- or, with `compact`, as one
   * compact-notation bracket per line, unless some label/className holds a
   * character that format can't carry (":", ";", or a newline), in which
   * case it stays a native list rather than silently mangling the label.
   */
  function appendBrackets(lines, brackets, compact) {
    if (brackets === undefined || brackets === null) return;
    if (typeof brackets === 'string') {
      appendField(lines, 'brackets', brackets);
      return;
    }
    if (!Array.isArray(brackets) || brackets.length === 0) return;
    var compactSafe = brackets.every(function (b) {
      return !/[:;\n]/.test(String(b.label)) && !/[:;\n]/.test(String(b.className || ''));
    });
    if (compact && compactSafe) {
      appendField(lines, 'brackets', brackets.map(compactBracket).join('\n'));
      return;
    }
    lines.push('brackets:');
    brackets.forEach(function (b) {
      var parts = ['startFret: ' + b.startFret, 'endFret: ' + b.endFret, 'label: ' + scalarForFlow(String(b.label))];
      if (b.className !== undefined && b.className !== '') parts.push('className: ' + scalarForFlow(String(b.className)));
      lines.push('  - { ' + parts.join(', ') + ' }');
    });
  }

  var CHORD_FIELD_ORDER = [
    'notation',
    'label',
    'tuning',
    'root',
    'stringLabels',
    'fingerPositions',
    'noteClasses',
    'noteShapes',
    'labelPitches',
    'labelTuning',
    'transpose',
    'stylesheet',
    'defs',
  ];
  // labelFrets is handled separately, via appendDefaultTrueBoolean, not
  // this list -- see that function's comment for why.
  var SCALE_FIELD_ORDER = [
    'label',
    'tuning',
    'mutedStrings',
    'labelPitches',
    'labelTuning',
    'transpose',
    'stylesheet',
    'defs',
  ];
  var NECK_FIELD_ORDER = [
    'label',
    'tuning',
    'mutedStrings',
    'labelPitches',
    'labelTuning',
    'transpose',
    'stylesheet',
    'defs',
  ];

  /**
   * Serializes `fields` (a plain object using this tool's internal
   * camelCase field names, matching src/document.ts's ChartDocument) as a
   * document of the given `type`. Fields that are undefined/null/''/false
   * are simply omitted, matching how the rest of this tool treats "not
   * set" -- except `labelFrets` (scale/neck only), which defaults to `true`
   * in the renderer, so an explicit `false` is written out rather than dropped
   * (see appendDefaultTrueBoolean). `notes` may be a compact-notation
   * string OR an array of
   * {string, fret, label?, className?, finger?} objects, emitted as a
   * native YAML list by default -- pass `options.compactNotes: true` to
   * emit an array as compact-notation text instead, one marker per line
   * (used by the web UI's live document preview/"FretCharts File"/"Copy
   * link" buttons, to match how someone would actually hand-write a
   * scale/neck FretCharts file's notes). `options.version`, if given, is
   * written as the file's `version` right after `type` -- it takes the
   * place of any `fields.version`, which is never written.
   */
  function stringify(type, fields, options) {
    fields = fields || {};
    options = options || {};
    var lines = ['type: ' + type];
    if (options.version) lines.push('version: ' + scalarFor(options.version));

    if (type === 'chord') {
      CHORD_FIELD_ORDER.forEach(function (key) {
        appendField(lines, key, fields[key]);
      });
    } else if (type === 'scale' || type === 'neck') {
      appendNotes(lines, fields.notes, options.compactNotes);
      if (type === 'neck') {
        appendField(lines, 'firstFret', fields.firstFret);
        appendField(lines, 'lastFret', fields.lastFret);
      }
      appendBrackets(lines, fields.brackets, options.compactNotes);
      (type === 'neck' ? NECK_FIELD_ORDER : SCALE_FIELD_ORDER).forEach(function (key) {
        appendField(lines, key, fields[key]);
      });
      appendDefaultTrueBoolean(lines, 'labelFrets', fields.labelFrets);
    } else if (type === 'chords') {
      appendField(lines, 'collectionLabel', fields.collectionLabel);
      appendField(lines, 'columns', fields.columns);
      appendDefaults(lines, fields.defaults);
      appendField(lines, 'csv', fields.csv);
      appendField(lines, 'transpose', fields.transpose);
      appendField(lines, 'stylesheet', fields.stylesheet);
      appendField(lines, 'defs', fields.defs);
    } else {
      throw new ParseError('Unknown FretCharts file type: ' + type);
    }

    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------
  // parse
  // ---------------------------------------------------------------------

  function lineIndent(line) {
    var m = /^ */.exec(line);
    return m[0].length;
  }

  function stripLineComment(text) {
    // Only ever called on lines outside block-scalar content, and none of
    // our scalar values legitimately contain a " #" sequence unquoted
    // (quoted values are handled by parseScalar before this would matter)
    // -- good enough for this module's scope, see the file's doc comment.
    var inQuote = null;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '\\' && inQuote === '"') {
          i++;
          continue;
        }
        if (c === inQuote) inQuote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inQuote = c;
        continue;
      }
      if (c === '#' && (i === 0 || text[i - 1] === ' ')) {
        return text.slice(0, i);
      }
    }
    return text;
  }

  function parseScalar(text) {
    var trimmed = text.trim();
    if (trimmed === '') return '';
    if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
      return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    if (/^(true|yes|on)$/i.test(trimmed)) return true;
    if (/^(false|no|off)$/i.test(trimmed)) return false;
    if (/^(null|~)$/i.test(trimmed)) return null;
    if (/^[-+]?\d+$/.test(trimmed)) return Number(trimmed);
    if (/^[-+]?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }

  /** Parses `{ k: v, k2: "v 2" }` (values comma-separated, no nested braces). */
  function parseFlowMapping(text) {
    var inner = text.trim();
    if (inner[0] !== '{' || inner[inner.length - 1] !== '}') {
      throw new ParseError('Expected a "{ ... }" flow mapping, got: ' + text);
    }
    inner = inner.slice(1, -1).trim();
    var result = {};
    if (inner === '') return result;
    var parts = splitFlowParts(inner);
    parts.forEach(function (part) {
      var idx = part.indexOf(':');
      if (idx === -1) {
        throw new ParseError('Expected "key: value" inside a flow mapping, got: ' + part);
      }
      var key = part.slice(0, idx).trim();
      var value = parseScalar(part.slice(idx + 1));
      result[key] = value;
    });
    return result;
  }

  /** Splits "a: 1, b: \"x, y\"" on top-level commas, respecting quotes. */
  function splitFlowParts(text) {
    var parts = [];
    var current = '';
    var inQuote = null;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        current += c;
        if (c === '\\' && inQuote === '"') {
          i++;
          current += text[i] || '';
          continue;
        }
        if (c === inQuote) inQuote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inQuote = c;
        current += c;
        continue;
      }
      if (c === ',') {
        parts.push(current);
        current = '';
        continue;
      }
      current += c;
    }
    if (current.trim() !== '') parts.push(current);
    return parts;
  }

  function coerceMarker(obj, context) {
    if (obj.string === undefined || obj.fret === undefined) {
      throw new ParseError('A notes entry needs both "string" and "fret" (' + context + ')');
    }
    var marker = { string: Number(obj.string), fret: Number(obj.fret) };
    if (obj.label !== undefined && obj.label !== '') marker.label = String(obj.label);
    if (obj.className !== undefined && obj.className !== '') marker.className = String(obj.className);
    if (obj.finger !== undefined && obj.finger !== '') marker.finger = Number(obj.finger);
    if (obj.shape !== undefined && obj.shape !== '') marker.shape = String(obj.shape);
    return marker;
  }

  function coerceBracket(obj, context) {
    if (obj.startFret === undefined || obj.endFret === undefined || obj.label === undefined) {
      throw new ParseError('A brackets entry needs "startFret", "endFret", and "label" (' + context + ')');
    }
    var bracket = { startFret: Number(obj.startFret), endFret: Number(obj.endFret), label: String(obj.label) };
    if (obj.className !== undefined && obj.className !== '') bracket.className = String(obj.className);
    return bracket;
  }

  /**
   * Parses `yamlText` into `{ type, fields }`, where `fields` uses this
   * tool's internal camelCase names -- the same shape `stringify` accepts
   * back, so `parse(stringify(type, fields))` round-trips. `fields.notes`
   * (scale/neck) is always normalized to an array of marker objects, even
   * when the source document wrote it as a compact-notation string, and
   * likewise `fields.brackets` (scale/neck) to an array of bracket objects.
   *
   * @throws {ParseError} for anything outside this module's scope (see
   *   the file's doc comment) or missing/unrecognized `type`.
   */
  function parse(yamlText) {
    var rawLines = yamlText.replace(/\r\n/g, '\n').split('\n');
    var fields = {};
    var type;

    var i = 0;
    while (i < rawLines.length) {
      var rawLine = rawLines[i];
      if (rawLine.trim() === '' || rawLine.trim()[0] === '#') {
        i++;
        continue;
      }
      if (lineIndent(rawLine) !== 0) {
        throw new ParseError('Unexpected indentation on line ' + (i + 1) + ': ' + rawLine);
      }
      var line = stripLineComment(rawLine);
      var colonIdx = line.indexOf(':');
      if (colonIdx === -1) {
        throw new ParseError('Expected "key: value" on line ' + (i + 1) + ': ' + rawLine);
      }
      var key = line.slice(0, colonIdx).trim();
      var rest = line.slice(colonIdx + 1).trim();

      if (rest === '|') {
        // Block scalar: consume subsequent indented lines verbatim (no
        // comment-stripping), dedented to the first content line's indent.
        i++;
        var blockLines = [];
        var blockIndent = null;
        while (i < rawLines.length && (rawLines[i].trim() === '' || lineIndent(rawLines[i]) > 0)) {
          if (rawLines[i].trim() !== '') {
            if (blockIndent === null) blockIndent = lineIndent(rawLines[i]);
            blockLines.push(rawLines[i].slice(blockIndent));
          } else {
            blockLines.push('');
          }
          i++;
        }
        while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') blockLines.pop();
        fields[key] = blockLines.join('\n') + (blockLines.length > 0 ? '\n' : '');
        continue;
      }

      if (rest === '') {
        // Either a nested map (defaults) or a list (notes) -- decide from
        // the first following line's shape.
        i++;
        if (i >= rawLines.length || rawLines[i].trim() === '' || lineIndent(rawLines[i]) === 0) {
          fields[key] = key === 'notes' || key === 'brackets' ? [] : {};
          continue;
        }
        var firstNested = stripLineComment(rawLines[i]).trim();
        if (firstNested[0] === '-') {
          var list = [];
          while (i < rawLines.length && lineIndent(rawLines[i]) === 2 && stripLineComment(rawLines[i]).trim()[0] === '-') {
            var itemLine = stripLineComment(rawLines[i]).trim().slice(1).trim();
            if (itemLine[0] === '{') {
              var flowItem = parseFlowMapping(itemLine);
              list.push(key === 'brackets' ? coerceBracket(flowItem, 'line ' + (i + 1)) : coerceMarker(flowItem, 'line ' + (i + 1)));
              i++;
            } else {
              // Block-style list item: "- key: value" then more
              // 4-space-indented "key: value" lines for the same item.
              var obj = {};
              var firstColon = itemLine.indexOf(':');
              if (firstColon === -1) {
                throw new ParseError('Expected "key: value" in a list item on line ' + (i + 1) + ': ' + rawLines[i]);
              }
              obj[itemLine.slice(0, firstColon).trim()] = parseScalar(itemLine.slice(firstColon + 1));
              i++;
              while (i < rawLines.length && lineIndent(rawLines[i]) >= 4) {
                var subLine = stripLineComment(rawLines[i]).trim();
                var subColon = subLine.indexOf(':');
                if (subColon !== -1) {
                  obj[subLine.slice(0, subColon).trim()] = parseScalar(subLine.slice(subColon + 1));
                }
                i++;
              }
              list.push(key === 'brackets' ? coerceBracket(obj, 'near line ' + i) : coerceMarker(obj, 'near line ' + i));
            }
          }
          fields[key] = list;
          continue;
        }
        var map = {};
        while (i < rawLines.length && lineIndent(rawLines[i]) === 2) {
          var mapLine = stripLineComment(rawLines[i]).trim();
          if (mapLine === '') {
            i++;
            continue;
          }
          var mapColon = mapLine.indexOf(':');
          if (mapColon === -1) {
            throw new ParseError('Expected "key: value" on line ' + (i + 1) + ': ' + rawLines[i]);
          }
          map[mapLine.slice(0, mapColon).trim()] = parseScalar(mapLine.slice(mapColon + 1));
          i++;
        }
        fields[key] = map;
        continue;
      }

      var value = parseScalar(rest);
      if (key === 'type') {
        type = value;
      } else {
        fields[key] = value;
      }
      i++;
    }

    if (!type) {
      throw new ParseError('FretCharts file is missing a "type" field (must be "chord", "scale", "neck", or "chords")');
    }
    if (type !== 'chord' && type !== 'scale' && type !== 'neck' && type !== 'chords') {
      throw new ParseError('Unrecognized "type": ' + JSON.stringify(type));
    }

    if ((type === 'scale' || type === 'neck') && fields.notes !== undefined && typeof fields.notes === 'string') {
      fields.notes = parseCompactNotes(fields.notes);
    }
    if ((type === 'scale' || type === 'neck') && typeof fields.brackets === 'string') {
      fields.brackets = parseCompactBrackets(fields.brackets);
    }

    return { type: type, fields: fields };
  }

  /**
   * Mirrors src/chartFieldResolver.ts's parseNoteMarkersCompact:
   * "string:fret[:label[:className[:finger[:shape]]]];...", markers
   * separated by ";" and/or a newline (so a hand-written multi-line block
   * scalar with one marker per line parses the same as a single
   * ";"-joined line).
   */
  function parseCompactNotes(text) {
    var entries = text
      .split(/[;\n]/)
      .map(function (e) {
        return e.trim();
      })
      .filter(function (e) {
        return e.length > 0;
      });
    return entries.map(function (entry) {
      var fields = entry.split(':').map(function (f) {
        return f.trim();
      });
      var marker = { string: Number(fields[0]), fret: Number(fields[1]) };
      if (fields[2]) marker.label = fields[2];
      if (fields[3]) marker.className = fields[3];
      if (fields[4]) marker.finger = Number(fields[4]);
      if (fields[5]) marker.shape = fields[5];
      return marker;
    });
  }

  /**
   * Mirrors src/chartFieldResolver.ts's parseBrackets compact form:
   * "startFret-endFret:label[:className]", separated by ";" and/or a
   * newline. A JSON-array string ("[...]") is parsed as JSON.
   */
  function parseCompactBrackets(text) {
    var trimmed = text.trim();
    if (trimmed[0] === '[') {
      var list;
      try {
        list = JSON.parse(trimmed);
      } catch (e) {
        throw new ParseError('brackets is not valid JSON: ' + trimmed);
      }
      return list.map(function (b, i) {
        return coerceBracket(b, 'brackets[' + i + ']');
      });
    }
    return trimmed
      .split(/[;\n]/)
      .map(function (e) {
        return e.trim();
      })
      .filter(function (e) {
        return e.length > 0;
      })
      .map(function (entry) {
        var m = /^(\d+)\s*-\s*(\d+)\s*:([^:]*)(?::([^:]*))?$/.exec(entry);
        if (!m) {
          throw new ParseError('Expected "startFret-endFret:label[:className]" in brackets, got: ' + entry);
        }
        var bracket = { startFret: Number(m[1]), endFret: Number(m[2]), label: m[3].trim() };
        if (m[4] && m[4].trim()) bracket.className = m[4].trim();
        return bracket;
      });
  }

  return {
    parse: parse,
    stringify: stringify,
    ParseError: ParseError,
  };
});
