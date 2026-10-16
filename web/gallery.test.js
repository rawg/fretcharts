/**
 * Renders every Gallery example (web/gallery.js) through the same
 * /document route the browser uses, so a typo in an example -- or a
 * renderer change that breaks one -- fails here instead of shipping a
 * broken card.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath } from 'url';
import { handleRequest } from '../src/api';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadGallery() {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(WEB_DIR, 'gallery.js'), 'utf8') + '\nthis.GALLERY_EXAMPLES = GALLERY_EXAMPLES;', context);
  return context.GALLERY_EXAMPLES;
}

const examples = loadGallery();

describe('gallery examples', () => {
  it('covers every document type', () => {
    const types = new Set(examples.map((ex) => /^type: (\w+)/m.exec(ex.document)[1]));
    expect([...types].sort()).toEqual(['chord', 'chords', 'neck', 'scale']);
  });

  it('has unique ids', () => {
    expect(new Set(examples.map((ex) => ex.id)).size).toBe(examples.length);
  });

  it.each(examples.map((ex) => [ex.id, ex]))('%s renders without errors or warnings', (_id, ex) => {
    const result = handleRequest('/document', { document: ex.document, format: 'svg' });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.svg).toMatch(/^<svg|<svg /);
    expect(result.data.warnings ?? []).toEqual([]);
  });
});
