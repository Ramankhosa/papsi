import { StyleProfile, GlobalStyleRules, SectionStyleRules, PatentSection } from '@/types/persona-sync';
import type { ImageContent } from '@/lib/metering/types';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

// Dynamic import for PDF parsing to avoid Next.js bundling issues
let pdfParser: any = null;

export class StyleLearner {
  /**
   * Extract clean text from various document formats
   */
  static async extractText(file: File | Buffer, filename?: string): Promise<string> {
    const fileExtension = filename ?
      filename.split('.').pop()?.toLowerCase() :
      file instanceof File ? file.name.split('.').pop()?.toLowerCase() :
      'unknown';

    if (!fileExtension) {
      throw new Error('Could not determine file extension');
    }

    if (file instanceof Buffer) {
      return this.extractTextFromBuffer(file, fileExtension);
    } else {
      return this.extractTextFromFile(file as File, fileExtension);
    }
  }

  private static async extractTextFromFile(file: File, fileExtension: string): Promise<string> {
    try {
      switch (fileExtension) {
        case 'txt':
        case 'md':
          return await file.text();

        case 'docx':
          const docxText = await this.extractFromDocxFile(file);
          return docxText || ''; // Return empty string if extraction failed

        case 'pdf':
          const pdfText = await this.extractFromPdfFile(file);
          return pdfText || ''; // Return empty string if extraction failed

        default:
          throw new Error(`Unsupported file format: ${fileExtension}`);
      }
    } catch (error) {
      console.error(`Error extracting text from ${fileExtension} file:`, error);
      return ''; // Return empty string on error
    }
  }

  private static async extractTextFromBuffer(buffer: Buffer, fileExtension: string): Promise<string> {
    try {
      switch (fileExtension) {
        case 'txt':
        case 'md':
          return buffer.toString('utf8');

        case 'docx':
          const docxText = await this.extractFromDocxBuffer(buffer);
          return docxText || ''; // Return empty string if extraction failed

        case 'pdf':
          const pdfText = await this.extractFromPdfBuffer(buffer);
          return pdfText || ''; // Return empty string if extraction failed

        default:
          throw new Error(`Unsupported file format: ${fileExtension}`);
      }
    } catch (error) {
      console.error(`Error extracting text from ${fileExtension} buffer:`, error);
      return ''; // Return empty string on error
    }
  }

  private static async extractFromDocxFile(file: File): Promise<string> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      console.error('Error extracting text from DOCX file:', error);
      return ''; // Return empty string on error
    }
  }

  private static async extractFromDocxBuffer(buffer: Buffer): Promise<string> {
    try {
      // Use the Node.js API which accepts a Buffer directly
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      console.error('Error extracting text from DOCX buffer:', error);
      return ''; // Return empty string on error
    }
  }

  private static async extractFromPdfFile(file: File): Promise<string> {
    try {
      // Dynamically import pdf2text to avoid Next.js bundling issues
      if (!pdfParser) {
        const pdf2text = await import('pdf2text');
        pdfParser = pdf2text;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await pdfParser.pdf2text(buffer);
      return Array.isArray(text) ? text.join('\n') : text;
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      // Fallback: return empty string to avoid breaking the flow
      return '';
    }
  }

  private static async extractFromPdfBuffer(buffer: Buffer): Promise<string> {
    try {
      // Dynamically import pdf2text to avoid Next.js bundling issues
      if (!pdfParser) {
        const pdf2text = await import('pdf2text');
        pdfParser = pdf2text;
      }

      const text = await pdfParser.pdf2text(buffer);
      return Array.isArray(text) ? text.join('\n') : text;
    } catch (error) {
      console.error('Error extracting text from PDF buffer:', error);
      // Fallback: return empty string to avoid breaking the flow
      return '';
    }
  }

  /**
   * Segment text into patent sections
   */
  static segmentSections(text: string): Record<PatentSection, string> {
    const sections: Record<PatentSection, string> = {
      ABSTRACT: '',
      CLAIMS: '',
      BACKGROUND: '',
      SUMMARY: '',
      BRIEF_DESCRIPTION: '',
      DETAILED_DESCRIPTION: ''
    };

    // Simple header-based segmentation (can be enhanced with ML)
    const lines = text.split('\n');
    let currentSection: PatentSection | null = null;

    for (const line of lines) {
      const upperLine = line.toUpperCase().trim();

      // Check for section headers
      if (upperLine.includes('ABSTRACT')) {
        currentSection = 'ABSTRACT';
      } else if (upperLine.includes('CLAIM') && !upperLine.includes('DESCRIPTION')) {
        currentSection = 'CLAIMS';
      } else if (upperLine.includes('BACKGROUND')) {
        currentSection = 'BACKGROUND';
      } else if (upperLine.includes('SUMMARY')) {
        currentSection = 'SUMMARY';
      } else if (upperLine.includes('BRIEF DESCRIPTION')) {
        currentSection = 'BRIEF_DESCRIPTION';
      } else if (upperLine.includes('DETAILED DESCRIPTION')) {
        currentSection = 'DETAILED_DESCRIPTION';
      }

      // Append content to current section
      if (currentSection && line.trim()) {
        sections[currentSection] += line + '\n';
      }
    }

    return sections;
  }

  /**
   * Compute global style features
   */
  static computeGlobalFeatures(text: string): GlobalStyleRules {
    const sentences = this.splitIntoSentences(text);
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // Tone analysis (simplified)
    const tone = this.analyzeTone(text);

    // Sentence length statistics
    const sentenceLengths = sentences.map(s => this.countWords(s));
    const sentenceStats = {
      mean: sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length,
      median: this.median(sentenceLengths),
      std_dev: this.standardDeviation(sentenceLengths),
      min: Math.min(...sentenceLengths),
      max: Math.max(...sentenceLengths)
    };

    // Passive voice ratio
    const passiveRatio = this.analyzePassiveVoice(sentences);

    // Modality analysis
    const modality = this.analyzeModality(sentences);

    // Connector analysis
    const connectors = this.analyzeConnectors(sentences);

    // Punctuation analysis
    const punctuation = this.analyzePunctuation(text);

    // Terminology extraction
    const terminology = this.extractTerminology(text);

    // Formatting habits
    const formatting = this.analyzeFormatting(text);

    return {
      tone,
      verbosity: words.length > 500 ? 'high' : words.length > 200 ? 'medium' : 'low',
      sentence_length_stats: sentenceStats,
      passive_ratio: passiveRatio,
      modality,
      preferred_connectors: connectors.preferred,
      avoid_connectors: connectors.avoid,
      punctuation_cadence: punctuation,
      terminology,
      formatting_habits: formatting
    };
  }

  /**
   * Compute section-specific features
   */
  static computeSectionFeatures(sections: Record<PatentSection, string>): Record<PatentSection, SectionStyleRules> {
    const sectionRules: Record<PatentSection, SectionStyleRules> = {} as any;

    for (const [section, content] of Object.entries(sections)) {
      const sentences = this.splitIntoSentences(content);
      const words = content.split(/\s+/).filter(w => w.length > 0);

      sectionRules[section as PatentSection] = {
        word_count_range: [Math.floor(words.length * 0.8), Math.ceil(words.length * 1.2)],
        sentence_count_range: [Math.floor(sentences.length * 0.8), Math.ceil(sentences.length * 1.2)],
        paragraph_structure: this.analyzeParagraphStructure(content),
        micro_rules: this.extractSectionMicroRules(section as PatentSection, content)
      };
    }

    return sectionRules;
  }

  /**
   * Validate profile quality
   */
  static validateProfile(profile: StyleProfile): {
    isValid: boolean;
    score: number;
    issues: string[]
  } {
    const issues: string[] = [];
    let score = 100;

    // Check minimum content requirements
    if (profile.metadata.total_tokens < 1000) {
      issues.push('Insufficient training data (minimum 1000 tokens)');
      score -= 50;
    }

    // Check entropy (style consistency)
    if (profile.metadata.entropy_score < 0.3) {
      issues.push('Low style entropy - insufficient stylistic variation');
      score -= 20;
    }

    // Check coverage
    if (profile.metadata.coverage_score < 0.5) {
      issues.push('Low coverage score - profile may not represent full writing style');
      score -= 30;
    }

    return {
      isValid: score >= 60,
      score: Math.max(0, score),
      issues
    };
  }

  /**
   * Generate complete style profile from File objects (client-side)
   */
  static async generateProfile(
    samples: File[],
    jurisdictionHints?: string[]
  ): Promise<StyleProfile> {
    const allText = await Promise.all(samples.map(file => this.extractText(file)));
    const combinedText = allText.join('\n\n');
    const totalTokens = this.estimateTokens(combinedText);

    // Segment sections
    const sections = this.segmentSections(combinedText);

    // Compute features
    const global = this.computeGlobalFeatures(combinedText);
    const sectionRules = this.computeSectionFeatures(sections);

    // Calculate quality metrics
    const entropy = this.calculateEntropy(combinedText);
    const coverage = this.calculateCoverage(sections);

    const profile: StyleProfile = {
      global,
      sections: sectionRules,
      safety_constraints: {
        preserve_meaning: true,
        jurisdiction_overrides: {},
        content_restrictions: {
          avoid_legal_opinions: true,
          maintain_technical_accuracy: true,
          preserve_claim_scope: true
        }
      },
      metadata: {
        training_samples: samples.length,
        total_tokens: totalTokens,
        entropy_score: entropy,
        coverage_score: coverage,
        created_at: new Date().toISOString(),
        version: '1.0',
        jurisdiction_hints: jurisdictionHints
      }
    };

    return profile;
  }

  /**
   * Generate complete style profile from Buffer objects (server-side)
   */
  static async generateProfileFromBuffers(
    samples: { buffer: Buffer; filename: string }[],
    jurisdictionHints?: string[]
  ): Promise<StyleProfile> {
    const allText = await Promise.all(
      samples.map(({ buffer, filename }) => this.extractText(buffer, filename))
    );
    const combinedText = allText.join('\n\n');
    const totalTokens = this.estimateTokens(combinedText);

    // Segment sections
    const sections = this.segmentSections(combinedText);

    // Compute features
    const global = this.computeGlobalFeatures(combinedText);
    const sectionRules = this.computeSectionFeatures(sections);

    // Calculate quality metrics
    const entropy = this.calculateEntropy(combinedText);
    const coverage = this.calculateCoverage(sections);

    const profile: StyleProfile = {
      global,
      sections: sectionRules,
      safety_constraints: {
        preserve_meaning: true,
        jurisdiction_overrides: {},
        content_restrictions: {
          avoid_legal_opinions: true,
          maintain_technical_accuracy: true,
          preserve_claim_scope: true
        }
      },
      metadata: {
        training_samples: samples.length,
        total_tokens: totalTokens,
        entropy_score: entropy,
        coverage_score: coverage,
        created_at: new Date().toISOString(),
        version: '1.0',
        jurisdiction_hints: jurisdictionHints
      }
    };

    return profile;
  }

  /**
   * Generate complete style profile with multimodal analysis (text + images)
   */
  static async generateProfileFromBuffersWithImages(
    samples: { buffer: Buffer; filename: string }[],
    jurisdictionHints?: string[],
    tenantContext?: { tenantId: string; userId: string; planId: string }
  ): Promise<StyleProfile> {
    // Extract both text and images from all samples
    const textResults = await Promise.all(
      samples.map(({ buffer, filename }) => this.extractText(buffer, filename))
    );
    const imageResults = await Promise.all(
      samples.map(({ buffer, filename }) => this.extractImages(buffer, filename))
    );

    const combinedText = textResults.join('\n\n');
    const allImages = imageResults.flat();

    // First, analyze text-only for basic features
    const totalTokens = this.estimateTokens(combinedText);
    const sections = this.segmentSections(combinedText);
    let global = this.computeGlobalFeatures(combinedText);
    let sectionRules = this.computeSectionFeatures(sections);

    // Refine via forensic LLM analysis (text-only)
    try {
      const forensic = await this.llmForensicAnalyze(combinedText, tenantContext)
      const mapped = this.mapForensicToInternal(forensic, global, sectionRules, totalTokens)
      global = mapped.global
      sectionRules = mapped.sections
    } catch (err) {
      console.warn('Forensic style analysis failed, using heuristic-only:', err)
    }

    // Optionally enhance select global attributes with multimodal (if images exist)
    if (allImages.length > 0) {
      try {
        global = await this.enhanceStyleAnalysisWithImages(combinedText, allImages, global, tenantContext);
      } catch (error) {
        console.warn('Multimodal analysis failed, falling back to text-only:', error);
      }
    }

    // Calculate quality metrics
    const entropy = this.calculateEntropy(combinedText);
    const coverage = this.calculateCoverage(sections);

    // Enforce generic-only style before building profile
    const sanitized = this.sanitizeStyle(global, sectionRules)

    const profile: StyleProfile = {
      global: sanitized.global,
      sections: sanitized.sections,
      safety_constraints: {
        preserve_meaning: true,
        jurisdiction_overrides: {},
        content_restrictions: {
          avoid_legal_opinions: true,
          maintain_technical_accuracy: true,
          preserve_claim_scope: true
        }
      },
      metadata: {
        training_samples: samples.length,
        total_tokens: totalTokens,
        entropy_score: entropy,
        coverage_score: coverage,
        created_at: new Date().toISOString(),
        version: '1.0',
        jurisdiction_hints: jurisdictionHints,
        multimodal_analysis: allImages.length > 0
      }
    };

    return profile;
  }

  /**
   * Use multimodal LLM to enhance style analysis with visual content
   */
  private static async enhanceStyleAnalysisWithImages(
    text: string,
    images: ImageContent[],
    baseGlobal: GlobalStyleRules,
    tenantContext?: { tenantId: string; userId: string; planId: string }
  ): Promise<GlobalStyleRules> {
    // Import the LLM gateway
    const { LLMGateway } = await import('@/lib/metering/gateway');

    const gateway = new LLMGateway();

    // Build multimodal prompt for style analysis
    const multimodalContent = {
      parts: [
        {
          type: 'text' as const,
          text: `Analyze the writing style in this patent document. Consider both the text content and any visual elements (diagrams, layouts, formatting).

Text content (truncated):
${text.substring(0, 2000)}

Based on both the text and visual elements, return ONLY a minified JSON object with exactly these keys and no extra commentary, no markdown fences:
{
  "tone": "formal|technical|concise|detailed|neutral",
  "verbosity": "low|medium|high",
  "visual_style": "clean|technical|detailed|minimal",
  "communication_approach": "direct|elaborate|balanced"
}`
        },
        // Include first image for visual analysis
        ...(images.slice(0, 1).map(img => ({
          type: 'image' as const,
          image: img
        })))
      ]
    };

    try {
      const response = await gateway.executeLLMOperation(
        tenantContext ? { tenantContext } : { headers: {} },
        {
          taskCode: 'PERSONA_SYNC_LEARN',
          content: multimodalContent,
          modelClass: 'gemini-2.5-pro', // Prefer Gemini for multimodal
          inputTokens: Math.ceil(text.substring(0, 2000).length / 4)
        }
      );

      if (response.success && response.response) {
        // Parse the JSON response and enhance the global features
        try {
          const raw = response.response.output || '';
          const jsonText = this.extractFirstJsonBlock(raw) || raw;
          const analysis = JSON.parse(jsonText);

          return {
            ...baseGlobal,
            tone: analysis.tone || baseGlobal.tone,
            verbosity: analysis.verbosity || baseGlobal.verbosity,
            // Add visual style insights
            formatting_habits: {
              ...baseGlobal.formatting_habits,
              visual_style: analysis.visual_style || 'technical'
            }
          };
        } catch (parseError) {
          console.warn('Failed to parse multimodal analysis response:', parseError);
          return baseGlobal;
        }
      }
    } catch (error) {
      console.warn('Multimodal analysis failed:', error);
    }

    return baseGlobal;
  }

  // Attempt to extract the first valid JSON object from LLM output
  private static extractFirstJsonBlock(output: string): string | null {
    const match = output.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }

  /**
   * Smart sample text to ensure Claims (often at end) and Intro (start) are captured.
   */
  private static getSmartSample(text: string): string {
    const limit = 15000;
    if (text.length <= limit) return text;
    
    const startChunk = text.substring(0, 6000);
    const endChunk = text.substring(text.length - 8000);
    
    return `${startChunk}\n\n[...SKIPPED MIDDLE SECTION...]\n\n${endChunk}`;
  }

  // LLM forensic analyzer using the provided strict schema prompt (text-only)
  private static async llmForensicAnalyze(
    text: string,
    tenantContext?: { tenantId: string; userId: string; planId: string }
  ): Promise<any> {
    const { LLMGateway } = await import('@/lib/metering/gateway');
    const gateway = new LLMGateway();

    const systemPrompt = `You are a forensic patent-writing style analyst.
Return ONLY valid JSON (no commentary, no fences) conforming to the schema below. Learn generic stylistic signals only; do NOT include domain-specific technical vocabulary. Keep recurring phrases generic.

Schema (strict):
{
  "version": "5.2",
  "created_at": "<ISO8601>",
  "global_style": {
    "tone": "concise | detailed | explanatory | formal | neutral",
    "verbosity": "low | medium | high",
    "hedging_level": "high | medium | low",
    "avg_sentence_length": 0,
    "punctuation_usage": { "comma_per_sentence": 0.0, "semicolon_per_sentence": 0.0, "dash_per_sentence": 0.0 },
    "connectors_freq": {},
    "formatting": { "lists_used": false, "paragraph_structure": "single | multi" }
  },
  "sections": {
    "ABSTRACT": { "word_range": [0,0], "recurring_phrases": [], "evidence": [], "few_shot_snippet": "Anonymized abstract text (replace nouns with [Device]/[Component])" },
    "BACKGROUND_OF_THE_INVENTION": { "word_range": [0,0], "structure_outline": [], "prior_art_tone": "neutral | critical | constructive", "few_shot_snippet": "Anonymized background snippet" },
    "SUMMARY_OF_THE_INVENTION": { "word_range": [0,0], "structure_outline": [], "evidence": [] },
    "BRIEF_DESCRIPTION_OF_THE_DRAWINGS": { "word_range": [0,0], "figure_caption_template": "", "evidence": [] },
    "DETAILED_DESCRIPTION_OF_THE_INVENTION": { 
      "word_range": [0,0], 
      "embodiment_phrases": [], 
      "figure_numbering": { "style": "(100) | 100 | C100", "series_hint": "", "start": 0, "end": 0, "average_gap": 0.0 }, 
      "boilerplate_location": "summary | detailed_desc_start | detailed_desc_end",
      "cross_linking_density": "high | medium | low",
      "few_shot_snippet": "Anonymized paragraph showing dense cross-linking (Fig. X + Fig. Y)"
    },
    "CLAIMS": { 
      "word_range": [0,0], 
      "opening_style": "", 
      "numbering_pattern": { "start": 0, "end": 0, "average_gap": 0.0, "dependencies_style": "all_dependent_on_1 | chained | mixed" }, 
      "claim_ordering": ["method", "system", "medium"],
      "preamble_type": "configured_to | arranged_to | for",
      "use_numerals": false,
      "few_shot_snippet": "Anonymized independent claim"
    },
    "INDUSTRIAL_APPLICABILITY": { "word_range": [0,0] }
  }
}

Constraints:
- Numbers must be numbers. created_at is ISO8601.
- Omit fields you cannot infer; do not invent.
- few_shot_snippet must be generic (replace specific invention terms with placeholders like [Widget], [Material]).
- Output JSON only.`

    const truncated = this.getSmartSample(text);

    const content = {
      parts: [
        { type: 'text' as const, text: systemPrompt },
        { type: 'text' as const, text: `Patent text (truncated):\n${truncated}` }
      ]
    };

    const inputTokens = Math.ceil(truncated.length / 4);

    const result = await gateway.executeLLMOperation(
      tenantContext ? { tenantContext } : { headers: {} },
      {
        taskCode: 'PERSONA_SYNC_LEARN',
        content,
        modelClass: 'gemini-2.5-pro',
        inputTokens
      }
    );

    if (!result.success || !result.response) {
      throw new Error(result.error ? String(result.error) : 'LLM gateway error');
    }

    const raw = result.response.output || '';
    const jsonText = this.extractFirstJsonBlock(raw) || raw;
    return JSON.parse(jsonText);
  }

  // Map the forensic JSON schema to our internal StyleProfile structure
  private static mapForensicToInternal(
    forensic: any,
    baseGlobal: GlobalStyleRules,
    currentSections: Record<PatentSection, SectionStyleRules>,
    totalTokens: number
  ): { global: GlobalStyleRules; sections: Record<PatentSection, SectionStyleRules> } {
    const outGlobal: GlobalStyleRules = { ...baseGlobal };

    // Prefer new schema global_style; fallback to legacy global
    const gs = forensic?.global_style || forensic?.global || {};
    if (gs.tone) outGlobal.tone = String(gs.tone) as any;
    if (gs.hedging_level) outGlobal.hedging_level = String(gs.hedging_level) as any;
    if (gs.verbosity) {
      const map: Record<string, any> = { terse: 'low', low: 'low', medium: 'medium', high: 'high', elaborate: 'high' };
      outGlobal.verbosity = (map[String(gs.verbosity).toLowerCase()] || outGlobal.verbosity) as any;
    }
    if (typeof gs.avg_sentence_length === 'number') {
      outGlobal.sentence_length_stats.mean = gs.avg_sentence_length;
    }
    const pu = gs.punctuation_usage || gs.punctuation || {};
    if (typeof pu.comma_per_sentence === 'number') outGlobal.punctuation_cadence.comma_per_sentence = pu.comma_per_sentence;
    if (typeof pu.semicolon_per_sentence === 'number') outGlobal.punctuation_cadence.semicolon_per_sentence = pu.semicolon_per_sentence;
    if (typeof pu.dash_per_sentence === 'number') outGlobal.punctuation_cadence.dash_per_sentence = pu.dash_per_sentence;
    if (typeof pu.colon_per_sentence === 'number') outGlobal.punctuation_cadence.colon_per_sentence = pu.colon_per_sentence;
    if (gs.connectors_freq && typeof gs.connectors_freq === 'object') {
      const entries = Object.entries(gs.connectors_freq as Record<string, number>)
      outGlobal.preferred_connectors = entries.sort((a,b)=> (b[1] as number)-(a[1] as number)).slice(0,10).map(([k])=>k)
    }
    const fmt = gs.formatting || {};
    if (typeof fmt.lists_used === 'boolean') outGlobal.formatting_habits.numbered_lists = fmt.lists_used;

    // Sections mapping
    const outSections: Record<PatentSection, SectionStyleRules> = { ...currentSections };
    const sec = forensic?.sections || {};
    const mapName: Record<string, PatentSection> = {
      'ABSTRACT': 'ABSTRACT',
      'BACKGROUND_OF_THE_INVENTION': 'BACKGROUND',
      'SUMMARY_OF_THE_INVENTION': 'SUMMARY',
      'BRIEF_DESCRIPTION_OF_THE_DRAWINGS': 'BRIEF_DESCRIPTION',
      'DETAILED_DESCRIPTION_OF_THE_INVENTION': 'DETAILED_DESCRIPTION',
      'CLAIMS': 'CLAIMS'
    };
    for (const [name, data] of Object.entries(sec)) {
      const internal = mapName[name];
      if (!internal) continue;
      const cur = (outSections[internal] as any) || ({} as any);
      const wr = (data as any).word_range;
      if (Array.isArray(wr) && wr.length === 2) cur.word_count_range = [wr[0], wr[1]];
      cur.sentence_count_range = cur.sentence_count_range || [0, 0];
      cur.paragraph_structure = cur.paragraph_structure || 'mixed';
      const micro: Record<string, any> = { ...(cur.micro_rules || {}) };
      if (internal === 'CLAIMS') {
        if ((data as any).opening_style) micro.opening = (data as any).opening_style;
        if ((data as any).numbering_pattern) micro.numbering_pattern = (data as any).numbering_pattern;
        if ((data as any).claim_ordering) micro.claim_ordering = (data as any).claim_ordering;
        if ((data as any).preamble_type) micro.preamble_type = (data as any).preamble_type;
        if (typeof (data as any).use_numerals === 'boolean') micro.use_numerals = (data as any).use_numerals;
        if (Array.isArray((data as any).recurring_phrases)) micro.lexical_rules = (data as any).recurring_phrases;
        if ((data as any).connectors_freq && typeof (data as any).connectors_freq === 'object') {
          micro.connectors_freq = (data as any).connectors_freq
        }
      }
      if (internal === 'BRIEF_DESCRIPTION') {
        if ((data as any).figure_caption_template) micro.figure_caption_template = (data as any).figure_caption_template;
      }
      if (internal === 'DETAILED_DESCRIPTION') {
        if (Array.isArray((data as any).embodiment_phrases)) micro.embodiment_markers = (data as any).embodiment_phrases;
        if ((data as any).boilerplate_location) micro.boilerplate_location = (data as any).boilerplate_location;
        if ((data as any).cross_linking_density) micro.cross_linking_density = (data as any).cross_linking_density;
        if ((data as any).figure_numbering) {
          micro.figure_numbering = (data as any).figure_numbering;
          if ((data as any).figure_numbering.style) micro.reference_numeral_style = (data as any).figure_numbering.style;
        }
      }
      if (internal === 'BACKGROUND' || internal === 'SUMMARY') {
        if (Array.isArray((data as any).structure_outline)) micro.structure_outline = (data as any).structure_outline;
        if ((data as any).prior_art_tone) micro.prior_art_tone = (data as any).prior_art_tone;
      }
      if (internal === 'ABSTRACT') {
        if (Array.isArray((data as any).recurring_phrases)) micro.style_rules = (data as any).recurring_phrases;
      }

      // Store few-shot snippet if available
      if ((data as any).few_shot_snippet && typeof (data as any).few_shot_snippet === 'string') {
        const snippet = (data as any).few_shot_snippet;
        if (snippet && snippet.length > 20 && !snippet.includes('Anonymized')) {
             // Simple check to ensure LLM actually extracted something
             if(!cur.few_shot_examples) cur.few_shot_examples = [];
             cur.few_shot_examples.push(snippet);
        }
      }

      cur.micro_rules = micro;
      outSections[internal] = cur as SectionStyleRules;
    }

    return { global: outGlobal, sections: outSections };
  }

  // Helper methods
  private static splitIntoSentences(text: string): string[] {
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  }

  private static countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  private static median(arr: number[]): number {
    const sorted = arr.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private static standardDeviation(arr: number[]): number {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  private static analyzeTone(text: string): 'formal' | 'technical' | 'concise' | 'detailed' | 'neutral' {
    // Simplified tone analysis based on keywords and structure
    const formalWords = ['hereby', 'whereas', 'accordingly', 'therefore'];
    const technicalWords = ['algorithm', 'methodology', 'implementation', 'system'];
    const conciseIndicators = text.length < 1000 && this.splitIntoSentences(text).length < 20;

    const formalCount = formalWords.filter(w => text.toLowerCase().includes(w)).length;
    const technicalCount = technicalWords.filter(w => text.toLowerCase().includes(w)).length;

    if (formalCount > 2) return 'formal';
    if (technicalCount > 3) return 'technical';
    if (conciseIndicators) return 'concise';
    if (text.length > 3000) return 'detailed';
    return 'neutral';
  }

  private static analyzePassiveVoice(sentences: string[]): number {
    // Simple passive voice detection
    const passiveIndicators = ['is', 'are', 'was', 'were', 'been', 'being'];
    const passiveVerbs = ['used', 'implemented', 'provided', 'described', 'shown'];

    let passiveCount = 0;
    for (const sentence of sentences) {
      const words = sentence.toLowerCase().split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        if (passiveIndicators.includes(words[i]) && passiveVerbs.includes(words[i + 1])) {
          passiveCount++;
          break;
        }
      }
    }

    return passiveCount / sentences.length;
  }

  private static analyzeModality(sentences: string[]): { indicative_ratio: number; imperative_ratio: number; subjunctive_ratio: number } {
    let indicative = 0, imperative = 0, subjunctive = 0;

    for (const sentence of sentences) {
      const firstWord = sentence.trim().split(/\s+/)[0]?.toLowerCase();
      if (['the', 'a', 'an', 'this', 'that'].includes(firstWord)) {
        indicative++;
      } else if (firstWord?.endsWith('s') === false && !sentence.includes('?')) {
        imperative++;
      } else if (sentence.includes('would') || sentence.includes('should') || sentence.includes('could')) {
        subjunctive++;
      } else {
        indicative++;
      }
    }

    const total = sentences.length;
    return {
      indicative_ratio: indicative / total,
      imperative_ratio: imperative / total,
      subjunctive_ratio: subjunctive / total
    };
  }

  private static analyzeConnectors(sentences: string[]): { preferred: string[]; avoid: string[] } {
    const preferred = ['furthermore', 'additionally', 'moreover', 'accordingly', 'therefore', 'consequently'];
    const avoid = ['so', 'like', 'basically', 'actually', 'you know', 'sort of'];

    const foundPreferred: string[] = [];
    const foundAvoid: string[] = [];

    const text = sentences.join(' ').toLowerCase();
    for (const connector of preferred) {
      if (text.includes(connector)) foundPreferred.push(connector);
    }
    for (const connector of avoid) {
      if (text.includes(connector)) foundAvoid.push(connector);
    }

    return {
      preferred: foundPreferred,
      avoid: foundAvoid
    };
  }

  private static analyzePunctuation(text: string): { comma_per_sentence: number; semicolon_per_sentence: number; colon_per_sentence: number; dash_per_sentence: number } {
    const sentences = this.splitIntoSentences(text);
    const totalSentences = sentences.length;

    let commas = 0, semicolons = 0, colons = 0, dashes = 0;

    for (const sentence of sentences) {
      commas += (sentence.match(/,/g) || []).length;
      semicolons += (sentence.match(/;/g) || []).length;
      colons += (sentence.match(/:/g) || []).length;
      dashes += (sentence.match(/—|–|-/g) || []).length;
    }

    return {
      comma_per_sentence: commas / totalSentences,
      semicolon_per_sentence: semicolons / totalSentences,
      colon_per_sentence: colons / totalSentences,
      dash_per_sentence: dashes / totalSentences
    };
  }

  private static extractTerminology(text: string): { preferred: string[]; taboo: string[] } {
    // To avoid leaking domain-specific terminology across patents,
    // we do not learn or store preferred/taboo terms.
    return { preferred: [], taboo: [] };
  }

  private static analyzeFormatting(text: string): { bullet_points: boolean; numbered_lists: boolean; section_headers: boolean; emphasis_markers: string[] } {
    return {
      bullet_points: text.includes('•') || text.includes('- ') || text.includes('* '),
      numbered_lists: /\d+\.\s/.test(text),
      section_headers: /^[A-Z\s]+:$/m.test(text),
      emphasis_markers: []
    };
  }

  private static analyzeParagraphStructure(content: string): 'single' | 'multi' | 'mixed' {
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    if (paragraphs.length === 1) return 'single';
    if (paragraphs.length > 3) return 'multi';
    return 'mixed';
  }

  private static extractSectionMicroRules(section: PatentSection, content: string): Record<string, any> {
    const rules: Record<string, any> = {};

    switch (section) {
      case 'ABSTRACT':
        rules.word_cap = 150;
        rules.avoid_citations = !content.includes('et al') && !content.includes('ref');
        break;
      case 'CLAIMS':
        const claimStarts = content.match(/^(\d+\.\s*)/gm) || [];
        rules.opening_phrases = claimStarts.slice(0, 3);
        rules.numeral_policy = /\d+\./.test(content) ? 'arabic' : 'roman';
        break;
      // Add more section-specific rules as needed
    }

    return rules;
  }

  static estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Extract images from documents for multimodal LLM processing
   */
  static async extractImages(file: File | Buffer, filename?: string): Promise<ImageContent[]> {
    const fileExtension = filename ?
      filename.split('.').pop()?.toLowerCase() :
      file instanceof File ? file.name.split('.').pop()?.toLowerCase() :
      'unknown';

    switch (fileExtension) {
      case 'docx':
        return await this.extractImagesFromDocx(file);
      case 'pdf':
        return await this.extractImagesFromPdf(file);
      default:
        return []; // No images in TXT/MD files
    }
  }

  private static async extractImagesFromDocx(file: File | Buffer): Promise<ImageContent[]> {
    // For DOCX, we would need to use a library like mammoth with image extraction
    // or unzip the DOCX and extract media files
    // This is complex and might not be worth the effort for style learning
    // DOCX images are usually diagrams/illustrations, not core to writing style
    console.log('DOCX image extraction not implemented - images in DOCX are typically diagrams');
    return [];
  }

  private static async extractImagesFromPdf(file: File | Buffer): Promise<ImageContent[]> {
    // TODO: Implement PDF image extraction
    // For now, return empty array as PDF image extraction is complex
    // and requires proper file system access and image processing libraries
    console.log('PDF image extraction not yet implemented - requires file system access');
    return [];
  }

  private static calculateEntropy(text: string): number {
    // Simplified entropy calculation based on word diversity
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const uniqueWords = new Set(words);
    return uniqueWords.size / words.length;
  }

  private static calculateCoverage(sections: Record<PatentSection, string>): number {
    // Coverage based on how many sections have content
    const filledSections = Object.values(sections).filter(s => s.trim().length > 50);
    return filledSections.length / Object.keys(sections).length;
  }

  /**
   * Merge multiple StyleProfile JSONs into a single normalized profile
   * - Numeric fields: token-weighted mean
   * - Categorical: mode (tie-break by higher coverage)
   * - Booleans: majority vote
   * - Lists: union + frequency, keep top-N
   * - Sections: ranges as min of mins and max of maxes; micro_rules from most representative profile
   */
  static async mergeProfiles(profiles: StyleProfile[], tenantContext?: { tenantId: string; userId: string; planId: string }): Promise<StyleProfile> {
    if (!profiles || profiles.length === 0) {
      throw new Error('No profiles to merge')
    }

    const weights = profiles.map(p => Math.max(1, p.metadata.total_tokens || 1))
    const sumW = weights.reduce((a, b) => a + b, 0)
    const wAvg = (vals: number[]) => vals.reduce((acc, v, i) => acc + v * weights[i], 0) / sumW

    const mode = <T extends string>(vals: T[], tieBreaker?: (aIdx: number, bIdx: number) => number): T => {
      const cnt = new Map<T, number>()
      vals.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1))
      let best: T = vals[0]
      let bestCount = 0
      cnt.forEach((c, key) => {
        if (c > bestCount) { best = key; bestCount = c }
        else if (c === bestCount && tieBreaker) {
          const aIdx = vals.findIndex(v => v === best)
          const bIdx = vals.findIndex(v => v === key)
          if (tieBreaker(aIdx, bIdx) > 0) best = key
        }
      })
      return best
    }

    const unionTopN = (arrays: string[][], n: number): string[] => {
      const freq = new Map<string, number>()
      arrays.forEach(arr => (arr || []).forEach(s => {
        const key = String(s).toLowerCase()
        freq.set(key, (freq.get(key) || 0) + 1)
      }))
      return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
    }

    // Global aggregation
    const passive_ratio = wAvg(profiles.map(p => p.global.passive_ratio || 0))
    const meanLen = wAvg(profiles.map(p => p.global.sentence_length_stats.mean))
    const stdDev = wAvg(profiles.map(p => p.global.sentence_length_stats.std_dev))
    const minLen = Math.min(...profiles.map(p => p.global.sentence_length_stats.min))
    const maxLen = Math.max(...profiles.map(p => p.global.sentence_length_stats.max))

    const comma = wAvg(profiles.map(p => p.global.punctuation_cadence.comma_per_sentence))
    const semi = wAvg(profiles.map(p => p.global.punctuation_cadence.semicolon_per_sentence))
    const colon = wAvg(profiles.map(p => p.global.punctuation_cadence.colon_per_sentence))
    const dash = wAvg(profiles.map(p => p.global.punctuation_cadence.dash_per_sentence))

    const imperative = wAvg(profiles.map(p => p.global.modality.imperative_ratio))
    const indicative = wAvg(profiles.map(p => p.global.modality.indicative_ratio))
    const subjunctive = wAvg(profiles.map(p => p.global.modality.subjunctive_ratio))

    const verbosity = mode(profiles.map(p => p.global.verbosity as any))
    const tone = mode(profiles.map(p => p.global.tone as any))

    const bullets = profiles.filter(p => !!p.global.formatting_habits.bullet_points).length >= Math.ceil(profiles.length/2)
    const numbered = profiles.filter(p => !!p.global.formatting_habits.numbered_lists).length >= Math.ceil(profiles.length/2)
    const headers = profiles.filter(p => !!p.global.formatting_habits.section_headers).length >= Math.ceil(profiles.length/2)

    // Lists are kept empty due to generic-only policy, but preserve union if present and generic
    const preferred = unionTopN(profiles.map(p => p.global.terminology.preferred || []), 0)
    const taboo = unionTopN(profiles.map(p => p.global.terminology.taboo || []), 0)

    // Sections aggregation
    const sectionNames = Array.from(new Set(profiles.flatMap(p => Object.keys(p.sections || {})))) as PatentSection[]
    const sections: Record<PatentSection, SectionStyleRules> = {} as any
    sectionNames.forEach((sec) => {
      const prs = profiles.filter(p => p.sections && (p.sections as any)[sec]).map(p => (p.sections as any)[sec])
      if (prs.length === 0) return
      const wcMins = prs.map((s: any) => s.word_count_range?.[0] ?? 0)
      const wcMaxs = prs.map((s: any) => s.word_count_range?.[1] ?? 0)
      const scMins = prs.map((s: any) => s.sentence_count_range?.[0] ?? 0)
      const scMaxs = prs.map((s: any) => s.sentence_count_range?.[1] ?? 0)
      const paragraph_structure = mode(prs.map((s: any) => s.paragraph_structure || 'mixed'))

      // For micro_rules, provisionally empty; will be filled by synthesis or single-doc copy later
      const micro_rules = {}

      sections[sec] = {
        word_count_range: [Math.min(...wcMins), Math.max(...wcMaxs)],
        sentence_count_range: [Math.min(...scMins), Math.max(...scMaxs)],
        paragraph_structure, 
        micro_rules
      }
    })

    const total_tokens = profiles.reduce((a, p) => a + (p.metadata.total_tokens || 0), 0)
    const entropy = wAvg(profiles.map(p => p.metadata.entropy_score || 0))
    const coverage = wAvg(profiles.map(p => p.metadata.coverage_score || 0))
    const jurisdiction_hints = Array.from(new Set(profiles.flatMap(p => p.metadata.jurisdiction_hints || [])))
    const multimodal = profiles.some(p => !!p.metadata.multimodal_analysis)

    let merged: StyleProfile = {
      global: {
        tone: tone as any,
        verbosity: verbosity as any,
        sentence_length_stats: { mean: meanLen, median: 0, std_dev: stdDev, min: minLen, max: maxLen },
        passive_ratio: passive_ratio,
        modality: { indicative_ratio: indicative, imperative_ratio: imperative, subjunctive_ratio: subjunctive },
        preferred_connectors: [],
        avoid_connectors: [],
        punctuation_cadence: {
          comma_per_sentence: comma,
          semicolon_per_sentence: semi,
          colon_per_sentence: colon,
          dash_per_sentence: dash
        },
        terminology: { preferred, taboo },
        formatting_habits: {
          bullet_points: bullets,
          numbered_lists: numbered,
          section_headers: headers,
          emphasis_markers: []
        }
      },
      sections,
      safety_constraints: {
        preserve_meaning: true,
        jurisdiction_overrides: {},
        content_restrictions: {
          avoid_legal_opinions: true,
          maintain_technical_accuracy: true,
          preserve_claim_scope: true
        }
      },
      metadata: {
        training_samples: profiles.reduce((a, p) => a + (p.metadata.training_samples || 1), 0),
        total_tokens,
        entropy_score: entropy,
        coverage_score: coverage,
        created_at: new Date().toISOString(),
        version: 'merged-1.0',
        jurisdiction_hints,
        multimodal_analysis: multimodal
      }
    }

    // Micro-rules synthesis logic:
    // - If only one profile, copy its micro_rules directly (no synthesis)
    // - If 2 or more profiles, synthesize consensus micro_rules via LLM
    if (profiles.length === 1) {
      const only = profiles[0]
      Object.keys(merged.sections).forEach((sec) => {
        const mr = ((only.sections as any)[sec]?.micro_rules) || {}
        ;(merged.sections as any)[sec].micro_rules = mr
      })
    } else if (profiles.length >= 2) {
      try {
        const consensus = await (this as any).synthesizeConsensus(profiles, tenantContext)
        if (consensus && typeof consensus === 'object') {
          Object.keys(consensus).forEach((sec) => {
            if ((merged.sections as any)[sec]) {
              (merged.sections as any)[sec].micro_rules = {
                ...(merged.sections as any)[sec].micro_rules,
                ...(consensus as any)[sec]
              }
            }
          })
        }
      } catch (e) {
        console.warn('Consensus synthesis failed; continuing with numeric merge only:', e)
      }
    }

    // Enforce generic-only constraints after merge
    const sanitized = this.sanitizeStyle(merged.global, merged.sections)
    merged = { ...merged, global: sanitized.global, sections: sanitized.sections }
    return merged
  }

  // Build candidate bags from per-doc profiles and ask LLM to produce consensus micro_rules
  private static async synthesizeConsensus(profiles: StyleProfile[], tenantContext?: { tenantId: string; userId: string; planId: string }): Promise<Record<PatentSection, any>> {
    const bySection: Record<string, any> = {}
    const inc = (map: Map<string, number>, key: string) => {
      const k = key.toLowerCase().trim()
      if (!k) return
      map.set(k, (map.get(k) || 0) + 1)
    }
    const sections = Array.from(new Set(profiles.flatMap(p => Object.keys(p.sections))))
    for (const sec of sections) {
      const claimsLex = new Map<string, number>()
      const absRules = new Map<string, number>()
      const ddEmb = new Map<string, number>()
      const bgOutline = new Map<string, number>()
      const sumOutline = new Map<string, number>()
      const bdFig = new Map<string, number>()
      let openingStyle: string | undefined
      let figTemplate: string | undefined
      const numPatterns: any[] = []

      for (const p of profiles) {
        const s = (p.sections as any)[sec]
        if (!s) continue
        const mr = s.micro_rules || {}
        if (sec === 'CLAIMS') {
          if (Array.isArray(mr.lexical_rules)) mr.lexical_rules.forEach((x: string) => inc(claimsLex, x))
          if (typeof mr.opening === 'string' && !openingStyle) openingStyle = mr.opening
          if (mr.numbering_pattern) numPatterns.push(mr.numbering_pattern)
        } else if (sec === 'ABSTRACT') {
          if (Array.isArray(mr.style_rules)) mr.style_rules.forEach((x: string) => inc(absRules, x))
        } else if (sec === 'DETAILED_DESCRIPTION') {
          if (Array.isArray(mr.embodiment_markers)) mr.embodiment_markers.forEach((x: string) => inc(ddEmb, x))
        } else if (sec === 'BACKGROUND') {
          if (Array.isArray(mr.structure_outline)) mr.structure_outline.forEach((x: string) => inc(bgOutline, x))
        } else if (sec === 'SUMMARY') {
          if (Array.isArray(mr.structure_outline)) mr.structure_outline.forEach((x: string) => inc(sumOutline, x))
        } else if (sec === 'BRIEF_DESCRIPTION') {
          if (typeof mr.figure_caption_template === 'string' && mr.figure_caption_template && !figTemplate) figTemplate = mr.figure_caption_template
        }
      }

      bySection[sec] = {
        claims_lexical_candidates: Object.fromEntries(claimsLex.entries()),
        abstract_rule_candidates: Object.fromEntries(absRules.entries()),
        dd_embodiment_candidates: Object.fromEntries(ddEmb.entries()),
        background_outline_candidates: Object.fromEntries(bgOutline.entries()),
        summary_outline_candidates: Object.fromEntries(sumOutline.entries()),
        opening_style_hint: openingStyle,
        figure_caption_template_hint: figTemplate,
        numbering_pattern_samples: numPatterns
      }
    }

    const { LLMGateway } = await import('@/lib/metering/gateway')
    const gateway = new LLMGateway()
    const synthesisPrompt = `You are consolidating patent style rules across multiple drafts.
Input is a JSON object of candidate phrases and hints per section. Return a single JSON with per-section micro_rules using ONLY generic patent phrases.

Rules:
- Use at most 10 phrases per list. Lowercase, deduplicate, normalize variants.
- Allowed phrase whitelist examples: "configured to", "wherein", "comprising", "at least one", "plurality of", "adapted to", "in one embodiment", "in some embodiments", "according to", "characterized in that".
- CLAIMS: output { lexical_rules: [], opening: enum(system|method|device|computer-readable-medium|two-part-epo|other), numbering_pattern: { start, end, average_gap, dependencies_style } }.
- ABSTRACT: output { style_rules: [] }.
- BACKGROUND/SUMMARY: output { structure_outline: [] }.
- BRIEF_DESCRIPTION: output { figure_caption_template: string }.
- DETAILED_DESCRIPTION: output { embodiment_markers: [], reference_numeral_style?: "(100)|100|C100", figure_numbering?: { style, series_hint, start, end, average_gap } }.
- Omit fields with no support; do not invent.
Output JSON only.`

    const content = {
      parts: [
        { type: 'text' as const, text: synthesisPrompt },
        { type: 'text' as const, text: JSON.stringify(bySection) }
      ]
    }
    const result = await gateway.executeLLMOperation(
      tenantContext ? { tenantContext } : { headers: {} },
      {
      taskCode: 'PERSONA_SYNC_LEARN',
      content,
      modelClass: 'gemini-2.5-pro',
      inputTokens: Math.ceil(JSON.stringify(bySection).length / 4)
    })
    if (!result.success || !result.response) throw new Error('Consensus LLM call failed')
    const raw = result.response.output || '{}'
    const jsonText = this.extractFirstJsonBlock(raw) || raw
    const consensus = JSON.parse(jsonText)
    // Ensure we only return section→micro_rules map
    const output: Record<PatentSection, any> = {} as any
    Object.keys(consensus || {}).forEach((sec) => {
      if (sections.includes(sec)) output[sec as PatentSection] = consensus[sec]
    })
    return output
  }

  // === Sanitization helpers to enforce generic-only style ===
  private static sanitizeStyle(
    global: GlobalStyleRules,
    sections: Record<PatentSection, SectionStyleRules>
  ): { global: GlobalStyleRules; sections: Record<PatentSection, SectionStyleRules> } {
    // 1) Never keep domain-specific terminology lists
    global.terminology.preferred = []
    global.terminology.taboo = []

    // 2) Whitelist connectors to generic discourse markers
    const allowedConnectors = new Set([
      'furthermore','additionally','moreover','accordingly','therefore','consequently','however','thus','hence','whereas','thereby'
    ])
    global.preferred_connectors = (global.preferred_connectors || []).filter(c => allowedConnectors.has(String(c).toLowerCase()))
    global.avoid_connectors = (global.avoid_connectors || []).filter(c => allowedConnectors.has(String(c).toLowerCase()))

    // 3) Sanitize section micro-rules to generic-only
    const whitelistLexical = [
      'configured to','wherein','comprising','comprises','comprised of','plurality of','at least one','adapted to',
      'according to one embodiment','in one embodiment','in an embodiment','in some embodiments','characterized in that',
      'a system comprising','a method comprising','a device comprising','including','includes'
    ]
    const isGenericLexical = (phrase: string) => {
      const p = String(phrase || '').toLowerCase().trim()
      return whitelistLexical.some(w => p.includes(w))
    }
    const isGenericOpening = (s: string) => /^(a\s+(system|method|device|apparatus|computer-?readable\s+medium)(.|\s)*?(comprising|configured\s+to|including|includes|comprises))/i.test(s || '')
    const isGenericFigureTemplate = (s: string) => /fig\.?/i.test(s || '')

    const sanitizeMicro = (micro?: Record<string, any>): Record<string, any> => {
      if (!micro) return {}
      const out: Record<string, any> = {}
      for (const [k, v] of Object.entries(micro)) {
        if (k === 'lexical_rules' && Array.isArray(v)) {
          const filtered = v.filter(isGenericLexical)
          if (filtered.length) out[k] = filtered
        } else if (k === 'embodiment_markers' && Array.isArray(v)) {
          const embWhitelist = [/^in (one|some|an) embodiment(s)?/i, /^according to (one|some) embodiment(s)?/i]
          const filtered = v.filter((m: any) => embWhitelist.some(r => r.test(String(m))))
          if (filtered.length) out[k] = filtered
        } else if (k === 'opening' && typeof v === 'string') {
          if (isGenericOpening(v)) out[k] = v
        } else if (k === 'figure_caption_template' && typeof v === 'string') {
          if (isGenericFigureTemplate(v)) out[k] = v
        } else if (k === 'claim_style' && typeof v === 'string') {
          const allowedStyles = new Set(['US_single_dependency','EPO_two_part','mixed','unknown'])
          if (allowedStyles.has(v)) out[k] = v
        } else if (k === 'reference_numeral_style' && typeof v === 'string') {
          // Keep common numeral styles only
          const allowedNumerals = [/^\(\d+\)$/, /^[A-Z]?\d{2,}$/]
          if (allowedNumerals.some(r => r.test(v))) out[k] = v
        } else {
          // Pass through numeric/statistical/generic keys
          out[k] = v
        }
      }
      return out
    }

    const sanitizedSections: Record<PatentSection, SectionStyleRules> = { ...sections }
    for (const key of Object.keys(sanitizedSections) as PatentSection[]) {
      const sec = sanitizedSections[key]
      if (sec && typeof sec === 'object') {
        sec.micro_rules = sanitizeMicro(sec.micro_rules || {})
      }
    }

    return { global, sections: sanitizedSections }
  }
}
