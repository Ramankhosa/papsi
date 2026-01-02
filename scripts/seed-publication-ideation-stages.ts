/**
 * Seed script for Publication Ideation (Paper Writing) workflow stages
 * 
 * This creates the workflow stages that Super Admin can configure
 * to control which LLM model is used for each paper writing operation.
 * 
 * Run with: npx tsx scripts/seed-publication-ideation-stages.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Seeding Publication Ideation workflow stages...')

  // ============================================================================
  // 1. Use existing PAPER_DRAFTING feature (defined in FeatureCode enum)
  // ============================================================================
  
  const featureCode = 'PAPER_DRAFTING' // Using existing enum value
  console.log(`✅ Using Feature: ${featureCode}`)

  // ============================================================================
  // 2. Define Publication Ideation workflow stages
  // ============================================================================
  
  const publicationStages = [
    // Research Topic Stage Operations
    {
      code: 'PAPER_TOPIC_EXTRACT_FROM_FILE',
      displayName: 'Paper Idea Normalization',
      featureCode,
      description: 'Extract and normalize research topic details from uploaded document (Word, PDF, or text)',
      sortOrder: 0,
    },
    {
      code: 'PAPER_TOPIC_REFINE_QUESTION',
      displayName: 'Refine Research Question',
      featureCode,
      description: 'AI refines and improves the research question based on topic context',
      sortOrder: 1,
    },
    {
      code: 'PAPER_TOPIC_SUGGEST_KEYWORDS',
      displayName: 'Suggest Keywords',
      featureCode,
      description: 'AI suggests relevant academic keywords based on research topic',
      sortOrder: 2,
    },
    {
      code: 'PAPER_TOPIC_GENERATE_HYPOTHESIS',
      displayName: 'Generate Hypothesis',
      featureCode,
      description: 'AI generates testable hypotheses based on research question and methodology',
      sortOrder: 3,
    },
    {
      code: 'PAPER_TOPIC_DRAFT_ABSTRACT',
      displayName: 'Draft Abstract',
      featureCode,
      description: 'AI drafts an academic abstract based on research topic details',
      sortOrder: 4,
    },
    {
      code: 'PAPER_TOPIC_FORMULATE_QUESTION',
      displayName: 'Help Formulate Question',
      featureCode,
      description: 'AI helps beginners formulate their research question with guiding prompts',
      sortOrder: 5,
    },
    {
      code: 'PAPER_TOPIC_ENHANCE_ALL',
      displayName: 'Enhance All Topic Details',
      featureCode,
      description: 'AI enhances and suggests improvements across all topic fields',
      sortOrder: 6,
    },
    // Literature Review Stage Operations
    {
      code: 'PAPER_LITERATURE_SEARCH',
      displayName: 'Literature Search',
      featureCode,
      description: 'AI assists with finding relevant academic literature',
      sortOrder: 10,
    },
    {
      code: 'PAPER_LITERATURE_SUMMARIZE',
      displayName: 'Summarize Literature',
      featureCode,
      description: 'AI summarizes academic papers and extracts key points',
      sortOrder: 11,
    },
    {
      code: 'PAPER_LITERATURE_GAP',
      displayName: 'Analyze Literature Gaps',
      featureCode,
      description: 'AI identifies research gaps from literature review',
      sortOrder: 12,
    },
    {
      code: 'LITERATURE_RELEVANCE',
      displayName: 'Literature Relevance Analysis',
      featureCode,
      description: 'AI analyzes search results to identify most relevant papers for the research topic',
      sortOrder: 13,
    },
    // Blueprint Stage Operations (Coherence by Construction)
    {
      code: 'PAPER_BLUEPRINT_GEN',
      displayName: 'Generate Blueprint',
      featureCode,
      description: 'AI generates paper blueprint with thesis, section plan, and terminology policy',
      sortOrder: 15,
    },
    // Section Drafting Stage Operations
    {
      code: 'PAPER_SECTION_GEN',
      displayName: 'Generate Section with Memory',
      featureCode,
      description: 'AI generates paper section content with inline memory summary for coherence',
      sortOrder: 20,
    },
    {
      code: 'PAPER_MEMORY_EXTRACT',
      displayName: 'Extract Section Memory',
      featureCode,
      description: 'AI extracts structured memory from manually edited section content',
      sortOrder: 21,
    },
    {
      code: 'PAPER_SECTION_DRAFT',
      displayName: 'Draft Section (Legacy)',
      featureCode,
      description: 'AI generates content for paper sections based on outline',
      sortOrder: 22,
    },
    {
      code: 'PAPER_SECTION_IMPROVE',
      displayName: 'Improve Section',
      featureCode,
      description: 'AI improves writing style, clarity, and academic tone',
      sortOrder: 23,
    },
    {
      code: 'PAPER_CITATION_FORMAT',
      displayName: 'Format Citations',
      featureCode,
      description: 'AI formats citations according to selected style',
      sortOrder: 24,
    },
    // Review Stage Operations
    {
      code: 'PAPER_REVIEW_GAPS',
      displayName: 'Check for Gaps',
      featureCode,
      description: 'AI identifies gaps and missing elements in the paper',
      sortOrder: 30,
    },
    {
      code: 'PAPER_REVIEW_COHERENCE',
      displayName: 'Check Coherence',
      featureCode,
      description: 'AI checks for logical flow and coherence across sections',
      sortOrder: 31,
    },
  ]

  // Create/update workflow stages
  for (const stage of publicationStages) {
    await prisma.workflowStage.upsert({
      where: { code: stage.code },
      update: {
        displayName: stage.displayName,
        featureCode: stage.featureCode,
        description: stage.description,
        sortOrder: stage.sortOrder,
        isActive: true,
      },
      create: {
        ...stage,
        isActive: true,
      },
    })
    console.log(`  ✅ Stage: ${stage.code} - ${stage.displayName}`)
  }

  // ============================================================================
  // 3. Configure default models for stages (for all active plans)
  // ============================================================================
  
  const defaultModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, isActive: true },
  })

  if (!defaultModel) {
    console.log('\n⚠️  No default LLM model found. Skipping plan-stage configuration.')
    console.log('   Run the LLM model seeding script first, then re-run this script.')
  } else {
    // Get lightweight model for quick tasks
    const lightweightModel = await prisma.lLMModel.findFirst({
      where: {
        OR: [
          { code: { contains: 'flash' } },
          { code: { contains: 'mini' } },
          { code: { contains: 'haiku' } },
        ],
        isActive: true,
      },
    }) || defaultModel

    // Get advanced model for heavy reasoning tasks
    const advancedModel = await prisma.lLMModel.findFirst({
      where: {
        OR: [
          { code: { contains: 'pro' } },
          { code: { contains: 'sonnet' } },
          { code: { contains: 'gpt-4o' } },
        ],
        isActive: true,
      },
    }) || defaultModel

    // Get Gemini 2.5 Flash specifically for literature relevance analysis
    // This model excels at classification and analysis tasks
    const gemini25Flash = await prisma.lLMModel.findFirst({
      where: {
        code: 'gemini-2.5-flash',
        isActive: true,
      },
    }) || defaultModel

    // Get Gemini 2.5 Pro for critical reasoning tasks like blueprint generation
    // This model has excellent long-context understanding and reasoning capabilities
    const gemini25Pro = await prisma.lLMModel.findFirst({
      where: {
        code: 'gemini-2.5-pro',
        isActive: true,
      },
    }) || await prisma.lLMModel.findFirst({
      where: {
        code: { contains: 'gemini-2' },
        code: { contains: 'pro' },
        isActive: true,
      },
    }) || advancedModel

    // Get all active plans
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
    })

    console.log(`\n📋 Configuring ${plans.length} plans with publication ideation stages...`)

    // Get GPT-5.2 for Paper Idea Normalization (excellent at extraction and structuring)
    const gpt52Model = await prisma.lLMModel.findFirst({
      where: {
        code: 'gpt-5.2',
        isActive: true,
      },
    }) || advancedModel

    // Stage configurations with GENEROUS token limits to prevent request failures
    // Input tokens are set high to accommodate large context (citations, previous sections, etc.)
    // Output tokens are set high to allow for complete responses
    const stageConfigs: Record<string, { model: typeof defaultModel; maxTokensIn: number; maxTokensOut: number }> = {
      // Paper Idea Normalization - extract from uploaded document (needs high quality extraction)
      'PAPER_TOPIC_EXTRACT_FROM_FILE': { model: gpt52Model, maxTokensIn: 128000, maxTokensOut: 8000 },
      
      // Quick operations - use lightweight model (still generous limits)
      'PAPER_TOPIC_SUGGEST_KEYWORDS': { model: lightweightModel, maxTokensIn: 8000, maxTokensOut: 4096 },
      'PAPER_CITATION_FORMAT': { model: lightweightModel, maxTokensIn: 8000, maxTokensOut: 4096 },
      'PAPER_MEMORY_EXTRACT': { model: lightweightModel, maxTokensIn: 16000, maxTokensOut: 2048 }, // Memory extraction is quick
      
      // Medium operations - use default model (generous limits)
      'PAPER_TOPIC_REFINE_QUESTION': { model: defaultModel, maxTokensIn: 16000, maxTokensOut: 8192 },
      'PAPER_TOPIC_FORMULATE_QUESTION': { model: defaultModel, maxTokensIn: 16000, maxTokensOut: 8192 },
      'PAPER_LITERATURE_SEARCH': { model: defaultModel, maxTokensIn: 16000, maxTokensOut: 8192 },
      
      // Heavy operations - use advanced model (very generous limits for academic content)
      'PAPER_BLUEPRINT_GEN': { model: gemini25Pro, maxTokensIn: 128000, maxTokensOut: 16384 }, // Blueprint generation - CRITICAL STEP - Gemini 2.5 Pro for best reasoning
      'PAPER_TOPIC_GENERATE_HYPOTHESIS': { model: advancedModel, maxTokensIn: 32000, maxTokensOut: 8192 },
      'PAPER_TOPIC_DRAFT_ABSTRACT': { model: advancedModel, maxTokensIn: 32000, maxTokensOut: 8192 },
      'PAPER_TOPIC_ENHANCE_ALL': { model: advancedModel, maxTokensIn: 32000, maxTokensOut: 16384 },
      'PAPER_LITERATURE_SUMMARIZE': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
      'PAPER_LITERATURE_GAP': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
      'LITERATURE_RELEVANCE': { model: gemini25Flash, maxTokensIn: 32000, maxTokensOut: 8192 }, // Gemini 2.5 Flash excels at classification
      'PAPER_SECTION_GEN': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 }, // Section gen with memory needs high limits
      'PAPER_SECTION_DRAFT': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
      'PAPER_SECTION_IMPROVE': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
      'PAPER_REVIEW_GAPS': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
      'PAPER_REVIEW_COHERENCE': { model: advancedModel, maxTokensIn: 64000, maxTokensOut: 16384 },
    }

    for (const plan of plans) {
      for (const stage of publicationStages) {
        const workflowStage = await prisma.workflowStage.findUnique({
          where: { code: stage.code },
        })

        if (!workflowStage) continue

        const config = stageConfigs[stage.code] || { model: defaultModel, maxTokensIn: 4000, maxTokensOut: 4096 }

        await prisma.planStageModelConfig.upsert({
          where: {
            planId_stageId: {
              planId: plan.id,
              stageId: workflowStage.id,
            },
          },
          update: {
            modelId: config.model.id,
            maxTokensIn: config.maxTokensIn,
            maxTokensOut: config.maxTokensOut,
            temperature: 0.7,
            isActive: true,
          },
          create: {
            planId: plan.id,
            stageId: workflowStage.id,
            modelId: config.model.id,
            maxTokensIn: config.maxTokensIn,
            maxTokensOut: config.maxTokensOut,
            temperature: 0.7,
            isActive: true,
          },
        })
      }

      console.log(`  ✅ Configured plan: ${plan.name}`)
    }
  }

  console.log('\n✨ Publication Ideation workflow stages seeded successfully!')
  console.log('\n📌 Super Admin can now configure LLM models for each stage at:')
  console.log('   /super-admin/llm-config')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

