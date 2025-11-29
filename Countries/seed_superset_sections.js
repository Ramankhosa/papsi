/**
 * Seed Superset Sections to Database
 * 
 * This script populates the SupersetSection table from the SUPERSET_PROMPTS
 * defined in code. Run this after creating the table.
 * 
 * Run with: node Countries/seed_superset_sections.js
 * 
 * Options:
 *   --force    Overwrite existing sections
 *   --dry-run  Show what would be done without making changes
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  force: args.includes('--force'),
  dryRun: args.includes('--dry-run')
}

// ============================================================================
// Superset Sections Definition
// This mirrors SUPERSET_PROMPTS from src/lib/drafting-service.ts
// ============================================================================

const SUPERSET_SECTIONS = [
  {
    sectionKey: 'title',
    displayOrder: 1,
    label: 'Title of the Invention',
    description: 'The title should be brief, descriptive, and indicative of the technical field.',
    isRequired: true,
    instruction: `**Role:** Formalities Officer (US/EP/PCT Compliance).

**Task:** Generate a strict, descriptive Title.

**Input Data:** {{ABSTRACT_OR_SUMMARY}}

**Drafting Logic (Chain-of-Thought):**

1. **Analyze Subject:** Is this a System, Method, Apparatus, or Composition?

2. **Identify Core Function:** What is the technical function (e.g., "compressing video"), not the result (e.g., "watching movies faster").

3. **Filter Profanity:** Check for and remove banned words: *Novel, Improved, Smart, Intelligent, New, Best*.

4. **Format:** Remove any starting articles ("A", "The").

**Output Constraint:** Maximum 15 words. Sentence case. No period at the end.`,
    constraints: [
      'Maximum 15 words',
      'Sentence case',
      'No period at the end',
      'No banned words: Novel, Improved, Smart, Intelligent, New, Best',
      'Remove starting articles (A, The)'
    ]
  },
  {
    sectionKey: 'preamble',
    displayOrder: 2,
    label: 'Preamble',
    description: 'Legal preamble for patent applications (used in some jurisdictions).',
    isRequired: false,
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate the formal Preamble for an international patent application.

**Output Format:**

---
**TITLE:**
{{TITLE}}

**APPLICANT(S):**
{{APPLICANT_NAME}}
{{APPLICANT_ADDRESS}}

**INVENTOR(S):**
{{INVENTOR_NAME_1}}, residing at {{INVENTOR_ADDRESS_1}}
{{INVENTOR_NAME_2}}, residing at {{INVENTOR_ADDRESS_2}}

**PRIORITY CLAIM:** (If applicable)
Claiming priority from {{PRIOR_APPLICATION_NUMBER}} filed on {{PRIOR_FILING_DATE}} in {{PRIOR_COUNTRY}}.

---`,
    constraints: ['Format exactly as shown', 'Include all applicant and inventor details']
  },
  {
    sectionKey: 'fieldOfInvention',
    displayOrder: 3,
    label: 'Field of the Invention',
    description: 'A brief statement of the technical field to which the invention pertains.',
    isRequired: true,
    instruction: `**Role:** Classification Engine (IPC/CPC Expert).

**Task:** Generate a concise Field of Invention statement.

**Input Data:** {{INVENTION_SUMMARY}}

**Drafting Logic:**
1. Identify the primary technical domain (e.g., "data processing," "chemical compositions").
2. Identify the secondary application area if applicable.
3. Structure: "The present invention relates to [primary field], and more particularly to [specific application/sub-field]."

**Output Constraint:** 1-3 sentences maximum. No claims or advantages.`,
    constraints: [
      '1-3 sentences maximum',
      'Start with "The present invention relates to..."',
      'No claims or advantages mentioned'
    ]
  },
  {
    sectionKey: 'background',
    displayOrder: 4,
    label: 'Background of the Invention',
    description: 'Description of the prior art and problems with existing solutions.',
    isRequired: true,
    instruction: `**Role:** Prior Art Analyst and Technical Writer.

**Task:** Generate a Background section that establishes the need for the invention.

**Structure:**
1. **Technical Context** (1-2 paragraphs): Describe the general technical area.
2. **Prior Art Review** (2-3 paragraphs): Describe existing solutions and their limitations.
3. **Problem Statement** (1 paragraph): Clearly state the technical problem that needs solving.

**Guidelines:**
- Be objective; avoid disparaging prior art.
- Use neutral language: "conventional approaches" rather than "bad designs."
- Focus on technical limitations, not commercial failures.
- Do NOT mention the invention's solution in this section.`,
    constraints: [
      'Do not mention the present invention solution',
      'Use objective, neutral language',
      'Focus on technical limitations',
      '4-6 paragraphs total'
    ]
  },
  {
    sectionKey: 'objectsOfInvention',
    displayOrder: 5,
    label: 'Objects of the Invention',
    description: 'Specific objectives and goals the invention aims to achieve.',
    isRequired: false,
    instruction: `**Role:** Patent Drafting Specialist.

**Task:** Generate the Objects of the Invention section.

**Structure:**
Use the format: "It is an object of the present invention to..."
or "The principal object of this invention is to..."

**Guidelines:**
1. List 3-7 specific, technical objectives.
2. Each object should address a limitation from the background.
3. Objects should be achievable by the claimed invention.
4. Use clear, technical language.
5. Order from most important to least important.

**Output Format:**
- "It is a principal object of the present invention to provide..."
- "It is another object of the present invention to..."
- "It is yet another object of the present invention to..."`,
    constraints: [
      '3-7 specific objectives',
      'Use formal object statements',
      'Link to problems in background',
      'Technical language only'
    ]
  },
  {
    sectionKey: 'summary',
    displayOrder: 6,
    label: 'Summary of the Invention',
    description: 'A concise summary of the invention and its key features.',
    isRequired: true,
    instruction: `**Role:** Patent Claim Strategist.

**Task:** Generate a Summary that bridges the Background to the Detailed Description.

**Structure:**
1. **Solution Overview** (1 paragraph): Brief statement of what the invention provides.
2. **Key Features** (2-3 paragraphs): Describe the main technical features.
3. **Advantages** (1 paragraph): List the technical benefits achieved.

**Guidelines:**
- The summary should align with the broadest claim.
- Include all essential elements that will appear in Claim 1.
- Avoid unnecessary detail; save specifics for Detailed Description.
- Use "in one embodiment," "in some aspects," etc. to maintain flexibility.`,
    constraints: [
      'Align with broadest claim',
      'Use flexible language (embodiments, aspects)',
      '4-5 paragraphs total',
      'Include essential elements from Claim 1'
    ]
  },
  {
    sectionKey: 'technicalProblem',
    displayOrder: 7,
    label: 'Technical Problem',
    description: 'Clear statement of the technical problem solved (used in some jurisdictions like EP/JP).',
    isRequired: false,
    instruction: `**Role:** Problem-Solution Analyst.

**Task:** Generate a clear Technical Problem statement.

**Guidelines:**
1. State the objective technical problem, not a commercial problem.
2. The problem should be one that a skilled person would recognize.
3. Frame in terms of what technical effect was lacking in the prior art.
4. Should be solvable by the distinguishing features of the invention.

**Output Format:**
"The technical problem underlying the present invention is how to [achieve specific technical effect] while [overcoming specific limitation]."`,
    constraints: [
      'Objective technical problem only',
      'Must be solvable by invention features',
      '1-2 paragraphs maximum'
    ]
  },
  {
    sectionKey: 'technicalSolution',
    displayOrder: 8,
    label: 'Technical Solution',
    description: 'Description of how the invention solves the technical problem.',
    isRequired: false,
    instruction: `**Role:** Technical Solution Architect.

**Task:** Generate a Technical Solution statement that directly addresses the Technical Problem.

**Guidelines:**
1. Describe how the distinguishing features solve the technical problem.
2. Explain the cause-effect relationship between features and benefits.
3. Be specific about the technical mechanism.

**Output Format:**
"The above problem is solved according to the invention by [describing the technical solution]."`,
    constraints: [
      'Direct link to Technical Problem',
      'Explain cause-effect relationship',
      '2-4 paragraphs'
    ]
  },
  {
    sectionKey: 'advantageousEffects',
    displayOrder: 9,
    label: 'Advantageous Effects',
    description: 'Technical advantages and beneficial effects of the invention.',
    isRequired: false,
    instruction: `**Role:** Benefits Analyst.

**Task:** Generate an Advantageous Effects section.

**Guidelines:**
1. List specific, measurable technical advantages.
2. Each advantage should be supported by features in the specification.
3. Avoid superlatives or marketing language.
4. Focus on technical improvements over prior art.

**Output Format:**
List each advantage as a separate paragraph or bullet point.`,
    constraints: [
      'Specific, measurable advantages',
      'Supported by specification',
      'No marketing language',
      '3-6 advantages'
    ]
  },
  {
    sectionKey: 'briefDescriptionOfDrawings',
    displayOrder: 10,
    label: 'Brief Description of the Drawings',
    description: 'Descriptions of each figure in the patent drawings.',
    isRequired: true,
    instruction: `**Role:** Figure Cataloger.

**Task:** Generate brief descriptions for each drawing figure.

**Input Data:** {{FIGURE_LIST}}

**Output Format:**
"FIG. 1 is a [type of view] showing [what it depicts]."
"FIG. 2 is a [type of view] showing [what it depicts]."
...

**View Types:**
- Block diagram, flowchart, schematic diagram
- Perspective view, exploded view, cross-sectional view
- Front elevation, side elevation, top view
- Circuit diagram, timing diagram`,
    constraints: [
      'One sentence per figure',
      'Specify view type',
      'Briefly describe content',
      'Use consistent formatting'
    ]
  },
  {
    sectionKey: 'detailedDescription',
    displayOrder: 11,
    label: 'Detailed Description',
    description: 'Comprehensive description of the invention with reference to drawings.',
    isRequired: true,
    instruction: `**Role:** Technical Writer and Patent Enablement Specialist.

**Task:** Generate a comprehensive Detailed Description that enables one skilled in the art to practice the invention.

**Structure:**
1. **Overview** (1-2 paragraphs): General description of the invention.
2. **System/Apparatus Description**: Describe each component and its function.
3. **Method/Process Description**: Describe operational steps.
4. **Embodiments**: Describe multiple embodiments with variations.
5. **Examples**: Specific examples with parameters if applicable.

**Guidelines:**
- Reference figures: "As shown in FIG. 1, the system 100 includes..."
- Use reference numerals consistently.
- Describe best mode of practicing the invention.
- Include alternatives: "In another embodiment..."
- Be comprehensive but avoid redundancy.`,
    constraints: [
      'Enable skilled person to practice',
      'Reference figures with numerals',
      'Include multiple embodiments',
      'Describe best mode'
    ]
  },
  {
    sectionKey: 'bestMode',
    displayOrder: 12,
    label: 'Best Mode',
    description: 'Description of the best mode contemplated by the inventor (required in some jurisdictions).',
    isRequired: false,
    instruction: `**Role:** Best Mode Compliance Officer.

**Task:** Ensure the specification discloses the best mode known to the inventor.

**Guidelines:**
1. Identify the inventor's preferred embodiment.
2. Include specific parameters, materials, or configurations.
3. Do not hide or obscure the best way to practice the invention.

**Note:** This is typically integrated into the Detailed Description rather than a separate section.`,
    constraints: [
      'Disclose preferred embodiment',
      'Include specific parameters',
      'Do not obscure best mode'
    ]
  },
  {
    sectionKey: 'industrialApplicability',
    displayOrder: 13,
    label: 'Industrial Applicability',
    description: 'Statement of industrial applicability (required in some jurisdictions).',
    isRequired: false,
    instruction: `**Role:** Industrial Application Analyst.

**Task:** Generate an Industrial Applicability statement.

**Guidelines:**
1. Identify specific industries where the invention can be applied.
2. Describe how the invention can be made and used in industry.
3. Be specific about practical applications.

**Output Format:**
"The present invention has industrial applicability in [industry/field]. Specifically, it can be used for [applications]."`,
    constraints: [
      'Identify specific industries',
      'Describe practical applications',
      '1-2 paragraphs'
    ]
  },
  {
    sectionKey: 'claims',
    displayOrder: 14,
    label: 'Claims',
    description: 'The legal claims defining the scope of patent protection.',
    isRequired: true,
    instruction: `**Role:** Patent Claim Architect.

**Task:** Generate a complete claim set.

**Claim Structure:**
1. **Independent Claim 1**: Broadest apparatus/system claim
2. **Dependent Claims 2-5**: Narrowing features
3. **Independent Method Claim**: Parallel method claim
4. **Dependent Method Claims**: Narrowing method features
5. **Optional**: Product-by-process, computer-readable medium claims

**Claim Drafting Rules:**
- Single sentence per claim
- Proper antecedent basis ("a processor" then "the processor")
- Transition phrases: "comprising," "consisting of," "consisting essentially of"
- Use "configured to" or "adapted to" for functional language
- Include all essential elements
- Avoid "optionally" or "preferably" in claims`,
    constraints: [
      'Single sentence per claim',
      'Proper antecedent basis',
      'Clear transition phrases',
      '10-20 claims typical',
      'Independent + dependent structure'
    ]
  },
  {
    sectionKey: 'abstract',
    displayOrder: 15,
    label: 'Abstract',
    description: 'A brief abstract summarizing the invention for searching purposes.',
    isRequired: true,
    instruction: `**Role:** Abstract Generator (USPTO/WIPO Compliant).

**Task:** Generate a patent abstract.

**Requirements:**
- Maximum 150 words (strict limit)
- Single paragraph
- Summarize the technical disclosure
- Include the title's subject matter
- Reference key figure if drawings exist

**Structure:**
1. State what the invention is (1-2 sentences)
2. Describe key technical features (2-3 sentences)
3. State the technical advantage (1 sentence)

**Format:**
"A [type of invention] for [purpose] is disclosed. The [invention] includes [key features]. [Optional: Technical advantage]. (FIG. X)"`,
    constraints: [
      'Maximum 150 words',
      'Single paragraph',
      'Include key figure reference',
      'No claims or legal language'
    ]
  }
]

// ============================================================================
// Seeding Functions
// ============================================================================

async function getSystemUserId() {
  const superAdmin = await prisma.user.findFirst({
    where: { roles: { has: 'SUPER_ADMIN' } }
  })
  if (superAdmin) return superAdmin.id

  const anyUser = await prisma.user.findFirst()
  if (anyUser) return anyUser.id

  return null
}

async function seedSupersetSections() {
  console.log('=== Seeding Superset Sections to Database ===\n')
  console.log('Options:', options)
  console.log('')

  const systemUserId = await getSystemUserId()
  console.log(`System user: ${systemUserId || 'N/A'}\n`)

  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (const section of SUPERSET_SECTIONS) {
    try {
      const existing = await prisma.supersetSection.findUnique({
        where: { sectionKey: section.sectionKey }
      })

      if (existing && !options.force) {
        console.log(`  [SKIP] ${section.sectionKey}: Already exists`)
        skipped++
        continue
      }

      if (options.dryRun) {
        console.log(`  [DRY-RUN] Would ${existing ? 'update' : 'create'} ${section.sectionKey}`)
        if (existing) updated++
        else created++
        continue
      }

      if (existing) {
        await prisma.supersetSection.update({
          where: { sectionKey: section.sectionKey },
          data: {
            displayOrder: section.displayOrder,
            label: section.label,
            description: section.description,
            instruction: section.instruction,
            constraints: section.constraints,
            isRequired: section.isRequired,
            updatedBy: systemUserId
          }
        })
        console.log(`  [UPDATE] ${section.sectionKey}: ${section.label}`)
        updated++
      } else {
        await prisma.supersetSection.create({
          data: {
            sectionKey: section.sectionKey,
            displayOrder: section.displayOrder,
            label: section.label,
            description: section.description,
            instruction: section.instruction,
            constraints: section.constraints,
            isRequired: section.isRequired,
            isActive: true,
            createdBy: systemUserId
          }
        })
        console.log(`  [CREATE] ${section.sectionKey}: ${section.label}`)
        created++
      }
    } catch (err) {
      console.log(`  [ERROR] ${section.sectionKey}: ${err.message}`)
      errors.push({ section: section.sectionKey, error: err.message })
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Errors: ${errors.length}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    errors.forEach(e => console.log(`  - ${e.section}: ${e.error}`))
  }

  if (options.dryRun) {
    console.log('\n[DRY-RUN] No changes were made.')
  }
}

async function verifySupersetSections() {
  console.log('\n=== Verifying Superset Sections ===\n')

  const sections = await prisma.supersetSection.findMany({
    orderBy: { displayOrder: 'asc' }
  })

  // Get mapping counts separately
  const mappingCounts = await prisma.countrySectionMapping.groupBy({
    by: ['sectionKey'],
    _count: { sectionKey: true }
  })
  const countMap = Object.fromEntries(mappingCounts.map(m => [m.sectionKey, m._count.sectionKey]))

  console.log('#'.padEnd(4) + 'Key'.padEnd(25) + 'Label'.padEnd(30) + 'Req'.padEnd(6) + 'Active'.padEnd(8) + 'Mappings')
  console.log('-'.repeat(90))

  for (const s of sections) {
    console.log(
      String(s.displayOrder).padEnd(4) +
      s.sectionKey.substring(0, 23).padEnd(25) +
      s.label.substring(0, 28).padEnd(30) +
      (s.isRequired ? 'Yes' : 'No').padEnd(6) +
      (s.isActive ? 'Yes' : 'No').padEnd(8) +
      (countMap[s.sectionKey] || 0)
    )
  }

  console.log(`\nTotal: ${sections.length} sections`)
}

// Run
if (require.main === module) {
  seedSupersetSections()
    .then(() => verifySupersetSections())
    .then(() => {
      console.log('\n=== Done ===')
      process.exit(0)
    })
    .catch(err => {
      console.error('Failed:', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}

module.exports = { seedSupersetSections, SUPERSET_SECTIONS }

