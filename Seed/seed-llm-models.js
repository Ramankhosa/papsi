#!/usr/bin/env node

/**
 * ============================================================================
 * SEED: LLM Models and Workflow Stages
 * ============================================================================
 * 
 * Seeds the database with:
 * 1. All available LLM models (Google, OpenAI, Anthropic, DeepSeek, Groq)
 * 2. All workflow stages (Patent Drafting, Novelty Search, etc.)
 * 3. Default model configurations per plan
 * 
 * Safe to run multiple times (idempotent - uses upsert).
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding LLM Models and Workflow Stages...\n');

  // ============================================================================
  // STEP 1: Seed all available LLM models
  // ============================================================================
  console.log('📦 Step 1: Seeding LLM Models Registry...\n');

  const models = [
    // === GOOGLE MODELS ===
    {
      code: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 10,     // $0.10
      outputCostPer1M: 40,    // $0.40
      isActive: true,
      isDefault: true  // System default - cost effective
    },
    {
      code: 'gemini-2.0-flash-lite',
      displayName: 'Gemini 2.0 Flash Lite',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 8,      // $0.075 (keeping legacy pricing for backward compatibility)
      outputCostPer1M: 30,    // $0.30 (keeping legacy pricing for backward compatibility)
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-2.5-flash-lite',
      displayName: 'Gemini 2.5 Flash Lite',
      provider: 'google',
      contextWindow: 1000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 10,     // $0.10
      outputCostPer1M: 40,    // $0.40
      isActive: true,
      isDefault: false
    },
    {
      code: 'gemini-1.5-pro',
      displayName: 'Gemini 1.5 Pro',
      provider: 'google',
      contextWindow: 2000000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,
      outputCostPer1M: 500,
      isActive: true,
      isDefault: false
    },
    // Google - Image Generation Models (for Sketch Generation)
    {
      code: 'gemini-3.0-nano-banana',
      displayName: 'Gemini 3.0 Nano Banana (Sketch)',
      provider: 'google',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 100,    // $1.00
      outputCostPer1M: 400,   // $4.00 (image generation)
      isActive: true,
      isDefault: false
    },

    // === OPENAI MODELS ===
    // GPT-4 Series
    {
      code: 'gpt-4o',
      displayName: 'GPT-4o',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 250,    // $2.50
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 15,     // $0.15
      outputCostPer1M: 60,    // $0.60
      isActive: true,
      isDefault: false
    },
    // GPT-5 Series
    {
      code: 'gpt-5',
      displayName: 'GPT-5',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5.1',
      displayName: 'GPT-5.1',
      provider: 'openai',
      contextWindow: 256000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 125,    // $1.25
      outputCostPer1M: 1000,  // $10.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5-mini',
      displayName: 'GPT-5 Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 300,    // $3.00
      outputCostPer1M: 1200,  // $12.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'gpt-5-nano',
      displayName: 'GPT-5 Nano',
      provider: 'openai',
      contextWindow: 64000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 200,   // $2.00
      isActive: true,
      isDefault: false
    },
    // GPT-3.5 Series
    {
      code: 'gpt-3.5-turbo',
      displayName: 'GPT-3.5 Turbo',
      provider: 'openai',
      contextWindow: 16384,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 50,     // $0.50
      outputCostPer1M: 150,   // $1.50
      isActive: true,
      isDefault: false
    },
    // o1 Reasoning Models
    {
      code: 'o1',
      displayName: 'OpenAI o1 (Reasoning)',
      provider: 'openai',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: false,
      inputCostPer1M: 1500,   // $15.00
      outputCostPer1M: 6000,  // $60.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'o1-mini',
      displayName: 'OpenAI o1 Mini',
      provider: 'openai',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: false,
      inputCostPer1M: 110,    // $1.10
      outputCostPer1M: 440,   // $4.40
      isActive: true,
      isDefault: false
    },

    // === ANTHROPIC MODELS ===
    {
      code: 'claude-3.5-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 300,    // $3.00
      outputCostPer1M: 1500,  // $15.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3.5-haiku',
      displayName: 'Claude 3.5 Haiku',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 80,     // $0.80
      outputCostPer1M: 400,   // $4.00
      isActive: true,
      isDefault: false
    },
    {
      code: 'claude-3-opus',
      displayName: 'Claude 3 Opus',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      supportsStreaming: true,
      inputCostPer1M: 1500,   // $15.00
      outputCostPer1M: 7500,  // $75.00
      isActive: true,
      isDefault: false
    },

    // === DEEPSEEK MODELS ===
    {
      code: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      provider: 'deepseek',
      contextWindow: 64000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 27,     // $0.27
      outputCostPer1M: 110,   // $1.10
      isActive: true,
      isDefault: false
    },
    {
      code: 'deepseek-reasoner',
      displayName: 'DeepSeek Reasoner (R1)',
      provider: 'deepseek',
      contextWindow: 64000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 55,     // $0.55
      outputCostPer1M: 219,   // $2.19
      isActive: true,
      isDefault: false
    },

    // === GROQ MODELS (Fast inference) ===
    {
      code: 'llama-3.3-70b',
      displayName: 'Llama 3.3 70B (Groq)',
      provider: 'groq',
      contextWindow: 128000,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 59,     // $0.59
      outputCostPer1M: 79,    // $0.79
      isActive: true,
      isDefault: false
    },
    {
      code: 'mixtral-8x7b',
      displayName: 'Mixtral 8x7B (Groq)',
      provider: 'groq',
      contextWindow: 32768,
      supportsVision: false,
      supportsStreaming: true,
      inputCostPer1M: 27,     // $0.27
      outputCostPer1M: 27,    // $0.27
      isActive: true,
      isDefault: false
    }
  ];

  // Check if LLMModel table exists
  try {
    for (const model of models) {
      await prisma.lLMModel.upsert({
        where: { code: model.code },
        update: model,
        create: model
      });
      console.log(`  ✅ ${model.displayName} (${model.provider})`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  LLMModel table does not exist yet. Skipping LLM models seeding.');
      console.log('  💡 Run migrations first: npx prisma migrate deploy');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 2: Seed workflow stages
  // ============================================================================
  console.log('\n📋 Step 2: Seeding Workflow Stages...\n');

  const stages = [
    // === PATENT DRAFTING STAGES (LLM-Powered) ===
    // Note: DRAFT_COMPONENT_PLANNER and DRAFT_EXPORT are NOT included here
    // because they don't use LLMs (manual UI and document generation respectively)
    { code: 'DRAFT_IDEA_ENTRY', displayName: 'Idea Entry & Normalization', featureCode: 'PATENT_DRAFTING', sortOrder: 1, description: 'Initial idea input and AI-based normalization' },
    { code: 'DRAFT_CLAIM_GENERATION', displayName: 'Initial Claims Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 2, description: 'Generate initial patent claims from idea' },
    { code: 'DRAFT_PRIOR_ART_ANALYSIS', displayName: 'Prior Art Analysis', featureCode: 'PATENT_DRAFTING', sortOrder: 3, description: 'Analyze prior art relevance' },
    { code: 'DRAFT_CLAIM_REFINEMENT', displayName: 'Claim Refinement', featureCode: 'PATENT_DRAFTING', sortOrder: 4, description: 'Refine claims based on prior art' },
    // DRAFT_COMPONENT_PLANNER removed - Manual UI, no LLM needed
    { code: 'DRAFT_FIGURE_PLANNER', displayName: 'Figure Planning', featureCode: 'PATENT_DRAFTING', sortOrder: 5, description: 'AI-powered figure planning and diagram suggestions' },
    { code: 'DRAFT_SKETCH_GENERATION', displayName: 'Sketch Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 6, description: 'Generate patent sketches using Gemini 3.0 nano banana' },
    { code: 'DRAFT_DIAGRAM_GENERATION', displayName: 'Diagram Generation', featureCode: 'PATENT_DRAFTING', sortOrder: 7, description: 'Generate PlantUML/technical diagrams' },
    
    // === ANNEXURE/SECTION DRAFTING STAGES ===
    // These map to superset sections for LLM model assignment
    // Order follows the superset section displayOrder from MasterSeed.js
    { code: 'DRAFT_ANNEXURE_TITLE', displayName: 'Title Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 8, description: 'Draft patent title (superset: title)' },
    { code: 'DRAFT_ANNEXURE_PREAMBLE', displayName: 'Preamble Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 9, description: 'Draft legal preamble (superset: preamble)' },
    { code: 'DRAFT_ANNEXURE_FIELD', displayName: 'Field of Invention', featureCode: 'PATENT_DRAFTING', sortOrder: 10, description: 'Draft field of invention section (superset: fieldOfInvention)' },
    { code: 'DRAFT_ANNEXURE_BACKGROUND', displayName: 'Background Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 11, description: 'Draft background section (superset: background)' },
    { code: 'DRAFT_ANNEXURE_OBJECTS', displayName: 'Objects of Invention', featureCode: 'PATENT_DRAFTING', sortOrder: 12, description: 'Draft objects of invention (superset: objectsOfInvention)' },
    { code: 'DRAFT_ANNEXURE_SUMMARY', displayName: 'Summary Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 13, description: 'Draft invention summary (superset: summary)' },
    { code: 'DRAFT_ANNEXURE_TECHNICAL_PROBLEM', displayName: 'Technical Problem', featureCode: 'PATENT_DRAFTING', sortOrder: 14, description: 'Draft technical problem statement (superset: technicalProblem)' },
    { code: 'DRAFT_ANNEXURE_TECHNICAL_SOLUTION', displayName: 'Technical Solution', featureCode: 'PATENT_DRAFTING', sortOrder: 15, description: 'Draft technical solution (superset: technicalSolution)' },
    { code: 'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS', displayName: 'Advantageous Effects', featureCode: 'PATENT_DRAFTING', sortOrder: 16, description: 'Draft advantageous effects (superset: advantageousEffects)' },
    { code: 'DRAFT_ANNEXURE_DRAWINGS', displayName: 'Brief Description of Drawings', featureCode: 'PATENT_DRAFTING', sortOrder: 17, description: 'Draft brief description of drawings (superset: briefDescriptionOfDrawings)' },
    { code: 'DRAFT_ANNEXURE_DESCRIPTION', displayName: 'Detailed Description', featureCode: 'PATENT_DRAFTING', sortOrder: 18, description: 'Draft detailed description (superset: detailedDescription)' },
    { code: 'DRAFT_ANNEXURE_BEST_MODE', displayName: 'Best Mode', featureCode: 'PATENT_DRAFTING', sortOrder: 19, description: 'Draft best mode description (superset: bestMode)' },
    { code: 'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY', displayName: 'Industrial Applicability', featureCode: 'PATENT_DRAFTING', sortOrder: 20, description: 'Draft industrial applicability (superset: industrialApplicability)' },
    { code: 'DRAFT_ANNEXURE_CLAIMS', displayName: 'Claims Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 21, description: 'Draft final patent claims (superset: claims)' },
    { code: 'DRAFT_ANNEXURE_ABSTRACT', displayName: 'Abstract Drafting', featureCode: 'PATENT_DRAFTING', sortOrder: 22, description: 'Draft patent abstract (superset: abstract)' },
    { code: 'DRAFT_ANNEXURE_NUMERALS', displayName: 'List of Reference Numerals', featureCode: 'PATENT_DRAFTING', sortOrder: 23, description: 'Draft list of reference numerals (superset: listOfNumerals)' },
    { code: 'DRAFT_ANNEXURE_CROSS_REFERENCE', displayName: 'Cross-Reference to Related Applications', featureCode: 'PATENT_DRAFTING', sortOrder: 24, description: 'Draft cross-reference section (superset: crossReference)' },
    
    { code: 'DRAFT_REVIEW', displayName: 'AI Review & Fix', featureCode: 'PATENT_DRAFTING', sortOrder: 25, description: 'AI-powered patent review' },
    // DRAFT_EXPORT removed - Document generation, no LLM needed
    
    // === NOVELTY SEARCH STAGES ===
    { code: 'NOVELTY_QUERY_GENERATION', displayName: 'Query Generation', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 1, description: 'Generate search queries from idea' },
    { code: 'NOVELTY_PATENT_SEARCH', displayName: 'Patent Search', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 2, description: 'Search patent databases' },
    { code: 'NOVELTY_RELEVANCE_SCORING', displayName: 'Relevance Scoring', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 3, description: 'Score patent relevance' },
    { code: 'NOVELTY_FEATURE_ANALYSIS', displayName: 'Feature Analysis', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 4, description: 'Analyze feature overlap' },
    { code: 'NOVELTY_COMPARISON', displayName: 'Detailed Comparison', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 5, description: 'Compare with prior art' },
    { code: 'NOVELTY_REPORT_GENERATION', displayName: 'Report Generation', featureCode: 'PRIOR_ART_SEARCH', sortOrder: 6, description: 'Generate novelty report' },
    
    // === IDEA BANK STAGES ===
    { code: 'IDEA_BANK_NORMALIZE', displayName: 'Idea Normalization', featureCode: 'IDEA_BANK', sortOrder: 1, description: 'Normalize and structure idea' },
    { code: 'IDEA_BANK_SEARCH', displayName: 'Similar Ideas Search', featureCode: 'IDEA_BANK', sortOrder: 2, description: 'Search for similar ideas' },
    
    // === DIAGRAM GENERATION STAGES ===
    { code: 'DIAGRAM_PLANTUML', displayName: 'PlantUML Generation', featureCode: 'DIAGRAM_GENERATION', sortOrder: 1, description: 'Generate PlantUML code' },
    { code: 'DIAGRAM_FLOWCHART', displayName: 'Flowchart Generation', featureCode: 'DIAGRAM_GENERATION', sortOrder: 2, description: 'Generate flowcharts' },
    { code: 'DIAGRAM_SEQUENCE', displayName: 'Sequence Diagram', featureCode: 'DIAGRAM_GENERATION', sortOrder: 3, description: 'Generate sequence diagrams' },
    { code: 'DIAGRAM_BLOCK', displayName: 'Block Diagram', featureCode: 'DIAGRAM_GENERATION', sortOrder: 4, description: 'Generate block diagrams' }
  ];

  try {
    for (const stage of stages) {
      await prisma.workflowStage.upsert({
        where: { code: stage.code },
        update: stage,
        create: stage
      });
      console.log(`  ✅ ${stage.displayName} (${stage.featureCode})`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  WorkflowStage table does not exist yet. Skipping stages seeding.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  // ============================================================================
  // STEP 3: Seed default model configurations for each plan
  // ============================================================================
  console.log('\n⚙️ Step 3: Seeding Default Plan Model Configurations...\n');

  // Get all plans
  const plans = await prisma.plan.findMany();
  
  if (plans.length === 0) {
    console.log('  ⚠️  No plans found. Run seed-production-plans.js first.');
    await prisma.$disconnect();
    return;
  }

  // Get model IDs
  const modelsByCode = {};
  const allModels = await prisma.lLMModel.findMany();
  allModels.forEach(m => { modelsByCode[m.code] = m.id; });

  // Get stage IDs
  const stagesByCode = {};
  const allStages = await prisma.workflowStage.findMany();
  allStages.forEach(s => { stagesByCode[s.code] = s.id; });

  // Define default configurations per plan type
  // Note: DRAFT_COMPONENT_PLANNER and DRAFT_EXPORT are excluded because they don't use LLMs
  // Stage codes map to superset sections - model assigned here determines which LLM generates that section
  const planConfigs = {
    // FREE_PLAN - Cost-effective models
    'FREE_PLAN': {
      'DRAFT_IDEA_ENTRY': 'gemini-2.0-flash-lite',
      'DRAFT_CLAIM_GENERATION': 'gemini-2.0-flash-lite',
      'DRAFT_PRIOR_ART_ANALYSIS': 'gemini-2.0-flash-lite',
      'DRAFT_CLAIM_REFINEMENT': 'gemini-2.0-flash-lite',
      'DRAFT_FIGURE_PLANNER': 'gemini-2.0-flash-lite',
      'DRAFT_SKETCH_GENERATION': 'gemini-3.0-nano-banana',
      'DRAFT_DIAGRAM_GENERATION': 'gpt-4o-mini',
      // Annexure/Section stages (maps to superset sections)
      'DRAFT_ANNEXURE_TITLE': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_PREAMBLE': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_FIELD': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_BACKGROUND': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_OBJECTS': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_SUMMARY': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_DRAWINGS': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_DESCRIPTION': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_BEST_MODE': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_CLAIMS': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_ABSTRACT': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_NUMERALS': 'gemini-2.0-flash-lite',
      'DRAFT_ANNEXURE_CROSS_REFERENCE': 'gemini-2.0-flash-lite',
      'DRAFT_REVIEW': 'gemini-2.0-flash',
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION': 'gemini-2.0-flash-lite',
      'NOVELTY_RELEVANCE_SCORING': 'gemini-2.0-flash-lite',
      'NOVELTY_REPORT_GENERATION': 'gemini-2.0-flash-lite',
      // Idea bank stages
      'IDEA_BANK_NORMALIZE': 'gemini-2.0-flash-lite',
      'IDEA_BANK_SEARCH': 'gemini-2.0-flash-lite',
      // Diagram stages
      'DIAGRAM_PLANTUML': 'gpt-4o-mini',
    },
    // PRO_PLAN - Balanced quality/cost
    'PRO_PLAN': {
      'DRAFT_IDEA_ENTRY': 'gemini-2.0-flash',
      'DRAFT_CLAIM_GENERATION': 'gpt-4o-mini',
      'DRAFT_PRIOR_ART_ANALYSIS': 'gemini-2.5-pro',
      'DRAFT_CLAIM_REFINEMENT': 'gpt-4o-mini',
      'DRAFT_FIGURE_PLANNER': 'gemini-2.5-pro',
      'DRAFT_SKETCH_GENERATION': 'gemini-3.0-nano-banana',
      'DRAFT_DIAGRAM_GENERATION': 'gpt-4o',
      // Annexure/Section stages (maps to superset sections)
      'DRAFT_ANNEXURE_TITLE': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_PREAMBLE': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_FIELD': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_BACKGROUND': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_OBJECTS': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_SUMMARY': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_DRAWINGS': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_DESCRIPTION': 'gpt-4o',
      'DRAFT_ANNEXURE_BEST_MODE': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_CLAIMS': 'gpt-4o',
      'DRAFT_ANNEXURE_ABSTRACT': 'gpt-4o-mini',
      'DRAFT_ANNEXURE_NUMERALS': 'gemini-2.0-flash',
      'DRAFT_ANNEXURE_CROSS_REFERENCE': 'gemini-2.0-flash',
      'DRAFT_REVIEW': 'gpt-4o',
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION': 'gpt-4o-mini',
      'NOVELTY_RELEVANCE_SCORING': 'gemini-2.0-flash-lite',
      'NOVELTY_FEATURE_ANALYSIS': 'gemini-2.5-pro',
      'NOVELTY_REPORT_GENERATION': 'gpt-4o',
      // Idea bank stages
      'IDEA_BANK_NORMALIZE': 'gpt-4o-mini',
      'IDEA_BANK_SEARCH': 'gemini-2.0-flash',
      // Diagram stages
      'DIAGRAM_PLANTUML': 'gpt-4o',
      'DIAGRAM_FLOWCHART': 'gpt-4o',
    },
    // ENTERPRISE_PLAN - Premium models (includes GPT-5 options)
    'ENTERPRISE_PLAN': {
      'DRAFT_IDEA_ENTRY': 'gpt-5-mini',
      'DRAFT_CLAIM_GENERATION': 'gpt-5',
      'DRAFT_PRIOR_ART_ANALYSIS': 'gemini-2.5-pro',
      'DRAFT_CLAIM_REFINEMENT': 'gpt-5',
      'DRAFT_FIGURE_PLANNER': 'gemini-2.5-pro',
      'DRAFT_SKETCH_GENERATION': 'gemini-3.0-nano-banana',
      'DRAFT_DIAGRAM_GENERATION': 'gpt-4o',
      // Annexure/Section stages (maps to superset sections)
      'DRAFT_ANNEXURE_TITLE': 'gpt-5-mini',
      'DRAFT_ANNEXURE_PREAMBLE': 'gpt-5-mini',
      'DRAFT_ANNEXURE_FIELD': 'gpt-5-mini',
      'DRAFT_ANNEXURE_BACKGROUND': 'gpt-5-mini',
      'DRAFT_ANNEXURE_OBJECTS': 'gpt-5-mini',
      'DRAFT_ANNEXURE_SUMMARY': 'gpt-5',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM': 'gpt-5',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION': 'gpt-5',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS': 'gpt-5-mini',
      'DRAFT_ANNEXURE_DRAWINGS': 'gpt-5-mini',
      'DRAFT_ANNEXURE_DESCRIPTION': 'gpt-5',
      'DRAFT_ANNEXURE_BEST_MODE': 'gpt-5-mini',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': 'gpt-5-mini',
      'DRAFT_ANNEXURE_CLAIMS': 'gpt-5',
      'DRAFT_ANNEXURE_ABSTRACT': 'gpt-5-mini',
      'DRAFT_ANNEXURE_NUMERALS': 'gpt-5-nano',
      'DRAFT_ANNEXURE_CROSS_REFERENCE': 'gpt-5-nano',
      'DRAFT_REVIEW': 'gpt-5.1',
      // Novelty search stages
      'NOVELTY_QUERY_GENERATION': 'gpt-5-mini',
      'NOVELTY_RELEVANCE_SCORING': 'gpt-5-nano',
      'NOVELTY_FEATURE_ANALYSIS': 'gpt-5',
      'NOVELTY_COMPARISON': 'gpt-5',
      'NOVELTY_REPORT_GENERATION': 'gpt-5',
      // Idea bank stages
      'IDEA_BANK_NORMALIZE': 'gpt-5-mini',
      'IDEA_BANK_SEARCH': 'gpt-5-nano',
      // Diagram stages
      'DIAGRAM_PLANTUML': 'gpt-4o',
      'DIAGRAM_FLOWCHART': 'gpt-4o',
      'DIAGRAM_SEQUENCE': 'gpt-4o',
      'DIAGRAM_BLOCK': 'gpt-4o',
    }
  };

  try {
    for (const plan of plans) {
      const config = planConfigs[plan.code];
      if (!config) {
        console.log(`  ⏭️ Skipping ${plan.code} (no default config defined)`);
        continue;
      }

      console.log(`  📝 Configuring ${plan.code}...`);
      
      for (const [stageCode, modelCode] of Object.entries(config)) {
        const stageId = stagesByCode[stageCode];
        const modelId = modelsByCode[modelCode];
        
        if (!stageId || !modelId) {
          // Skip silently - not all stages need to be configured
          continue;
        }

        await prisma.planStageModelConfig.upsert({
          where: {
            planId_stageId: {
              planId: plan.id,
              stageId: stageId
            }
          },
          update: {
            modelId: modelId,
            isActive: true
          },
          create: {
            planId: plan.id,
            stageId: stageId,
            modelId: modelId,
            isActive: true
          }
        });
      }
      console.log(`  ✅ ${plan.code} configured`);
    }
  } catch (error) {
    if (error.code === 'P2021' || error.message.includes('does not exist')) {
      console.log('  ⚠️  PlanStageModelConfig table does not exist yet.');
      await prisma.$disconnect();
      return;
    }
    throw error;
  }

  console.log('\n✨ LLM Models & Workflow Stages seeding complete!');
  console.log(`   - ${models.length} LLM models`);
  console.log(`   - ${stages.length} workflow stages`);
  console.log(`   - ${plans.length} plans configured`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

