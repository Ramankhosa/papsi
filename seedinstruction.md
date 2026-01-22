# Seed Instructions for Papsi (PatentNest) Application

This document outlines all the seed scripts required to set up the application database from scratch. The scripts must be run in a specific order due to dependencies between them.

## Prerequisites

1. **Database Setup**: Ensure PostgreSQL is running and the database is created
2. **Environment Variables**: `.env` file must be configured with database connection string
3. **Dependencies**: Run `npm install` first
4. **Migrations**: Sync the database schema before seeding

```bash
# Install dependencies
npm install

# Sync database schema (use db push for development, migrate deploy for production)
npx prisma db push
# OR for production:
# npx prisma migrate deploy
```

---

## Seed Scripts Execution Order

### Phase 1: Core Infrastructure (Required First)

#### 1.1 Create Tenants
Creates the basic tenant structure required for user management.

```bash
node scripts/create-basic-tenants.js
```

**Creates:**
- Platform Administration tenant (ENTERPRISE)
- Test Company Inc. tenant (ENTERPRISE)
- Solo User Demo tenant (INDIVIDUAL)

#### 1.2 Create Users
Creates test user accounts. **Requires tenants to exist first.**

```bash
node scripts/create-basic-users.js
```

**Creates:**
| Email | Password | Role |
|-------|----------|------|
| `superadmin@spotipr.com` | `SuperAdmin123!` | SUPER_ADMIN |
| `tenantadmin@spotipr.com` | `TenantAdmin123!` | ADMIN |
| `analyst@spotipr.com` | `Analyst123!` | ANALYST |
| `solouser@spotipr.com` | `SoloUser123!` | ADMIN, ANALYST |

#### 1.3 Plans & Hierarchy
Sets up features, tasks, plans, and assigns plans to tenants based on user roles.

```bash
node scripts/seed-plans-hierarchy.js
```

**Creates:**
- 5 Features (PRIOR_ART_SEARCH, PATENT_DRAFTING, DIAGRAM_GENERATION, IDEA_BANK, PERSONA_SYNC)
- 10 Tasks
- 3 Plans (FREE_PLAN, PRO_PLAN, ENTERPRISE_PLAN)
- Plan-feature associations
- Tenant plan assignments

---

### Phase 2: LLM Models & Workflow Configuration

#### 2.1 LLM Models and Workflow Stages
Seeds all LLM models and workflow stages with production token limits.

```bash
node Seed/seed-llm-models.js
```

**Creates:**
- 45+ LLM Models:
  - Google: Gemini 2.5 Pro/Flash, Gemini 2.0, Gemini 3 Pro, etc.
  - OpenAI: GPT-4o, GPT-5 series, o1 reasoning models
  - Anthropic: Claude 3.5 Sonnet/Haiku, Claude 3 Opus
  - DeepSeek: Chat, Reasoner (R1)
  - Groq: Llama 3.3/3.1, Mixtral, Gemma
- 45 Workflow Stages for:
  - Patent Drafting (25 stages)
  - Novelty/Prior Art Search (6 stages)
  - Idea Bank (3 stages)
  - Diagram Generation (4 stages)
  - Ideation Engine (7 stages)
- Plan-Stage-Model configurations with token limits

---

### Phase 3: Patent Drafting Configuration

#### 3.1 Country Master Seed
Seeds all country-specific data for multi-jurisdiction patent drafting.

```bash
node Countries/MasterSeed.js
```

**Creates:**
- 17 Superset Sections (title, preamble, claims, abstract, etc.)
- 30 Country Names with continents
- 467 Country-Section Mappings
- 56 Jurisdiction-specific Prompts (AU, CA, IN, JP, PCT, US)
- 6 Complete Country Profiles
- Jurisdiction Styles (diagram configs, export configs, validations)

**Options:**
```bash
node Countries/MasterSeed.js --force      # Overwrite existing data
node Countries/MasterSeed.js --dry-run    # Preview without changes
node Countries/MasterSeed.js --country=IN # Seed specific country only
```

---

### Phase 4: Research Paper Configuration

#### 4.1 Paper Configuration (Types, Citations, Venues)
Seeds paper types, citation styles, and publication venues.

```bash
npx tsx scripts/seed-paper-config.ts
```

**Creates:**
- 10 Paper Types:
  - Journal Article
  - Conference Paper
  - Review Article
  - PhD Thesis
  - Masters Thesis
  - Case Study
  - Technical Report
  - White Paper
  - Book Chapter
  - Short Communication

- 6 Citation Styles:
  - APA 7th Edition
  - IEEE
  - Chicago Manual of Style
  - MLA 9th Edition
  - Harvard Referencing
  - Vancouver

- 19 Publication Venues:
  - Top journals: Nature, Science, Cell, Lancet, NEJM
  - CS venues: NeurIPS, ICML, CVPR, ACL, IEEE TPAMI
  - Open access: PLOS ONE, Scientific Reports, arXiv

#### 4.2 Paper Superset Sections
Seeds base paper sections and paper type-specific overrides.

```bash
npx tsx scripts/seed-paper-superset-sections.ts
```

**Creates:**
- 20 Paper Superset Sections (abstract, introduction, methodology, etc.)
- 21 Paper Type Section Prompts

#### 4.3 Paper Prompts V2 (Action-Focused)
Seeds detailed, action-focused prompts for paper section generation.

```bash
npx tsx scripts/seed-paper-prompts-v2.ts
```

**Creates:**
- 13 Base Section Prompts with action-focused instructions
- 11 Paper Type Overrides (CONFERENCE_PAPER, BOOK_CHAPTER)
- Methodology constraint blocks (Quantitative, Qualitative, Mixed Methods, etc.)

#### 4.4 Publication Ideation Stages
Seeds workflow stages for paper ideation and writing.

```bash
npx tsx scripts/seed-publication-ideation-stages.ts
```

**Creates:**
- 19 Publication Ideation Workflow Stages:
  - Topic extraction and refinement
  - Literature search and analysis
  - Blueprint generation
  - Section generation with memory
  - Citation formatting
  - Review and coherence checking

---

## Quick Start Script

Run all seeds in order for a fresh setup:

```bash
# Phase 1: Core Infrastructure
node scripts/create-basic-tenants.js
node scripts/create-basic-users.js
node scripts/seed-plans-hierarchy.js

# Phase 2: LLM Configuration
node Seed/seed-llm-models.js

# Phase 3: Patent Drafting
node Countries/MasterSeed.js

# Phase 4: Research Paper
npx tsx scripts/seed-paper-config.ts
npx tsx scripts/seed-paper-superset-sections.ts
npx tsx scripts/seed-paper-prompts-v2.ts
npx tsx scripts/seed-publication-ideation-stages.ts
```

---

## Additional Utility Scripts

### User Management
```bash
# Create super admin with specific email
node scripts/create-super-admin.js <email>

# Create super admin viewer
node scripts/create-super-admin-viewer.js <email>

# Upgrade user to pro plan
node scripts/upgrade-individual-to-pro.js
```

### Database Utilities
```bash
# Comprehensive seed (export/import)
node scripts/comprehensive-seed.js
node scripts/comprehensive-seed.js --export-only

# Mark all users as verified
npx tsx scripts/mark-all-users-verified.ts

# List users and plans
node list-users.js
node list-plans.js
```

### Production Seeds
```bash
# Production plans (different from dev)
npm run seed:plans:prod

# Production LLM models
npm run seed:llm-models:prod
```

---

## Troubleshooting

### PowerShell Execution Policy Error (Windows)
If you see "running scripts is disabled on this system":
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Migration Errors
If migrations fail with "table does not exist":
```bash
# Use db push to sync schema directly
npx prisma db push
```

### Missing Tenants/Users
Always run tenant and user scripts before plan hierarchy:
```bash
node scripts/create-basic-tenants.js
node scripts/create-basic-users.js
node scripts/seed-plans-hierarchy.js
```

---

## Database Schema Notes

The app uses a multi-tenant architecture with:
- **Tenants**: Organizations (ENTERPRISE or INDIVIDUAL type)
- **Users**: Belong to tenants, have roles (SUPER_ADMIN, ADMIN, ANALYST)
- **Plans**: Subscription tiers with feature/task access
- **Features**: High-level capabilities (PATENT_DRAFTING, PAPER_DRAFTING, etc.)
- **Tasks**: Granular operations within features
- **LLMModel**: Available AI models with pricing
- **WorkflowStage**: Steps in drafting workflows
- **PlanStageModelConfig**: Links plans to stages with model and token limits

---

## Post-Seed Verification

After seeding, verify the setup:

1. Start the app: `npm run dev`
2. Login as `superadmin@spotipr.com` / `SuperAdmin123!`
3. Check admin panels:
   - `/super-admin/jurisdiction-config` - Country configurations
   - `/super-admin/llm-config` - LLM model assignments
   - `/super-admin/plans` - Plan configurations

---

*Last Updated: January 2026*
