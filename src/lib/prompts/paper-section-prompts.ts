import type { SectionTemplate } from '@/lib/services/section-template-service';

const BASE_SYSTEM = `SYSTEM ROLE: You are a senior academic writing assistant.
STYLE: formal, objective, precise, and concise. Avoid marketing language.
OUTPUT: return only the section body without headings or labels.`;

const COMMON_CONTEXT = `CONTEXT (use if available):
Title: {{TITLE}}
Research question: {{RESEARCH_QUESTION}}
Hypothesis: {{HYPOTHESIS}}
Methodology: {{METHODOLOGY}}
Contribution type: {{CONTRIBUTION_TYPE}}
Keywords: {{KEYWORDS}}
Dataset description: {{DATASET_DESCRIPTION}}
Abstract draft: {{ABSTRACT_DRAFT}}
Previous sections: {{PREVIOUS_SECTIONS}}`;

const CONSTRAINT_REMINDER = 'Follow the constraints block provided in this prompt.';

function buildPrompt(
  sectionName: string,
  instructions: string,
  citationNote: string,
  extraGuidance?: string
): string {
  const guidanceBlock = extraGuidance ? `\n\nADDITIONAL GUIDANCE:\n${extraGuidance}` : '';
  return `${BASE_SYSTEM}\n\nSECTION: ${sectionName}\n\nTASK:\n${instructions}\n\nCITATIONS:\n${citationNote}\n\n${CONSTRAINT_REMINDER}\n\n${COMMON_CONTEXT}${guidanceBlock}`;
}

const abstractBase = buildPrompt(
  'Abstract',
  [
    'Summarize the background, problem, method, key findings, and implications.',
    'Write one cohesive paragraph using academic language.',
    'Emphasize the contribution and why it matters.'
  ].join('\n'),
  'Do not include citations.'
);

const abstractThesis = buildPrompt(
  'Abstract',
  [
    'Summarize the dissertation scope, research question, method, and main findings.',
    'Mention the primary contribution and significance.',
    'Keep the language accessible to a broad academic audience.'
  ].join('\n'),
  'Do not include citations.'
);

const introductionBase = buildPrompt(
  'Introduction',
  [
    'Establish the broader context and importance of the topic.',
    'Identify the specific gap or problem in the literature.',
    'State the research question and objectives clearly.',
    'Preview your approach and expected contributions.',
    'End with a brief roadmap of the paper structure.'
  ].join('\n'),
  'Use citations for background and prior work. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const introductionConference = buildPrompt(
  'Introduction',
  [
    'Keep the introduction concise (2-4 short paragraphs).',
    'Highlight novelty and contributions early.',
    'State the research question succinctly and motivate the approach.',
    'Provide a brief structure overview in the final paragraph.'
  ].join('\n'),
  'Use citations for background and related work. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const introductionThesis = buildPrompt(
  'Introduction',
  [
    'Provide a detailed background and motivation for the research problem.',
    'Define the research objectives and scope.',
    'State the research question and, if applicable, hypotheses.',
    'Summarize contributions and outline the thesis structure.'
  ].join('\n'),
  'Use citations for background and foundational work. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const introductionReview = buildPrompt(
  'Introduction',
  [
    'Frame the scope of the review and justify its importance.',
    'Describe the review objectives and coverage boundaries.',
    'Explain the organizational structure or taxonomy used in the review.'
  ].join('\n'),
  'Use citations to justify the need for the review. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const introductionBookChapter = buildPrompt(
  'Introduction',
  [
    'Introduce the chapter topic and position it within the book theme.',
    'Clarify the chapter scope and intended audience.',
    'Preview the chapter structure and key takeaways.'
  ].join('\n'),
  'Use citations where needed. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const introductionShortComm = buildPrompt(
  'Introduction',
  [
    'Keep the introduction very concise and focused.',
    'State the key problem and why it matters.',
    'Lead directly into the main finding or contribution.'
  ].join('\n'),
  'Use citations sparingly where necessary. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const literatureReviewBase = buildPrompt(
  'Literature Review',
  [
    'Synthesize the literature thematically or methodologically.',
    'Compare key studies, highlight patterns and contradictions.',
    'Identify gaps that motivate the current research.',
    'Establish the theoretical or conceptual foundation.'
  ].join('\n'),
  'Cite extensively using [CITE:key]. Do not invent citations.'
);

const literatureReviewReview = buildPrompt(
  'Literature Review',
  [
    'Provide a comprehensive synthesis of the literature.',
    'Organize the review into clear themes or taxonomies.',
    'Highlight emerging trends, unresolved debates, and research gaps.',
    'Maintain critical analysis rather than summary-only descriptions.'
  ].join('\n'),
  'Cite extensively using [CITE:key]. Do not invent citations.'
);

const relatedWorkConference = buildPrompt(
  'Related Work',
  [
    'Focus on the most relevant and recent studies.',
    'Compare approaches and clarify how your work differs.',
    'Identify the specific gap your contribution addresses.',
    'Keep the section concise and focused.'
  ].join('\n'),
  'Use citations for every major comparison. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const methodologyBase = buildPrompt(
  'Methodology',
  [
    'Describe the research design, data collection, and analysis methods.',
    'Include sample characteristics, instruments, and procedures.',
    'Justify methodological choices and address limitations.',
    'Explain ethics or compliance considerations if applicable.'
  ].join('\n'),
  'Cite established methods, instruments, or datasets using [CITE:key]. Do not invent citations.'
);

const methodologyReview = buildPrompt(
  'Methodology',
  [
    'Describe the review protocol, databases searched, and query strategy.',
    'Explain inclusion and exclusion criteria.',
    'Describe screening, coding, and synthesis methods.',
    'Note limitations and potential biases in the review process.'
  ].join('\n'),
  'Cite protocols or prior review methodologies using [CITE:key]. Do not invent citations.'
);

const methodologyConference = buildPrompt(
  'Methodology',
  [
    'Keep the methodology concise but reproducible.',
    'Focus on experimental setup, datasets, and evaluation metrics.',
    'Clarify baselines and comparison methods.'
  ].join('\n'),
  'Cite datasets or baseline methods using [CITE:key]. Do not invent citations.'
);

const methodologyCaseStudy = buildPrompt(
  'Methodology',
  [
    'Explain the case selection criteria and context.',
    'Describe data sources, instruments, and analysis approach.',
    'Discuss validity considerations and limitations.'
  ].join('\n'),
  'Cite relevant methodological sources using [CITE:key]. Do not invent citations.'
);

const resultsBase = buildPrompt(
  'Results',
  [
    'Present findings objectively with clear organization.',
    'Refer to figures or tables when applicable.',
    'Report statistics or qualitative findings without interpretation.'
  ].join('\n'),
  'Use citations only for baseline comparisons or datasets when necessary. Use [CITE:key] only from the provided list.'
);

const resultsShortComm = buildPrompt(
  'Results',
  [
    'Present the main finding(s) succinctly.',
    'Prioritize clarity and brevity.',
    'Avoid extended interpretation.'
  ].join('\n'),
  'Use citations only if essential. Use [CITE:key] only from the provided list.'
);

const discussionBase = buildPrompt(
  'Discussion',
  [
    'Interpret the findings in relation to the research question.',
    'Compare results with prior literature.',
    'Discuss implications, limitations, and future work.',
    'Highlight the contribution and broader significance.'
  ].join('\n'),
  'Use citations for comparisons and implications. Use [CITE:key] only from the provided list. Do not invent citations.'
);

const conclusionBase = buildPrompt(
  'Conclusion',
  [
    'Summarize the core findings and contributions.',
    'Emphasize implications and key takeaways.',
    'Avoid introducing new information.'
  ].join('\n'),
  'Citations are optional. If used, rely on [CITE:key] only from the provided list.'
);

const acknowledgmentsBase = buildPrompt(
  'Acknowledgments',
  [
    'Acknowledge funding sources, collaborators, and supporting institutions.',
    'Keep the tone professional and concise.'
  ].join('\n'),
  'Do not include citations.'
);

const futureDirectionsBase = buildPrompt(
  'Future Directions',
  [
    'Identify promising research directions based on the reviewed literature.',
    'Explain why these directions are important and feasible.',
    'Tie recommendations to the gaps identified in the review.'
  ].join('\n'),
  'Use citations where appropriate. Use [CITE:key] only from the provided list.'
);

const futureWorkBase = buildPrompt(
  'Future Work',
  [
    'Describe concrete extensions and next research steps.',
    'Connect future work to the current study limitations.',
    'Prioritize the most impactful and feasible directions.'
  ].join('\n'),
  'Use citations where relevant. Use [CITE:key] only from the provided list.'
);

const mainContentBase = buildPrompt(
  'Main Content',
  [
    'Develop the chapter argument or narrative in a structured way.',
    'Use subtopics to organize key points and evidence.',
    'Balance conceptual framing with concrete examples.'
  ].join('\n'),
  'Use citations to support claims. Use [CITE:key] only from the provided list.'
);

const caseStudiesBase = buildPrompt(
  'Case Studies',
  [
    'Describe each case study clearly and consistently.',
    'Explain why the case is relevant to the chapter theme.',
    'Highlight key observations and outcomes.'
  ].join('\n'),
  'Use citations for sources or prior analyses. Use [CITE:key] only from the provided list.'
);

const caseDescriptionBase = buildPrompt(
  'Case Description',
  [
    'Describe the case context, setting, and actors.',
    'Provide necessary background details for understanding the case.',
    'Keep the narrative factual and organized.'
  ].join('\n'),
  'Use citations if describing prior work or sources. Use [CITE:key] only from the provided list.'
);

const analysisBase = buildPrompt(
  'Analysis',
  [
    'Analyze the case using appropriate theoretical or methodological lenses.',
    'Connect observations to the research question and literature.',
    'Highlight patterns, contradictions, and insights.'
  ].join('\n'),
  'Use citations for theoretical framing or comparisons. Use [CITE:key] only from the provided list.'
);

const recommendationsBase = buildPrompt(
  'Recommendations',
  [
    'Provide actionable recommendations grounded in the analysis.',
    'Explain who should act and why the recommendation follows from findings.',
    'Prioritize high-impact, feasible actions.'
  ].join('\n'),
  'Use citations where relevant. Use [CITE:key] only from the provided list.'
);

const mainFindingsBase = buildPrompt(
  'Main Findings',
  [
    'Summarize the primary result(s) in a compact form.',
    'Focus on what was discovered rather than full interpretation.',
    'Use short paragraphs or concise statements.'
  ].join('\n'),
  'Use citations only if needed to compare with prior work. Use [CITE:key] only from the provided list.'
);

const appendixBase = buildPrompt(
  'Appendix',
  [
    'List supplementary materials such as instruments, detailed tables, or protocols.',
    'Use clear labels and concise descriptions.',
    'Do not introduce new arguments.'
  ].join('\n'),
  'Do not invent citations. Use [CITE:key] only if referencing a source.'
);

const publicationsBase = buildPrompt(
  'Publications',
  [
    'List publications related to this thesis or project if provided.',
    'If no publication data is provided, state "No publications reported."'
  ].join('\n'),
  'Do not invent citations.'
);

const referencesBase = buildPrompt(
  'References',
  [
    'List references only from the provided citation keys.',
    'Do not invent or fabricate sources.',
    'If no citations are available, return "No references available."'
  ].join('\n'),
  'Use only [CITE:key] entries that appear in the citation list.'
);

export const paperSectionTemplates: SectionTemplate[] = [
  {
    sectionKey: 'abstract',
    displayName: 'Abstract',
    description: 'Concise summary of the entire paper',
    defaultPrompt: abstractBase,
    promptsByPaperType: {
      THESIS_MASTERS: abstractThesis,
      THESIS_PHD: abstractThesis
    },
    constraints: {
      wordLimit: 250,
      citationRequirements: { minimum: 0, recommended: 0 },
      tenseRequirements: ['present', 'past'],
      styleRequirements: ['concise', 'formal']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 1,
    isRequired: true
  },
  {
    sectionKey: 'introduction',
    displayName: 'Introduction',
    description: 'Context, problem statement, and research objectives',
    defaultPrompt: introductionBase,
    promptsByPaperType: {
      CONFERENCE_PAPER: introductionConference,
      THESIS_MASTERS: introductionThesis,
      THESIS_PHD: introductionThesis,
      REVIEW_ARTICLE: introductionReview,
      BOOK_CHAPTER: introductionBookChapter,
      SHORT_COMMUNICATION: introductionShortComm,
      CASE_STUDY: introductionBase
    },
    constraints: {
      wordLimit: 1000,
      citationRequirements: { minimum: 5, recommended: 10 },
      tenseRequirements: ['present'],
      styleRequirements: ['formal', 'engaging']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 2,
    isRequired: true
  },
  {
    sectionKey: 'literature_review',
    displayName: 'Literature Review',
    description: 'Synthesis of existing research and identification of gaps',
    defaultPrompt: literatureReviewBase,
    promptsByPaperType: {
      REVIEW_ARTICLE: literatureReviewReview,
      THESIS_MASTERS: literatureReviewBase,
      THESIS_PHD: literatureReviewBase
    },
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 12, recommended: 25 },
      tenseRequirements: ['present'],
      styleRequirements: ['critical', 'synthetic']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 3,
    isRequired: false
  },
  {
    sectionKey: 'related_work',
    displayName: 'Related Work',
    description: 'Review of related research (conference format)',
    defaultPrompt: relatedWorkConference,
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 6, recommended: 12 },
      tenseRequirements: ['present'],
      styleRequirements: ['focused', 'comparative']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 3,
    isRequired: false
  },
  {
    sectionKey: 'methodology',
    displayName: 'Methodology',
    description: 'Research design, data collection, and analysis methods',
    defaultPrompt: methodologyBase,
    promptsByPaperType: {
      REVIEW_ARTICLE: methodologyReview,
      CONFERENCE_PAPER: methodologyConference,
      CASE_STUDY: methodologyCaseStudy,
      THESIS_MASTERS: methodologyBase,
      THESIS_PHD: methodologyBase
    },
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 5, recommended: 10 },
      tenseRequirements: ['past'],
      styleRequirements: ['precise', 'detailed']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 4,
    isRequired: true
  },
  {
    sectionKey: 'results',
    displayName: 'Results',
    description: 'Presentation of research findings',
    defaultPrompt: resultsBase,
    promptsByPaperType: {
      SHORT_COMMUNICATION: resultsShortComm
    },
    constraints: {
      wordLimit: 1200,
      citationRequirements: { minimum: 0, recommended: 2 },
      tenseRequirements: ['past'],
      styleRequirements: ['objective', 'clear']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 5,
    isRequired: true
  },
  {
    sectionKey: 'discussion',
    displayName: 'Discussion',
    description: 'Interpretation of results and implications',
    defaultPrompt: discussionBase,
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 6, recommended: 15 },
      tenseRequirements: ['present'],
      styleRequirements: ['analytical', 'balanced']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 6,
    isRequired: true
  },
  {
    sectionKey: 'conclusion',
    displayName: 'Conclusion',
    description: 'Summary of contributions and final thoughts',
    defaultPrompt: conclusionBase,
    constraints: {
      wordLimit: 600,
      citationRequirements: { minimum: 0, recommended: 3 },
      tenseRequirements: ['present'],
      styleRequirements: ['concise', 'impactful']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 7,
    isRequired: true
  },
  {
    sectionKey: 'acknowledgments',
    displayName: 'Acknowledgments',
    description: 'Recognition of contributions and funding',
    defaultPrompt: acknowledgmentsBase,
    constraints: {
      wordLimit: 150,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['grateful', 'professional']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 8,
    isRequired: false
  },
  {
    sectionKey: 'future_directions',
    displayName: 'Future Directions',
    description: 'Future research directions for review articles',
    defaultPrompt: futureDirectionsBase,
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 3, recommended: 8 },
      tenseRequirements: ['future'],
      styleRequirements: ['forward-looking', 'grounded']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 8,
    isRequired: false
  },
  {
    sectionKey: 'future_work',
    displayName: 'Future Work',
    description: 'Future work section for theses',
    defaultPrompt: futureWorkBase,
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 2, recommended: 6 },
      tenseRequirements: ['future'],
      styleRequirements: ['forward-looking', 'grounded']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 9,
    isRequired: false
  },
  {
    sectionKey: 'main_content',
    displayName: 'Main Content',
    description: 'Primary narrative content for book chapters',
    defaultPrompt: mainContentBase,
    constraints: {
      wordLimit: 4000,
      citationRequirements: { minimum: 8, recommended: 15 },
      tenseRequirements: ['present', 'past'],
      styleRequirements: ['structured', 'evidence-based']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 4,
    isRequired: false
  },
  {
    sectionKey: 'case_studies',
    displayName: 'Case Studies',
    description: 'Case studies for book chapters',
    defaultPrompt: caseStudiesBase,
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 3, recommended: 8 },
      tenseRequirements: ['past', 'present'],
      styleRequirements: ['descriptive', 'analytical']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 5,
    isRequired: false
  },
  {
    sectionKey: 'case_description',
    displayName: 'Case Description',
    description: 'Context and narrative for case study papers',
    defaultPrompt: caseDescriptionBase,
    constraints: {
      wordLimit: 1500,
      citationRequirements: { minimum: 2, recommended: 5 },
      tenseRequirements: ['past', 'present'],
      styleRequirements: ['clear', 'structured']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 4,
    isRequired: false
  },
  {
    sectionKey: 'analysis',
    displayName: 'Analysis',
    description: 'Analytical section for case study papers',
    defaultPrompt: analysisBase,
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 4, recommended: 10 },
      tenseRequirements: ['present'],
      styleRequirements: ['analytical', 'evidence-based']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 5,
    isRequired: false
  },
  {
    sectionKey: 'recommendations',
    displayName: 'Recommendations',
    description: 'Recommendations for case study papers',
    defaultPrompt: recommendationsBase,
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 1, recommended: 4 },
      tenseRequirements: ['present', 'future'],
      styleRequirements: ['actionable', 'grounded']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 6,
    isRequired: false
  },
  {
    sectionKey: 'main_findings',
    displayName: 'Main Findings',
    description: 'Brief findings for short communications',
    defaultPrompt: mainFindingsBase,
    constraints: {
      wordLimit: 800,
      citationRequirements: { minimum: 0, recommended: 2 },
      tenseRequirements: ['past'],
      styleRequirements: ['concise', 'clear']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 5,
    isRequired: false
  },
  {
    sectionKey: 'appendix',
    displayName: 'Appendix',
    description: 'Supplementary material',
    defaultPrompt: appendixBase,
    constraints: {
      wordLimit: 2000,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['concise']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 10,
    isRequired: false
  },
  {
    sectionKey: 'publications',
    displayName: 'Publications',
    description: 'List of related publications',
    defaultPrompt: publicationsBase,
    constraints: {
      wordLimit: 300,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['concise']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 11,
    isRequired: false
  },
  {
    sectionKey: 'references',
    displayName: 'References',
    description: 'Bibliography section',
    defaultPrompt: referencesBase,
    constraints: {
      wordLimit: 3000,
      citationRequirements: { minimum: 0, recommended: 0 },
      styleRequirements: ['formal']
    },
    applicablePaperTypes: ['*'],
    orderWeight: 99,
    isRequired: false
  }
];
