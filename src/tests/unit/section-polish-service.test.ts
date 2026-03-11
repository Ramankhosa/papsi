import { describe, expect, it } from 'vitest';
import { buildDriftReport, truncateContentToWordLimit } from '../../lib/services/section-polish-service';

describe('buildDriftReport', () => {
  it('passes when required citation coverage is preserved even if other drift exists', () => {
    const base = 'The method improved accuracy to 92% [CITE:Smith2024].';
    const polished = 'The method improved performance [CITE:Smith2024] and [CITE:Lee2025].';

    const report = buildDriftReport(base, polished, [
      {
        dimensionKey: 'accuracy',
        dimensionLabel: 'Accuracy',
        expectedCitationKeys: ['Smith2024']
      }
    ]);

    expect(report.citationParity.passed).toBe(false);
    expect(report.numberPreservation.passed).toBe(false);
    expect(report.dimensionCoverage?.passed).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('fails when required citation coverage is missing', () => {
    const base = 'The method improved accuracy [CITE:Smith2024].';
    const polished = 'The method improved accuracy substantially.';

    const report = buildDriftReport(base, polished, [
      {
        dimensionKey: 'accuracy',
        dimensionLabel: 'Accuracy',
        expectedCitationKeys: ['Smith2024']
      }
    ]);

    expect(report.dimensionCoverage?.passed).toBe(false);
    expect(report.dimensionCoverage?.uncoveredDimensions).toEqual(['Accuracy']);
    expect(report.passed).toBe(false);
  });

  it('passes when no must-cite expectations are provided', () => {
    const base = 'Baseline value was 42 [CITE:Smith2024].';
    const polished = 'Baseline findings changed.';

    const report = buildDriftReport(base, polished);

    expect(report.citationParity.passed).toBe(false);
    expect(report.numberPreservation.passed).toBe(false);
    expect(report.dimensionCoverage).toBeUndefined();
    expect(report.passed).toBe(true);
  });
});

describe('truncateContentToWordLimit', () => {
  it('keeps small overages within the soft tolerance', () => {
    const content = Array.from({ length: 110 }, (_, index) => `word${index}`).join(' ');

    const result = truncateContentToWordLimit(content, 100);

    expect(result.trimmed).toBe(false);
    expect(result.originalWords).toBe(110);
    expect(result.finalWords).toBe(110);
  });

  it('trims large overages near a sentence boundary', () => {
    const content = Array.from(
      { length: 14 },
      (_, sentenceIndex) => Array.from(
        { length: 10 },
        (_, wordIndex) => `s${sentenceIndex}w${wordIndex}`
      ).join(' ') + '.'
    ).join(' ');

    const result = truncateContentToWordLimit(content, 100);

    expect(result.trimmed).toBe(true);
    expect(result.originalWords).toBe(140);
    expect(result.finalWords).toBeLessThanOrEqual(115);
    expect(result.finalWords).toBeGreaterThanOrEqual(70);
    expect(result.content.endsWith('.')).toBe(true);
  });
});
