const { getGatedStyleInstructions } = require('./src/lib/style-instruction-builder.ts');

async function demoStyleIntegration() {
  console.log('🎨 PERSONASYNC STYLE INTEGRATION DEMONSTRATION\n');
  console.log('='.repeat(80));

  try {
    // Get the style instructions for the individual@gmail.com user
    const styleInstr = await getGatedStyleInstructions('cmhru2goo0006918wi7yfw7mi', 'cmhru2h3e000c918wsdoj4cwc');

    if (styleInstr) {
      console.log('✅ Style Profile Found - Converting to Drafting Instructions:\n');

      console.log('📋 GENERATED STYLE INSTRUCTIONS:');
      console.log('-'.repeat(50));
      Object.entries(styleInstr).forEach(([section, instruction]) => {
        console.log(`🔹 ${section.toUpperCase()}: ${instruction}`);
      });

      console.log('\n' + '='.repeat(80));
      console.log('🎯 HOW THESE INTEGRATE INTO DRAFTING PROMPTS:\n');

      // Show how it appears in the actual prompt
      console.log('📝 EXAMPLE: ABSTRACT SECTION PROMPT');
      console.log('-'.repeat(50));

      const roleToneHeader = `
You are a **Senior Indian Patent Attorney and Technical Drafter** preparing the "abstract" section
of an **Indian Patent Form-2 Complete Specification** (as per the Patents Rules, 2003).
Maintain a **precise, formal, and neutral tone** throughout.
Write in the **impersonal third person** (no "I", "we", or "our").
Prefer **short, declarative sentences**. Avoid marketing, advocacy, speculation, or emotional adjectives.
Use **Indian English** spelling and conventions.
Follow all professional drafting norms used in the Indian Patent Office.

Before emitting output, apply this internal self-checklist:
1. Confirm compliance with section-specific word range (±20% tolerance).
2. Confirm forbidden words (novel, inventive, best, unique, advantage, benefit, claim, claims, etc.) are absent.
3. Confirm all numerals appear in parentheses, match declared ReferenceMap numerals, and no invented numerals appear.
4. Confirm all figure references correspond to existing figures only, using "Fig. X" format.
5. Confirm tone is technical, objective, and impersonal.
6. Confirm no claim language appears outside the Claims section.
7. Confirm JSON format matches the requested output schema exactly.
8. Confirm units are SI; ranges are closed (e.g., 5–10 °C, not "about 10").
9. Confirm antecedent basis and logical consistency where applicable.
10. Confirm the text would be legally and technically acceptable for filing at the Indian Patent Office.

Good tone example: "The controller (110) regulates voltage based on feedback from sensor (120)."
Bad tone example: "This innovative controller smartly manages voltage in the best way possible."
`;

      console.log(`
${roleToneHeader}
Task: Generate the Abstract for Indian Patent Form-2.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 130–150 words (hard cap 150).
- Must **begin exactly** with the approved Title (case- and space-normalized).
- Avoid numeric data unless essential to describe architecture (e.g., layer count, dimension, or temperature).
- No numerals, figure references, or claim terms.
- No evaluative adjectives ("novel", "inventive", "unique", "best", "advantage", "benefit").
Context:
title idea=[USER TITLE]; problem=[USER PROBLEM]; objectives=[USER OBJECTIVES].
Instructions(abstract): ${styleInstr.abstract || 'none'}
Target length: 130–150 words.
Output JSON: { "abstract": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`);

      console.log('\n' + '='.repeat(80));
      console.log('🎨 STYLE ELEMENTS BEING APPLIED:');
      console.log('-'.repeat(50));

      const abstractInstr = styleInstr.abstract;
      if (abstractInstr) {
        console.log('Abstract Section Instructions:');
        console.log(`  "${abstractInstr}"`);
        console.log('');
        console.log('This means the LLM will:');
        if (abstractInstr.includes('tone=formal')) console.log('  ✅ Use formal tone');
        if (abstractInstr.includes('verbosity=')) console.log('  ✅ Match verbosity level');
        if (abstractInstr.includes('avg_sentence_length')) console.log('  ✅ Aim for similar sentence lengths');
        if (abstractInstr.includes('passive≈')) console.log('  ✅ Use similar passive voice ratio');
        if (abstractInstr.includes('connectors=')) console.log('  ✅ Prefer specific connecting words');
        if (abstractInstr.includes('formatting=')) console.log('  ✅ Apply similar formatting habits');
        if (abstractInstr.includes('word_cap=')) console.log('  ✅ Respect word limits');
        if (abstractInstr.includes('style_rules=')) console.log('  ✅ Follow specific style rules');
      }

      console.log('\n' + '='.repeat(80));
      console.log('🔄 COMPLETE FLOW SUMMARY:');
      console.log('-'.repeat(50));
      console.log('1. 📄 User uploads patent documents');
      console.log('2. 🧠 LLM analyzes writing patterns');
      console.log('3. 💾 Style profile saved to database');
      console.log('4. 🎨 Style instructions generated');
      console.log('5. 📝 Instructions merged into drafting prompts');
      console.log('6. 🤖 LLM generates patent text in user\'s style');

    } else {
      console.log('❌ No style profile found or plan does not support PersonaSync');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

demoStyleIntegration();
