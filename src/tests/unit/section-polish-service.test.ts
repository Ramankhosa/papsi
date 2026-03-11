import { describe, expect, it } from 'vitest';
import { buildDriftReport } from '../../lib/services/section-polish-service';

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
