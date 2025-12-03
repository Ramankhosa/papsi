import { computeJurisdictionStateOnDelete } from '../../../src/lib/jurisdiction-state-service'

describe('computeJurisdictionStateOnDelete', () => {
  const baseSession = {
    draftingJurisdictions: ['US'],
    activeJurisdiction: 'US',
    jurisdictionDraftStatus: {
      US: { language: 'en' },
      __sourceOfTruth: 'US'
    }
  }

  it('clears active jurisdiction and source-of-truth when last jurisdiction is removed from list', () => {
    const result = computeJurisdictionStateOnDelete({
      session: baseSession,
      statusMap: { ...baseSession.jurisdictionDraftStatus },
      jurisdictions: [...baseSession.draftingJurisdictions],
      normalized: 'US',
      shouldRemove: true
    })

    expect(result.jurisdictions).toEqual([])
    expect(result.nextActive).toBeNull()
    expect((result.statusMap as any).__sourceOfTruth).toBeUndefined()
  })

  it('reassigns source-of-truth and active jurisdiction when removing one of multiple jurisdictions', () => {
    const session = {
      draftingJurisdictions: ['US', 'IN'],
      activeJurisdiction: 'US',
      jurisdictionDraftStatus: {
        US: { language: 'en' },
        IN: { language: 'en' },
        __sourceOfTruth: 'US'
      }
    }

    const result = computeJurisdictionStateOnDelete({
      session,
      statusMap: { ...session.jurisdictionDraftStatus },
      jurisdictions: [...session.draftingJurisdictions],
      normalized: 'US',
      shouldRemove: true
    })

    expect(result.jurisdictions).toContain('IN')
    expect(result.jurisdictions).not.toContain('US')
    expect(result.nextActive).toBe('IN')
    expect((result.statusMap as any).__sourceOfTruth).toBe('IN')
  })

  it('keeps jurisdiction list and source-of-truth when only clearing drafts (not removing from list)', () => {
    const result = computeJurisdictionStateOnDelete({
      session: baseSession,
      statusMap: { ...baseSession.jurisdictionDraftStatus },
      jurisdictions: [...baseSession.draftingJurisdictions],
      normalized: 'US',
      shouldRemove: false
    })

    expect(result.jurisdictions).toEqual(['US'])
    expect(result.nextActive).toBe('US')
    expect((result.statusMap as any).__sourceOfTruth).toBe('US')
  })
})

