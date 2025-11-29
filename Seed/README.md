# 🌱 Seed Scripts for Production Deployment

This folder contains all database seed scripts needed for deploying the multi-country patent filing system.

## Quick Start

```bash
# Run all seeds in correct order
node Seed/seed-all.js

# Run with force (overwrite existing)
node Seed/seed-all.js --force

# Dry run (preview without changes)
node Seed/seed-all.js --dry-run
```

## Individual Seeds

### 1. Superset Sections (`seed-superset-sections.js`)

Seeds the 15 universal patent sections that form the foundation:

| # | Section Key | Required |
|---|-------------|----------|
| 1 | title | Yes |
| 2 | preamble | No |
| 3 | fieldOfInvention | Yes |
| 4 | background | Yes |
| 5 | objectsOfInvention | No |
| 6 | summary | Yes |
| 7 | technicalProblem | No |
| 8 | technicalSolution | No |
| 9 | advantageousEffects | No |
| 10 | briefDescriptionOfDrawings | Yes |
| 11 | detailedDescription | Yes |
| 12 | bestMode | No |
| 13 | industrialApplicability | No |
| 14 | claims | Yes |
| 15 | abstract | Yes |

```bash
node Seed/seed-superset-sections.js
node Seed/seed-superset-sections.js --force    # Overwrite existing
node Seed/seed-superset-sections.js --dry-run  # Preview changes
```

### 2. Country Profiles (`seed-country-profiles.js`)

Seeds country profiles from JSON files in `Countries/`:

```bash
node Seed/seed-country-profiles.js
node Seed/seed-country-profiles.js --country=IN  # Specific country
node Seed/seed-country-profiles.js --force       # Overwrite existing
```

Reads from:
- `Countries/IN.json` → India
- `Countries/US.json` → United States
- `Countries/AU.json` → Australia
- `Countries/JP.json` → Japan
- `Countries/pct.json` → PCT (International)
- `Countries/canada.json` → Canada

### 3. Section Prompts (`seed-section-prompts.js`)

Seeds country-specific top-up prompts that merge with superset:

```bash
node Seed/seed-section-prompts.js
node Seed/seed-section-prompts.js --country=IN  # Specific country
node Seed/seed-section-prompts.js --force       # Overwrite existing
```

## Execution Order

**IMPORTANT:** Seeds must run in this order:

1. **Superset Sections** - Creates foundation tables
2. **Country Profiles** - Creates country configurations  
3. **Section Prompts** - Creates top-up prompts (depends on above)

The `seed-all.js` script handles this automatically.

## Database Tables Populated

| Table | Purpose |
|-------|---------|
| `superset_sections` | 15 universal section definitions |
| `country_profiles` | Country configurations & metadata |
| `country_names` | Country code → name mapping |
| `country_section_mappings` | Which sections each country uses |
| `country_section_prompts` | Country-specific prompt top-ups |
| `country_section_prompt_history` | Audit trail for prompt changes |

## Prerequisites

1. Database migrations applied:
   ```bash
   npx prisma migrate deploy
   ```

2. At least one user exists (for `createdBy` field):
   ```bash
   node scripts/setup-full-hierarchy.js
   ```

## After Seeding

Verify data in the admin UI:

1. Start server: `npm run dev`
2. Login: `superadmin@spotipr.com` / `SuperSecure123!`
3. Visit: `http://localhost:3000/super-admin/jurisdiction-config`

## Troubleshooting

### "No users found in database"
Run user setup first:
```bash
node scripts/setup-full-hierarchy.js
```

### Foreign key constraint error
Ensure migrations are applied:
```bash
npx prisma migrate deploy
npx prisma generate
```

### JSON parse error
Check JSON syntax in `Countries/*.json` files.

## Adding New Countries

1. Create `Countries/XX.json` (use `Countries/TEMPLATE_COUNTRY.json`)
2. Run: `node Seed/seed-country-profiles.js --country=XX`
3. Run: `node Seed/seed-section-prompts.js --country=XX`
4. Or use admin UI: `/super-admin/jurisdiction-config` → Add Country

