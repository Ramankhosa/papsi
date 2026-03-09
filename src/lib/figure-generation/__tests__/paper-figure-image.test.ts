import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  getImageContentType,
  getPaperFigureImageCandidates,
  resolvePaperFigureImageUrl
} from '../paper-figure-image';

describe('paper figure image helpers', () => {
  it('rewrites local upload paths to the paper figure image API', () => {
    expect(
      resolvePaperFigureImageUrl('paper123', 'figure456', '/uploads/figures/example.png')
    ).toBe('/api/papers/paper123/figures/figure456/image');
  });

  it('returns candidate filesystem paths for public uploads', () => {
    const candidates = getPaperFigureImageCandidates('/uploads/paper-sketches/paper123/sketch.png');

    expect(candidates).toContain(
      path.join(process.cwd(), 'public', 'uploads', 'paper-sketches', 'paper123', 'sketch.png')
    );
  });

  it('infers content type from image extension', () => {
    expect(getImageContentType('chart.svg')).toBe('image/svg+xml');
    expect(getImageContentType('plot.jpg')).toBe('image/jpeg');
    expect(getImageContentType('default.png')).toBe('image/png');
  });
});
