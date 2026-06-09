/**
 * Tests that saveFla → loadFla preserves all document properties.
 *
 * Covers width, height, frameRate, backgroundColor, grid settings,
 * multiple guides, and snap settings.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createDocument, createDocumentProperties } from '../../model/document.js';
import { saveFla, loadFla } from '../zip.js';
import type { FlashDocument } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Build a doc with all custom properties set
// ---------------------------------------------------------------------------

let result: FlashDocument;

const customDoc = createDocument({
  properties: createDocumentProperties({
    width: 800,
    height: 600,
    frameRate: 24,
    backgroundColor: '#336699',
    rulerUnits: 'px',
    grid: {
      showGrid: true,
      snapToGrid: true,
      gridColor: '#CCCCCC',
      gridWidth: 18,
      gridHeight: 18,
    },
    guides: [
      { id: 'g1', orientation: 'horizontal', position: 100 },
      { id: 'g2', orientation: 'vertical', position: 200 },
    ],
    snapToObjects: true,
    snapToPixels: false,
    snapToGuides: true,
  }),
});

beforeAll(() => {
  result = loadFla(saveFla(customDoc));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('docprops-roundtrip: basic dimensions and frame rate', () => {
  it('preserves width', () => {
    expect(result.properties.width).toBe(800);
  });

  it('preserves height', () => {
    expect(result.properties.height).toBe(600);
  });

  it('preserves frameRate', () => {
    expect(result.properties.frameRate).toBe(24);
  });

  it('preserves backgroundColor', () => {
    expect(result.properties.backgroundColor).toBe('#336699');
  });
});

describe('docprops-roundtrip: grid settings', () => {
  it('preserves grid.showGrid', () => {
    expect(result.properties.grid.showGrid).toBe(true);
  });

  it('preserves grid.gridWidth', () => {
    expect(result.properties.grid.gridWidth).toBe(18);
  });

  it('preserves grid.gridColor', () => {
    // FLA serialization may normalize hex to lowercase; accept both cases
    expect(result.properties.grid.gridColor.toLowerCase()).toBe('#cccccc');
  });
});

describe('docprops-roundtrip: guides', () => {
  it('preserves guide count', () => {
    expect(result.properties.guides.length).toBe(2);
  });

  it('preserves first guide orientation (horizontal) and position (100)', () => {
    const g1 = result.properties.guides.find((g) => g.id === 'g1');
    expect(g1).toBeDefined();
    expect(g1!.orientation).toBe('horizontal');
    expect(g1!.position).toBe(100);
  });

  it('preserves second guide orientation (vertical) and position (200)', () => {
    const g2 = result.properties.guides.find((g) => g.id === 'g2');
    expect(g2).toBeDefined();
    expect(g2!.orientation).toBe('vertical');
    expect(g2!.position).toBe(200);
  });
});

describe('docprops-roundtrip: snap settings', () => {
  it('preserves snapToObjects', () => {
    expect(result.properties.snapToObjects).toBe(true);
  });

  it('preserves snapToPixels', () => {
    expect(result.properties.snapToPixels).toBe(false);
  });

  it('preserves snapToGuides', () => {
    expect(result.properties.snapToGuides).toBe(true);
  });
});
