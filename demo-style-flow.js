console.log('🎨 PERSONASYNC STYLE INTEGRATION DEMONSTRATION\n');
console.log('='.repeat(80));

// Simulate the learned style profile (based on what we saw in the database)
const mockLearnedProfile = {
  global: {
    tone: "formal",
    modality: {
      imperative_ratio: 0.5322545066138027,
      indicative_ratio: 0.4677454933861974,
      subjunctive_ratio: 0
    },
    verbosity: "medium",
    terminology: {
      taboo: [],
      preferred: []
    },
    passive_ratio: 0.01012211051761944,
    avoid_connectors: [],
    formatting_habits: {
      bullet_points: true,
      numbered_lists: false,
      section_headers: false,
      emphasis_markers: []
    },
    punctuation_cadence: {
      dash_per_sentence: 0.027442502299908,
      colon_per_sentence: 0.03945325284421857,
      comma_per_sentence: 0.8713124808341,
      semicolon_per_sentence: 0
    },
    preferred_connectors: [],
    sentence_length_stats: {
      max: 82,
      min: 1,
      mean: 16.0852499233364,
      median: 0,
      std_dev: 10.03968911318433
    }
  },
  sections: {
    CLAIMS: {
      micro_rules: {
        lexical_rules: ["comprising", "wherein"],
        numbering_pattern: {
          end: 11,
          start: 1,
          average_gap: 1,
          dependencies_style: "chained"
        }
      },
      word_count_range: [140, 185],
      paragraph_structure: "single",
      sentence_count_range: [24, 45]
    },
    SUMMARY: {
      micro_rules: {
        structure_outline: [
          "state the subject matter",
          "introduce invention and components",
          "list system components with reference numbers",
          "describe high-level interaction",
          "state overall function",
          "reference figures"
        ]
      },
      word_count_range: [145, 180],
      paragraph_structure: "single",
      sentence_count_range: [14, 24]
    },
    ABSTRACT: {
      micro_rules: {
        style_rules: ["comprising"]
      },
      word_count_range: [99, 149],
      paragraph_structure: "single",
      sentence_count_range: [10, 22]
    }
  }
};

// Simulate the style instruction builder
function buildStyleInstructions(profile) {
  const instr = {};
  const g = profile.global || {};

  // Build general instructions
  const genParts = [];
  if (g.tone) genParts.push(`tone=${g.tone}`);
  if (g.verbosity) genParts.push(`verbosity=${g.verbosity}`);
  if (g.sentence_length_stats?.mean) genParts.push(`avg_sentence_length≈${Math.round(g.sentence_length_stats.mean)}`);
  if (typeof g.passive_ratio === 'number') {
    const pr = Math.round(g.passive_ratio * 100) + '%';
    genParts.push(`passive≈${pr}`);
  }
  if (g.formatting_habits) {
    const f = [];
    if (g.formatting_habits.bullet_points) f.push('bullets');
    if (g.formatting_habits.numbered_lists) f.push('numbered-lists');
    if (f.length) genParts.push(`formatting=${f.join('+')}`);
  }
  const general = genParts.join('; ');

  // Build section-specific instructions
  const sec = profile.sections || {};

  if (sec.ABSTRACT) {
    const s = sec.ABSTRACT;
    const parts = [];
    const phr = (s.micro_rules?.style_rules || []).slice(0, 6);
    if (phr.length) parts.push(`style_rules={${phr.join(', ')}}`);
    instr.abstract = general ? `${general}; ${parts.join('; ')}` : parts.join('; ');
  }

  if (sec.CLAIMS) {
    const s = sec.CLAIMS;
    const parts = [];
    const lex = (s.micro_rules?.lexical_rules || []).slice(0, 8);
    if (lex.length) parts.push(`lexical_rules={${lex.join(', ')}}`);
    if (s.micro_rules?.numbering_pattern?.dependencies_style) {
      parts.push(`dependencies=${s.micro_rules.numbering_pattern.dependencies_style}`);
    }
    instr.claims = general ? `${general}; ${parts.join('; ')}` : parts.join('; ');
  }

  return instr;
}

console.log('📊 LEARNED STYLE PROFILE DATA:');
console.log('-'.repeat(50));
console.log(`• Tone: ${mockLearnedProfile.global.tone}`);
console.log(`• Verbosity: ${mockLearnedProfile.global.verbosity}`);
console.log(`• Average Sentence Length: ${Math.round(mockLearnedProfile.global.sentence_length_stats.mean)} words`);
console.log(`• Passive Voice Usage: ${Math.round(mockLearnedProfile.global.passive_ratio * 100)}%`);
console.log(`• Formatting: ${mockLearnedProfile.global.formatting_habits.bullet_points ? 'Bullet points' : 'No bullets'}`);
console.log(`• Claims Lexical Rules: ${mockLearnedProfile.sections.CLAIMS.micro_rules.lexical_rules.join(', ')}`);
console.log(`• Abstract Word Range: ${mockLearnedProfile.sections.ABSTRACT.word_count_range.join('-')} words`);

console.log('\n' + '='.repeat(80));
console.log('🎨 CONVERTED TO DRAFTING INSTRUCTIONS:');
console.log('-'.repeat(50));

const styleInstructions = buildStyleInstructions(mockLearnedProfile);
Object.entries(styleInstructions).forEach(([section, instruction]) => {
  console.log(`🔹 ${section.toUpperCase()}: ${instruction}`);
});

console.log('\n' + '='.repeat(80));
console.log('📝 HOW THIS INTEGRATES INTO DRAFTING PROMPTS:');
console.log('-'.repeat(50));

const roleToneHeader = `You are a **Senior Indian Patent Attorney and Technical Drafter** preparing the "abstract" section
of an **Indian Patent Form-2 Complete Specification** (as per the Patents Rules, 2003).
Maintain a **precise, formal, and neutral tone** throughout.
Write in the **impersonal third person** (no "I", "we", or "our").
Prefer **short, declarative sentences**. Avoid marketing, advocacy, speculation, or emotional adjectives.
Use **Indian English** spelling and conventions.
Follow all professional drafting norms used in the Indian Patent Office.`;

console.log(`
${roleToneHeader}

Task: Generate the Abstract for Indian Patent Form-2.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 130–150 words (hard cap 150).
- Must begin exactly with the approved Title (case- and space-normalized).
- Avoid numeric data unless essential to describe architecture.
- No numerals, figure references, or claim terms.
- No evaluative adjectives ("novel", "inventive", "unique", "best", "advantage", "benefit").

Context:
title idea=[USER TITLE]; problem=[USER PROBLEM]; objectives=[USER OBJECTIVES].

Instructions(abstract): ${styleInstructions.abstract}

Target length: 130–150 words.
Output JSON: { "abstract": "..." }

Return ONLY a valid JSON object exactly matching the schema above.`);

console.log('\n' + '='.repeat(80));
console.log('🎯 STYLE ELEMENTS BEING APPLIED:');
console.log('-'.repeat(50));

const abstractInstr = styleInstructions.abstract;
console.log(`Abstract Instructions: "${abstractInstr}"`);
console.log('');
console.log('This tells the LLM to:');
if (abstractInstr.includes('tone=formal')) console.log('  ✅ Use formal tone');
if (abstractInstr.includes('verbosity=medium')) console.log('  ✅ Use medium verbosity');
if (abstractInstr.includes('avg_sentence_length')) console.log('  ✅ Aim for ~16 word sentences');
if (abstractInstr.includes('passive≈1%')) console.log('  ✅ Use minimal passive voice (1%)');
if (abstractInstr.includes('formatting=bullets')) console.log('  ✅ Include bullet points when appropriate');
if (abstractInstr.includes('style_rules=')) console.log('  ✅ Use "comprising" in style rules');

console.log('\n' + '='.repeat(80));
console.log('🔄 COMPLETE PERSONASYNC FLOW:');
console.log('-'.repeat(50));
console.log('1. 📄 User uploads patent documents → LLM analyzes patterns');
console.log('2. 🧠 AI extracts writing style → Creates comprehensive profile');
console.log('3. 💾 Profile stored in database → Ready for future use');
console.log('4. 🎨 Style builder converts profile → Generates section instructions');
console.log('5. 📝 Instructions merged into prompts → LLM gets user-specific guidance');
console.log('6. 🤖 AI generates patent text → Matches user\'s exact writing style');
console.log('7. ✨ Result: Patent drafted in user\'s voice → Seamless, personalized experience');

console.log('\n🎉 PersonaSync enables truly personalized patent drafting!');
