/**
 * Test script to validate jurisdiction-specific diagram instructions
 * 
 * Run with: npx tsx scripts/test-diagram-instructions.ts
 */

import { getDiagramConfig, generateDiagramPromptInstructions } from '../src/lib/jurisdiction-style-service'

async function testDiagramInstructions() {
  console.log('='.repeat(80))
  console.log('Testing Jurisdiction-Specific Diagram Instructions')
  console.log('='.repeat(80))

  const jurisdictions = ['IN', 'US', 'PCT', 'AU', 'JP']

  for (const jurisdiction of jurisdictions) {
    console.log(`\n${'─'.repeat(80)}`)
    console.log(`JURISDICTION: ${jurisdiction}`)
    console.log('─'.repeat(80))

    try {
      // Test 1: Get diagram config
      const config = await getDiagramConfig(jurisdiction)
      
      console.log('\n📋 Diagram Configuration:')
      console.log(`  • Figure Label Format: ${config.figureLabelFormat}`)
      console.log(`  • Color Allowed: ${config.colorAllowed}`)
      console.log(`  • Line Style: ${config.lineStyle}`)
      console.log(`  • Reference Numerals Mandatory: ${config.referenceNumeralsMandatory}`)
      console.log(`  • Min Text Size: ${config.minReferenceTextSizePt}pt`)
      console.log(`  • Paper Size: ${config.paperSize}`)
      console.log(`  • Supported Types: ${config.supportedDiagramTypes.join(', ')}`)
      console.log(`  • Config Source: ${config.source}`)

      // Test 2: Show available hints
      console.log('\n📝 Available Diagram Hints:')
      for (const [type, hint] of Object.entries(config.hints)) {
        console.log(`  • ${type}: ${hint.substring(0, 80)}${hint.length > 80 ? '...' : ''}`)
      }

      // Test 3: Generate full prompt instructions for 'block' diagram
      console.log('\n🔧 Generated LLM Instructions (block diagram):')
      const instructions = await generateDiagramPromptInstructions(jurisdiction, 'block')
      console.log(instructions.split('\n').map(line => `  ${line}`).join('\n'))

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('✅ Test Complete')
  console.log('='.repeat(80))
}

testDiagramInstructions()
  .catch(console.error)
  .finally(() => process.exit(0))

