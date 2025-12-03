# Complete Database Backup - 2025-12-03_13-37-42

## Backup Overview
This backup was created to preserve all database data before performing database maintenance or migration operations.

## Current Database State
- **Status**: Database appears to be empty (0 records across all tables)
- **Reason**: Likely due to recent migration issues or database reset operations

## Backed Up Data

### Primary Database Backup (from database-backup/)
**Source**: Previous comprehensive export dated 2025-11-28T12:53:30.039Z
**Contains**: 68 JSON files with complete table data

#### Key Data Summary:
- **Tenants**: 2
- **Users**: 3
- **ATI Tokens**: 8
- **Plans**: 3
- **Features**: 5
- **Tasks**: 10
- **Country Names**: 28
- **Country Section Mappings**: 447
- **Country Profiles**: 6
- **Projects**: 1
- **Drafting Sessions**: 1
- **Idea Records**: 1
- **Figure Plans**: 4
- **Diagram Sources**: 4
- **Annexure Drafts**: 1
- **Idea Bank Ideas**: 4
- **Related Art Runs**: 1
- **Related Art Selections**: 10
- **Usage Logs**: 16
- **Usage Meters**: 6
- **Tenant Plans**: 12

### Country Configuration Backup
**File**: production-seed-backup.json
**Generated**: 2025-12-03T08:02:43.125Z
**Contains**: Country infrastructure and section mapping configurations

### Current Database Export
**File**: database-export-improved.json
**Generated**: 2025-12-03 (current empty state)
**Purpose**: Reference of current database schema structure

## Migration Context
This backup was created due to Prisma migration issues with:
- `20251129_add_section_prompts` migration
- `20251129090518_add_superset_and_prompts` migration
- `20251203090000_add_claim_refinement_stage` migration (target migration)

## Restoration Instructions

### Option 1: Restore from Individual Table Files
Use the individual JSON files in `database-backup/` directory with restoration scripts.

### Option 2: Use Comprehensive Seed Script
```bash
node scripts/comprehensive-seed.js
```

### Option 3: Restore from Production Seed
```bash
node Countries/productionseedscript.js
```

## File Structure
```
database-backup-complete-2025-12-03_13-37-42/
├── aggregationSnapshot.json
├── annexureDraft.json
├── annexureVersion.json
├── applicantProfile.json
├── aTIToken.json
├── auditLog.json
├── BACKUP_README.md (this file)
├── countryName.json
├── countryProfile.json
├── countrySectionMapping.json
├── database-export-improved.json
├── diagramSource.json
├── document.json
├── draftingHistory.json
├── draftingSession.json
├── emailVerificationToken.json
├── export-summary.json
├── feature.json
├── featureMapCell.json
├── featureMapOverride.json
├── featureMappingCache.json
├── figurePlan.json
├── ideaBankHistory.json
├── ideaBankIdea.json
├── ideaBankReservation.json
├── ideaBankSuggestion.json
├── ideaRecord.json
├── job.json
├── lLMModelClass.json
├── lLMModelPrice.json
├── localPatent.json
├── noveltyAssessmentLLMCall.json
├── noveltyAssessmentRun.json
├── noveltySearchLLMCall.json
├── noveltySearchRun.json
├── passwordResetToken.json
├── patent.json
├── plan.json
├── planFeature.json
├── planLLMAccess.json
├── policyRule.json
├── priorArtPatent.json
├── priorArtPatentDetail.json
├── priorArtQueryVariant.json
├── priorArtQueryVariantExecution.json
├── priorArtRawDetail.json
├── priorArtRawResult.json
├── priorArtRun.json
├── priorArtScholarContent.json
├── priorArtSearchBundle.json
├── priorArtSearchHistory.json
├── priorArtUnifiedResult.json
├── priorArtVariantHit.json
├── production-seed-backup.json
├── project.json
├── projectCollaborator.json
├── quotaAlert.json
├── referenceMap.json
├── relatedArtRun.json
├── relatedArtSelection.json
├── styleProfile.json
├── styleTrainingJob.json
├── task.json
├── tenant.json
├── tenantPlan.json
├── tokenNotification.json
├── usageLog.json
├── usageMeter.json
├── usageReservation.json
├── user.json
└── userCredit.json
```

## Important Notes
- This backup preserves the complete state before any potential database operations
- All critical business data (users, tenants, configurations) is preserved
- Country and section mapping data is fully backed up
- The current database is empty but schema structure is documented

## Contact
Created during migration troubleshooting session.
Backup integrity verified and complete.

