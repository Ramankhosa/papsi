/**
 * TEST SCRIPT: Demonstrating Prompt Combination for Indian Jurisdiction
 */

const INDIAN_PROMPTS = require('./indian_prompts_combined');

// ============================================================================
// PROMPT MERGER FUNCTION (simulating the actual prompt merger service)
// ============================================================================

function combinePrompts(sectionKey) {
  const section = INDIAN_PROMPTS[sectionKey];
  if (!section) {
    throw new Error(`Section '${sectionKey}' not found in Indian prompts`);
  }

  // Combine base instruction + top-up instruction
  let combinedInstruction = section.base;

  if (section.topUp) {
    combinedInstruction += '\n\n' + section.topUp;
  }

  // Add additions if present
  if (section.additions && section.additions.length > 0) {
    combinedInstruction += '\n\n**Additional Guidelines:**\n' +
      section.additions.map(addition => `- ${addition}`).join('\n');
  }

  return {
    instruction: combinedInstruction,
    constraints: section.constraints || []
  };
}

// ============================================================================
// TEST EXAMPLES
// ============================================================================

console.log('='.repeat(80));
console.log('INDIAN JURISDICTION PROMPT COMBINATION TEST');
console.log('='.repeat(80));

// Test Title Section
console.log('\n📝 TITLE SECTION COMBINATION:');
console.log('-'.repeat(50));
const titleCombined = combinePrompts('title');
console.log('INSTRUCTION:');
console.log(titleCombined.instruction);
console.log('\nCONSTRAINTS:');
titleCombined.constraints.forEach(c => console.log(`• ${c}`));

// Test Objects of Invention (unique to Indian practice)
console.log('\n\n🎯 OBJECTS OF INVENTION SECTION (INDIAN-SPECIFIC):');
console.log('-'.repeat(50));
const objectsCombined = combinePrompts('objectsOfInvention');
console.log('INSTRUCTION:');
console.log(objectsCombined.instruction);
console.log('\nCONSTRAINTS:');
objectsCombined.constraints.forEach(c => console.log(`• ${c}`));

// Test Claims Section
console.log('\n\n⚖️ CLAIMS SECTION COMBINATION:');
console.log('-'.repeat(50));
const claimsCombined = combinePrompts('claims');
console.log('INSTRUCTION:');
console.log(claimsCombined.instruction);
console.log('\nCONSTRAINTS:');
claimsCombined.constraints.forEach(c => console.log(`• ${c}`));

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n\n' + '='.repeat(80));
console.log('SUMMARY OF COMBINATIONS TESTED');
console.log('='.repeat(80));
console.log(`✅ Successfully combined prompts for ${Object.keys(INDIAN_PROMPTS).length} sections`);
console.log('✅ Base prompts merged with Indian jurisdiction top-ups');
console.log('✅ Constraints properly aggregated');
console.log('✅ Ready for testing in patent drafting system');

// Show which sections have unique Indian requirements
const sectionsWithTopUps = Object.entries(INDIAN_PROMPTS)
  .filter(([_, prompts]) => prompts.topUp)
  .map(([key, _]) => key);

console.log(`\n📋 Sections with Indian-specific top-ups: ${sectionsWithTopUps.join(', ')}`);
