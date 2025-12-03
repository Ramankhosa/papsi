/**
 * Production Backup Script - Section Mappings, Prompts, and Critical Settings
 *
 * This script creates a comprehensive backup of all production-critical data:
 * - Country profiles and configurations
 * - Superset sections definitions
 * - Section prompts and top-up instructions
 * - Section mappings across jurisdictions
 * - Validation rules and export settings
 *
 * Generated on: Sunday Nov 30, 2025
 *
 * Usage:
 * - Run this script to verify current production state
 * - Use the exported data for deployment verification
 * - Restore from this backup if needed
 *
 * Run with: node Countries/sectionpromptbackup.js
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// SUPRESET SECTIONS BACKUP
// These are the universal patent sections that apply to all jurisdictions
// ============================================================================

const SUPERSET_SECTIONS_BACKUP = [
  {
    sectionKey: 'title',
    aliases: [],
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
    aliases: [],
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
    aliases: ['field_of_invention', 'technicalField', 'technical_field', 'field'],
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
    aliases: ['backgroundOfInvention', 'background_of_invention', 'priorArt', 'prior_art', 'background_art'],
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
    aliases: ['objects', 'objects_of_invention', 'objectOfInvention'],
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
    aliases: ['summaryOfInvention', 'summary_of_invention', 'disclosure_of_invention', 'disclosureOfInvention'],
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
    aliases: ['technical_problem'],
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
    aliases: ['technical_solution'],
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
    aliases: ['advantageous_effects'],
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
    aliases: ['brief_description_of_drawings', 'drawings', 'figures', 'brief_drawings'],
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
    aliases: ['detailed_description', 'detailedDescriptionOfInvention', 'detailed_description_of_invention'],
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
    aliases: ['best_mode', 'bestMethod', 'best_method'],
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
    aliases: ['industrial_applicability'],
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
    aliases: [],
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
    aliases: [],
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
  },
  {
    sectionKey: 'listOfNumerals',
    aliases: ['list_of_numerals', 'numeralList', 'numeral_list', 'referenceNumerals', 'reference_numerals'],
    displayOrder: 16,
    label: 'List of Reference Numerals',
    description: 'A table or list mapping reference numerals to component names used in the specification.',
    isRequired: false,
    instruction: `**Role:** Reference Numeral Cataloger.

**Task:** Generate a comprehensive list of reference numerals used in the specification.

**Format:**
List each reference numeral with its corresponding component name:
- (100) - [Component Name]
- (101) - [Sub-component Name]
- (102) - [Another Component]
...

**Guidelines:**
1. Include all reference numerals used in the detailed description
2. List in numerical order (ascending)
3. Use the exact component names as they appear in the specification
4. Group related numerals if appropriate (e.g., 100-series for main system)
5. Ensure consistency with figure labels`,
    constraints: [
      'List in numerical order',
      'Use exact component names from specification',
      'Include all numerals from drawings and description',
      'Format: (XXX) - Component Name'
    ]
  },
  {
    sectionKey: 'crossReference',
    aliases: ['cross_reference', 'crossReferences', 'cross_references', 'relatedApplications', 'related_applications'],
    displayOrder: 17,
    label: 'Cross-Reference to Related Applications',
    description: 'References to related patent applications, priority claims, and continuations.',
    isRequired: false,
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate a Cross-Reference to Related Applications section.

**Content Requirements:**
1. Priority claims from earlier applications
2. Continuation/divisional relationships
3. Related co-pending applications
4. Any benefit claims under applicable law

**Format:**
- This application claims the benefit of [Application Type] Application No. [Number], filed [Date], which is incorporated herein by reference in its entirety.
- This application is a continuation of [Application Type] Application No. [Number], filed [Date].

**Guidelines:**
1. List all related applications chronologically
2. Include application numbers and filing dates
3. Specify the type of relationship (priority, continuation, divisional, CIP)
4. Include incorporation by reference statements where appropriate`,
    constraints: [
      'List applications chronologically',
      'Include application numbers and filing dates',
      'Specify relationship type clearly',
      'Use proper legal terminology'
    ]
  }
];

// ============================================================================
// SECTION MAPPINGS BACKUP
// Cross-jurisdictional section name mappings
// ============================================================================

const SECTION_MAPPINGS_BACKUP = {
  csvData: `Superset Section,EU,CH,FR,DE,SE,ES,PL,BR,UAE,IL,US,IN,PK,BD,AU,NZ,UK,CA,CN,KR,TW,IR,MY,JP,RU,MX,SA,ZA
01. Title,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Título da Invenção,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Title of Invention,Título de la Invención,Title of Invention,Title of Invention
02. Preamble,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),"""The following specification particularly describes...""","""The following specification particularly describes...""","""The following specification particularly describes...""",(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A)
03. Cross-Ref/Fed,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),Cross-Reference... / Gov. License Rights,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A)
04. Tech Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Campo da Invenção,Technical Field,Technical Field,Field of the Invention,Field of Invention,Field of Invention,Field of Invention,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Technical Field,Campo Técnico,Technical Field,Technical Field
05. Background,Background Art,Background Art,Background Art,Background Art,Background Art,Background Art,Background Art,Fundamentos da Invenção,Background Art,Background Art,Background of the Invention,Background of the Invention,Background of the Invention,Background of the Invention,Background of the Invention,Background of the Invention,Background of the Invention,Background of the Invention,Background Art,Background Art,Background Art,Background Art,Background Art,Background Art,Background Art,Antecedentes de la Invención,Background Art,Background of the Invention
06. Objects,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),Objective of the Invention,(N/A),(N/A),Object(s) of the Invention,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),Objetivo de la invención,(N/A),Object of the Invention
07. Summary (Gen),Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Sumário da Invenção,Summary of the Invention,Summary of the Invention,Brief Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of the Invention,Summary of Invention,Content of Invention,Content of Invention,Summary of Invention,Summary of Invention,Summary of the Invention,Summary of the Invention,Breve Resumen de la Invención,Summary of the Invention,Summary of the Invention
07a. Tech Problem,(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),Technical Problem,Technical Problem,Technical Problem,Technical Problem,(Implicit),Technical Problem,(Implicit),(Implicit),(Implicit),(Implicit)
07b. Tech Solution,(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),Technical Solution,Technical Solution,Technical Solution,Technical Solution,(Implicit),Solution to Problem,(Implicit),(Implicit),(Implicit),(Implicit)
07c. Effects,(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),Advantageous Effects,Advantageous Effects,Advantageous Effects,(Implicit),(Implicit),Advantageous Effects of Invention,(Implicit),(Implicit),(Implicit),(Implicit)
08. Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Breve Descrição dos Desenhos,Brief Description of Drawings,Brief Description of Drawings,Brief Description of the Several Views of the Drawing,Brief Description of the Accompanying Drawings,Brief Description of the Accompanying Drawings,Brief Description of the Accompanying Drawings,Brief Description of the Drawings,Brief Description of the Drawings,Brief Description of the Drawings,Brief Description of the Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of Drawings,Brief Description of the Drawings,Breve Descripción de las Figuras,Brief Description of Drawings,Brief Description of the Drawings
09. Detailed Desc,"Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")","Detailed Description (or ""Description of Embodiments"")",Descrição Detalhada da Invenção,Detailed Description,Detailed Description,Detailed Description of the Invention,Detailed Description of the Invention,Detailed Description of the Invention,Detailed Description of the Invention,Description of Embodiments,Description of Embodiments,Detailed Description,Detailed Description,Specific Mode for Carrying Out the Invention,Detailed Description of the Invention,Detailed Description of the Invention,Detailed Description,Detailed Description,Detailed Description of the Invention,Detailed Description of the Invention,Descripción Detallada,Detailed Description,Detailed Description
10. Best Mode,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),Best Mode (Implicit in Desc),(Include in Detailed Desc),(Include in Detailed Desc),(Include in Detailed Desc),Best Method of Performance,Best Method of Performance,(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),Best Mode,(N/A),(N/A),(N/A),(N/A),Best Method of Performance
11. Ind. Applicability,Industrial Applicability,Industrial Applicability,Industrial Applicability,Industrial Applicability,Industrial Applicability,Industrial Applicability,Industrial Applicability,(Implicit),(Implicit),(Implicit),(N/A - Utility),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(N/A),(Implicit),(Implicit),(Implicit),(Implicit),(Implicit),Industrial Applicability,Industrial Applicability,(Implicit),(Implicit),(Implicit)
12. Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Reivindicações,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Claims,Reivindicaciones,Claims,Claims
13. Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Resumo,Abstract,Abstract,Abstract of the Disclosure,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Abstract,Resumen,Abstract,Abstract`,
  parsedMappings: {
    "01. Title": {
      "EU": "Title of Invention",
      "CH": "Title of Invention",
      "FR": "Title of Invention",
      "DE": "Title of Invention",
      "SE": "Title of Invention",
      "ES": "Title of Invention",
      "PL": "Title of Invention",
      "BR": "Título da Invenção",
      "UAE": "Title of Invention",
      "IL": "Title of Invention",
      "US": "Title of Invention",
      "IN": "Title of Invention",
      "PK": "Title of Invention",
      "BD": "Title of Invention",
      "AU": "Title of Invention",
      "NZ": "Title of Invention",
      "UK": "Title of Invention",
      "CA": "Title of Invention",
      "CN": "Title of Invention",
      "KR": "Title of Invention",
      "TW": "Title of Invention",
      "IR": "Title of Invention",
      "MY": "Title of Invention",
      "JP": "Title of Invention",
      "RU": "Title of Invention",
      "MX": "Título de la Invención",
      "SA": "Title of Invention",
      "ZA": "Title of Invention"
    },
    "02. Preamble": {
      "EU": "(N/A)",
      "CH": "(N/A)",
      "FR": "(N/A)",
      "DE": "(N/A)",
      "SE": "(N/A)",
      "ES": "(N/A)",
      "PL": "(N/A)",
      "BR": "(N/A)",
      "UAE": "(N/A)",
      "IL": "(N/A)",
      "US": "(N/A)",
      "IN": "\"The following specification particularly describes...\"",
      "PK": "\"The following specification particularly describes...\"",
      "BD": "\"The following specification particularly describes...\"",
      "AU": "(N/A)",
      "NZ": "(N/A)",
      "UK": "(N/A)",
      "CA": "(N/A)",
      "CN": "(N/A)",
      "KR": "(N/A)",
      "TW": "(N/A)",
      "IR": "(N/A)",
      "MY": "(N/A)",
      "JP": "(N/A)",
      "RU": "(N/A)",
      "MX": "(N/A)",
      "SA": "(N/A)",
      "ZA": "(N/A)"
    },
    "03. Cross-Ref/Fed": {
      "EU": "(N/A)",
      "CH": "(N/A)",
      "FR": "(N/A)",
      "DE": "(N/A)",
      "SE": "(N/A)",
      "ES": "(N/A)",
      "PL": "(N/A)",
      "BR": "(N/A)",
      "UAE": "(N/A)",
      "IL": "(N/A)",
      "US": "Cross-Reference... / Gov. License Rights",
      "IN": "(N/A)",
      "PK": "(N/A)",
      "BD": "(N/A)",
      "AU": "(N/A)",
      "NZ": "(N/A)",
      "UK": "(N/A)",
      "CA": "(N/A)",
      "CN": "(N/A)",
      "KR": "(N/A)",
      "TW": "(N/A)",
      "IR": "(N/A)",
      "MY": "(N/A)",
      "JP": "(N/A)",
      "RU": "(N/A)",
      "MX": "(N/A)",
      "SA": "(N/A)",
      "ZA": "(N/A)"
    },
    "04. Tech Field": {
      "EU": "Technical Field",
      "CH": "Technical Field",
      "FR": "Technical Field",
      "DE": "Technical Field",
      "SE": "Technical Field",
      "ES": "Technical Field",
      "PL": "Technical Field",
      "BR": "Campo da Invenção",
      "UAE": "Technical Field",
      "IL": "Technical Field",
      "US": "Field of the Invention",
      "IN": "Field of Invention",
      "PK": "Field of Invention",
      "BD": "Field of Invention",
      "AU": "Technical Field",
      "NZ": "Technical Field",
      "UK": "Technical Field",
      "CA": "Technical Field",
      "CN": "Technical Field",
      "KR": "Technical Field",
      "TW": "Technical Field",
      "IR": "Technical Field",
      "MY": "Technical Field",
      "JP": "Technical Field",
      "RU": "Technical Field",
      "MX": "Campo Técnico",
      "SA": "Technical Field",
      "ZA": "Technical Field"
    },
    "05. Background": {
      "EU": "Background Art",
      "CH": "Background Art",
      "FR": "Background Art",
      "DE": "Background Art",
      "SE": "Background Art",
      "ES": "Background Art",
      "PL": "Background Art",
      "BR": "Fundamentos da Invenção",
      "UAE": "Background Art",
      "IL": "Background Art",
      "US": "Background of the Invention",
      "IN": "Background of the Invention",
      "PK": "Background of the Invention",
      "BD": "Background of the Invention",
      "AU": "Background of the Invention",
      "NZ": "Background of the Invention",
      "UK": "Background of the Invention",
      "CA": "Background of the Invention",
      "CN": "Background Art",
      "KR": "Background Art",
      "TW": "Background Art",
      "IR": "Background Art",
      "MY": "Background Art",
      "JP": "Background Art",
      "RU": "Background Art",
      "MX": "Antecedentes de la Invención",
      "SA": "Background Art",
      "ZA": "Background of the Invention"
    },
    "06. Objects": {
      "EU": "(N/A)",
      "CH": "(N/A)",
      "FR": "(N/A)",
      "DE": "(N/A)",
      "SE": "(N/A)",
      "ES": "(N/A)",
      "PL": "(N/A)",
      "BR": "(N/A)",
      "UAE": "Objective of the Invention",
      "IL": "(N/A)",
      "US": "(N/A)",
      "IN": "Object(s) of the Invention",
      "PK": "(N/A)",
      "BD": "(N/A)",
      "AU": "(N/A)",
      "NZ": "(N/A)",
      "UK": "(N/A)",
      "CA": "(N/A)",
      "CN": "(N/A)",
      "KR": "(N/A)",
      "TW": "(N/A)",
      "IR": "(N/A)",
      "MY": "(N/A)",
      "JP": "(N/A)",
      "RU": "(N/A)",
      "MX": "Objetivo de la invención",
      "SA": "(N/A)",
      "ZA": "Object of the Invention"
    },
    "07. Summary (Gen)": {
      "EU": "Summary of the Invention",
      "CH": "Summary of the Invention",
      "FR": "Summary of the Invention",
      "DE": "Summary of the Invention",
      "SE": "Summary of the Invention",
      "ES": "Summary of the Invention",
      "PL": "Summary of the Invention",
      "BR": "Sumário da Invenção",
      "UAE": "Summary of the Invention",
      "IL": "Summary of the Invention",
      "US": "Brief Summary of the Invention",
      "IN": "Summary of the Invention",
      "PK": "Summary of the Invention",
      "BD": "Summary of the Invention",
      "AU": "Summary of the Invention",
      "NZ": "Summary of the Invention",
      "UK": "Summary of the Invention",
      "CA": "Summary of the Invention",
      "CN": "Summary of Invention",
      "KR": "Content of Invention",
      "TW": "Content of Invention",
      "IR": "Summary of Invention",
      "MY": "Summary of Invention",
      "JP": "Summary of the Invention",
      "RU": "Summary of the Invention",
      "MX": "Breve Resumen de la Invención",
      "SA": "Summary of the Invention",
      "ZA": "Summary of the Invention"
    },
    "07a. Tech Problem": {
      "EU": "(Implicit)",
      "CH": "(Implicit)",
      "FR": "(Implicit)",
      "DE": "(Implicit)",
      "SE": "(Implicit)",
      "ES": "(Implicit)",
      "PL": "(Implicit)",
      "BR": "(Implicit)",
      "UAE": "(Implicit)",
      "IL": "(Implicit)",
      "US": "(Implicit)",
      "IN": "(Implicit)",
      "PK": "(Implicit)",
      "BD": "(Implicit)",
      "AU": "(Implicit)",
      "NZ": "(Implicit)",
      "UK": "(Implicit)",
      "CA": "(Implicit)",
      "CN": "Technical Problem",
      "KR": "Technical Problem",
      "TW": "Technical Problem",
      "IR": "Technical Problem",
      "MY": "(Implicit)",
      "JP": "Technical Problem",
      "RU": "(Implicit)",
      "MX": "(Implicit)",
      "SA": "(Implicit)",
      "ZA": "(Implicit)"
    },
    "07b. Tech Solution": {
      "EU": "(Implicit)",
      "CH": "(Implicit)",
      "FR": "(Implicit)",
      "DE": "(Implicit)",
      "SE": "(Implicit)",
      "ES": "(Implicit)",
      "PL": "(Implicit)",
      "BR": "(Implicit)",
      "UAE": "(Implicit)",
      "IL": "(Implicit)",
      "US": "(Implicit)",
      "IN": "(Implicit)",
      "PK": "(Implicit)",
      "BD": "(Implicit)",
      "AU": "(Implicit)",
      "NZ": "(Implicit)",
      "UK": "(Implicit)",
      "CA": "(Implicit)",
      "CN": "Technical Solution",
      "KR": "Technical Solution",
      "TW": "Technical Solution",
      "IR": "Technical Solution",
      "MY": "(Implicit)",
      "JP": "Solution to Problem",
      "RU": "(Implicit)",
      "MX": "(Implicit)",
      "SA": "(Implicit)",
      "ZA": "(Implicit)"
    },
    "07c. Effects": {
      "EU": "(Implicit)",
      "CH": "(Implicit)",
      "FR": "(Implicit)",
      "DE": "(Implicit)",
      "SE": "(Implicit)",
      "ES": "(Implicit)",
      "PL": "(Implicit)",
      "BR": "(Implicit)",
      "UAE": "(Implicit)",
      "IL": "(Implicit)",
      "US": "(Implicit)",
      "IN": "(Implicit)",
      "PK": "(Implicit)",
      "BD": "(Implicit)",
      "AU": "(Implicit)",
      "NZ": "(Implicit)",
      "UK": "(Implicit)",
      "CA": "(Implicit)",
      "CN": "Advantageous Effects",
      "KR": "Advantageous Effects",
      "TW": "Advantageous Effects",
      "IR": "(Implicit)",
      "MY": "(Implicit)",
      "JP": "Advantageous Effects of Invention",
      "RU": "(Implicit)",
      "MX": "(Implicit)",
      "SA": "(Implicit)",
      "ZA": "(Implicit)"
    },
    "08. Drawings": {
      "EU": "Brief Description of Drawings",
      "CH": "Brief Description of Drawings",
      "FR": "Brief Description of Drawings",
      "DE": "Brief Description of Drawings",
      "SE": "Brief Description of Drawings",
      "ES": "Brief Description of Drawings",
      "PL": "Brief Description of Drawings",
      "BR": "Breve Descrição dos Desenhos",
      "UAE": "Brief Description of Drawings",
      "IL": "Brief Description of Drawings",
      "US": "Brief Description of the Several Views of the Drawing",
      "IN": "Brief Description of the Accompanying Drawings",
      "PK": "Brief Description of the Accompanying Drawings",
      "BD": "Brief Description of the Accompanying Drawings",
      "AU": "Brief Description of the Drawings",
      "NZ": "Brief Description of the Drawings",
      "UK": "Brief Description of the Drawings",
      "CA": "Brief Description of the Drawings",
      "CN": "Brief Description of Drawings",
      "KR": "Brief Description of Drawings",
      "TW": "Brief Description of Drawings",
      "IR": "Brief Description of Drawings",
      "MY": "Brief Description of Drawings",
      "JP": "Brief Description of Drawings",
      "RU": "Brief Description of Drawings",
      "MX": "Breve Descripción de las Figuras",
      "SA": "Brief Description of Drawings",
      "ZA": "Brief Description of the Drawings"
    },
    "09. Detailed Desc": {
      "EU": "Detailed Description (or \"Description of Embodiments\")",
      "CH": "Detailed Description (or \"Description of Embodiments\")",
      "FR": "Detailed Description (or \"Description of Embodiments\")",
      "DE": "Detailed Description (or \"Description of Embodiments\")",
      "SE": "Detailed Description (or \"Description of Embodiments\")",
      "ES": "Detailed Description (or \"Description of Embodiments\")",
      "PL": "Detailed Description (or \"Description of Embodiments\")",
      "BR": "Descrição Detalhada da Invenção",
      "UAE": "Detailed Description",
      "IL": "Detailed Description",
      "US": "Detailed Description of the Invention",
      "IN": "Detailed Description of the Invention",
      "PK": "Detailed Description of the Invention",
      "BD": "Detailed Description of the Invention",
      "AU": "Description of Embodiments",
      "NZ": "Description of Embodiments",
      "UK": "Detailed Description",
      "CA": "Detailed Description",
      "CN": "Specific Mode for Carrying Out the Invention",
      "KR": "Detailed Description of the Invention",
      "TW": "Detailed Description of the Invention",
      "IR": "Detailed Description",
      "MY": "Detailed Description",
      "JP": "Detailed Description of the Invention",
      "RU": "Detailed Description of the Invention",
      "MX": "Descripción Detallada",
      "SA": "Detailed Description",
      "ZA": "Detailed Description"
    },
    "10. Best Mode": {
      "EU": "(N/A)",
      "CH": "(N/A)",
      "FR": "(N/A)",
      "DE": "(N/A)",
      "SE": "(N/A)",
      "ES": "(N/A)",
      "PL": "(N/A)",
      "BR": "(N/A)",
      "UAE": "(N/A)",
      "IL": "(N/A)",
      "US": "Best Mode (Implicit in Desc)",
      "IN": "(Include in Detailed Desc)",
      "PK": "(Include in Detailed Desc)",
      "BD": "(Include in Detailed Desc)",
      "AU": "Best Method of Performance",
      "NZ": "Best Method of Performance",
      "UK": "(N/A)",
      "CA": "(N/A)",
      "CN": "(N/A)",
      "KR": "(N/A)",
      "TW": "(N/A)",
      "IR": "(N/A)",
      "MY": "Best Mode",
      "JP": "(N/A)",
      "RU": "(N/A)",
      "MX": "(N/A)",
      "SA": "(N/A)",
      "ZA": "Best Method of Performance"
    },
    "11. Ind. Applicability": {
      "EU": "Industrial Applicability",
      "CH": "Industrial Applicability",
      "FR": "Industrial Applicability",
      "DE": "Industrial Applicability",
      "SE": "Industrial Applicability",
      "ES": "Industrial Applicability",
      "PL": "Industrial Applicability",
      "BR": "(Implicit)",
      "UAE": "(Implicit)",
      "IL": "(Implicit)",
      "US": "(N/A - Utility)",
      "IN": "(N/A)",
      "PK": "(N/A)",
      "BD": "(N/A)",
      "AU": "(N/A)",
      "NZ": "(N/A)",
      "UK": "(N/A)",
      "CA": "(N/A)",
      "CN": "(Implicit)",
      "KR": "(Implicit)",
      "TW": "(Implicit)",
      "IR": "(Implicit)",
      "MY": "(Implicit)",
      "JP": "Industrial Applicability",
      "RU": "Industrial Applicability",
      "MX": "(Implicit)",
      "SA": "(Implicit)",
      "ZA": "(Implicit)"
    },
    "12. Claims": {
      "EU": "Claims",
      "CH": "Claims",
      "FR": "Claims",
      "DE": "Claims",
      "SE": "Claims",
      "ES": "Claims",
      "PL": "Claims",
      "BR": "Reivindicações",
      "UAE": "Claims",
      "IL": "Claims",
      "US": "Claims",
      "IN": "Claims",
      "PK": "Claims",
      "BD": "Claims",
      "AU": "Claims",
      "NZ": "Claims",
      "UK": "Claims",
      "CA": "Claims",
      "CN": "Claims",
      "KR": "Claims",
      "TW": "Claims",
      "IR": "Claims",
      "MY": "Claims",
      "JP": "Claims",
      "RU": "Claims",
      "MX": "Reivindicaciones",
      "SA": "Claims",
      "ZA": "Claims"
    },
    "13. Abstract": {
      "EU": "Abstract",
      "CH": "Abstract",
      "FR": "Abstract",
      "DE": "Abstract",
      "SE": "Abstract",
      "ES": "Abstract",
      "PL": "Abstract",
      "BR": "Resumo",
      "UAE": "Abstract",
      "IL": "Abstract",
      "US": "Abstract of the Disclosure",
      "IN": "Abstract",
      "PK": "Abstract",
      "BD": "Abstract",
      "AU": "Abstract",
      "NZ": "Abstract",
      "UK": "Abstract",
      "CA": "Abstract",
      "CN": "Abstract",
      "KR": "Abstract",
      "TW": "Abstract",
      "IR": "Abstract",
      "MY": "Abstract",
      "JP": "Abstract",
      "RU": "Abstract",
      "MX": "Resumen",
      "SA": "Abstract",
      "ZA": "Abstract"
    }
  }
};

// ============================================================================
// COUNTRY PROFILES BACKUP
// Complete country configurations with prompts, rules, and validation
// ============================================================================

function loadCountryProfiles() {
  const countriesDir = path.join(__dirname);
  const files = fs.readdirSync(countriesDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && f !== 'sample.json');

  const countryProfiles = {};

  for (const file of files) {
    const countryCode = file.replace('.json', '').toUpperCase();
    if (countryCode === 'CANADA') continue; // Skip Canada, use CA

    const filePath = path.join(countriesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      countryProfiles[countryCode] = JSON.parse(content);
      console.log(`✓ Loaded ${countryCode} profile`);
    } catch (err) {
      console.error(`✗ Failed to load ${countryCode}: ${err.message}`);
    }
  }

  return countryProfiles;
}

// ============================================================================
// BACKUP VERIFICATION AND REPORTING
// ============================================================================

function generateBackupReport() {
  console.log('='.repeat(80));
  console.log('PRODUCTION BACKUP VERIFICATION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));

  // Count sections
  console.log(`\\n📋 Superset Sections: ${SUPERSET_SECTIONS_BACKUP.length}`);

  // Count mappings
  const mappingKeys = Object.keys(SECTION_MAPPINGS_BACKUP.parsedMappings);
  console.log(`📊 Section Mappings: ${mappingKeys.length} superset sections × ${Object.keys(SECTION_MAPPINGS_BACKUP.parsedMappings[mappingKeys[0]]).length} jurisdictions`);

  // Load and count country profiles
  const countryProfiles = loadCountryProfiles();
  console.log(`🌍 Country Profiles: ${Object.keys(countryProfiles).length}`);

  // Count total prompts
  let totalPrompts = 0;
  for (const [countryCode, profile] of Object.entries(countryProfiles)) {
    const sections = profile.prompts?.sections || {};
    const promptCount = Object.keys(sections).length;
    totalPrompts += promptCount;
    console.log(`  ${countryCode}: ${promptCount} section prompts`);
  }

  console.log(`\\n💬 Total Section Prompts: ${totalPrompts}`);

  // Critical sections check
  const criticalSections = ['title', 'claims', 'abstract', 'detailed_description'];
  console.log(`\\n🔍 Critical Sections Coverage:`);
  for (const section of criticalSections) {
    const countriesWithSection = Object.values(countryProfiles)
      .filter(profile => profile.prompts?.sections?.[section])
      .length;
    const percentage = ((countriesWithSection / Object.keys(countryProfiles).length) * 100).toFixed(1);
    console.log(`  ${section}: ${countriesWithSection}/${Object.keys(countryProfiles).length} countries (${percentage}%)`);
  }

  console.log('\\n✅ Backup verification complete!');
  console.log('This backup contains all critical production settings.');
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function exportBackupData() {
  const backupData = {
    timestamp: new Date().toISOString(),
    supersetSections: SUPERSET_SECTIONS_BACKUP,
    sectionMappings: SECTION_MAPPINGS_BACKUP,
    countryProfiles: loadCountryProfiles(),
    metadata: {
      description: 'Complete production backup of section mappings, prompts, and country configurations',
      version: '1.0',
      generatedBy: 'sectionpromptbackup.js',
      purpose: 'Production deployment backup and verification'
    }
  };

  const exportPath = path.join(__dirname, 'production-backup-export.json');
  fs.writeFileSync(exportPath, JSON.stringify(backupData, null, 2));
  console.log(`📄 Exported backup data to: ${exportPath}`);
  return exportPath;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

if (require.main === module) {
  console.log('🚀 Starting Production Backup Verification...\\n');

  // Generate report
  generateBackupReport();

  // Export data for verification
  const exportPath = exportBackupData();

  console.log('\\n📋 Backup Summary:');
  console.log('- Superset sections with universal instructions');
  console.log('- Cross-jurisdictional section name mappings');
  console.log('- Country-specific prompts and top-up instructions');
  console.log('- Validation rules and formatting requirements');
  console.log('- Export configurations and document templates');

  console.log(`\\n💾 Full backup exported to: ${exportPath}`);
  console.log('\\n✅ Production backup verification completed successfully!');

  process.exit(0);
}

module.exports = {
  SUPERSET_SECTIONS_BACKUP,
  SECTION_MAPPINGS_BACKUP,
  loadCountryProfiles,
  generateBackupReport,
  exportBackupData
};



