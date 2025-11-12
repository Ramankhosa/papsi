// Demonstration: Dynamic vs Static Style Injection in PersonaSync

console.log('🔄 PERSONASYNC: DYNAMIC STYLE INJECTION (NOT HARD-CODED)\n');
console.log('='.repeat(80));

// Show how the drafting service dynamically builds prompts
function buildSectionPrompt(section, payload) {
  const { instructions } = payload;
  const instr = (instructions && instructions[section]) ? instructions[section] : 'none';

  return `
Task: Generate the ${section} section.
Context: [Patent details here]
Instructions(${section}): ${instr}
Output: JSON format
`;
}

// Example 1: WITHOUT PersonaSync (static/fallback)
console.log('📝 EXAMPLE 1: WITHOUT PERSONASYNC (STATIC)');
console.log('-'.repeat(50));
const staticPrompt = buildSectionPrompt('abstract', { instructions: null });
console.log(staticPrompt);

// Example 2: WITH PersonaSync (dynamic injection)
console.log('🎨 EXAMPLE 2: WITH PERSONASYNC (DYNAMIC INJECTION)');
console.log('-'.repeat(50));

// Simulate the merged instructions from PersonaSync
const personaSyncInstructions = {
  abstract: 'tone=formal; verbosity=medium; avg_sentence_length≈16; passive≈1%; formatting=bullets; style_rules={comprising}',
  claims: 'tone=formal; verbosity=medium; avg_sentence_length≈16; passive≈1%; lexical_rules={comprising, wherein}; dependencies=chained',
  background: 'tone=formal; verbosity=medium; avg_sentence_length≈16; passive≈1%; structure=state the subject matter → introduce invention and components → list system components with reference numbers → describe high-level interaction → state overall function → reference figures'
};

const dynamicPrompt = buildSectionPrompt('abstract', { instructions: personaSyncInstructions });
console.log(dynamicPrompt);

// Show the actual code flow
console.log('\n' + '='.repeat(80));
console.log('🔧 ACTUAL CODE FLOW:');
console.log('-'.repeat(50));

console.log(`
// 1. API Route Merges Instructions Dynamically
let mergedInstructions = userInstructions; // From request
try {
  const styleInstr = await getGatedStyleInstructions(tenantId, userId);
  if (styleInstr) {
    mergedInstructions = { ...userInstructions };
    for (const [section, styleInstruction] of Object.entries(styleInstr)) {
      mergedInstructions[section] = mergedInstructions[section]
        ? \`\${mergedInstructions[section]} ; \${styleInstruction}\`
        : styleInstruction;
    }
  }
} catch (e) { /* fallback to userInstructions */ }

// 2. DraftingService Receives Dynamic Instructions
const result = await DraftingService.generateSections(
  session,
  sections,
  mergedInstructions,  // ← DYNAMICALLY PASSED HERE
  tenantId,
  requestHeaders,
  selectedPatents
);

// 3. Template Literals Inject Instructions Dynamically
private static buildSectionPrompt(section: string, payload: any): string {
  const { instructions } = payload;
  const instr = (instructions && instructions[section])
    ? instructions[section]    // ← DYNAMIC INJECTION
    : 'none';                  // ← FALLBACK IF NONE

  return \`
\${roleToneHeader}
Task: Generate the \${section} section...
Instructions(\${section}): \${instr}  // ← DYNAMICALLY INSERTED HERE
Output: JSON format
\`;
}
`);

// Show the key difference
console.log('\n' + '='.repeat(80));
console.log('🎯 KEY DIFFERENCE: DYNAMIC vs STATIC');
console.log('-'.repeat(50));

console.log('❌ STATIC (HARD-CODED) WOULD BE:');
console.log('   Instructions(abstract): tone=formal; verbosity=medium; ...');
console.log('   (Same for every user, never changes)');

console.log('\n✅ DYNAMIC (PERSONASYNC) IS:');
console.log('   Instructions(abstract):', personaSyncInstructions.abstract);
console.log('   (Different for each user based on their learned style)');

console.log('\n🔄 PERSONASYNC IS COMPLETELY DYNAMIC!');
console.log('   • Style instructions generated from user\'s uploaded documents');
console.log('   • Instructions vary per user based on their writing patterns');
console.log('   • Each drafting session gets personalized instructions');
console.log('   • No hard-coded style rules - everything adapts to the user');
