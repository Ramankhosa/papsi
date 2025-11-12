// === PERSONA SYNC TYPES ===

// Style Profile JSON Schema (canonical schema from SRS)
export interface StyleProfile {
  global: GlobalStyleRules;
  sections: Record<PatentSection, SectionStyleRules>;
  safety_constraints: SafetyConstraints;
  metadata: StyleProfileMetadata;
}

export interface GlobalStyleRules {
  tone: 'formal' | 'technical' | 'concise' | 'detailed' | 'neutral';
  verbosity: 'low' | 'medium' | 'high';
  sentence_length_stats: {
    mean: number;
    median: number;
    std_dev: number;
    min: number;
    max: number;
  };
  passive_ratio: number; // 0.0 to 1.0
  modality: {
    indicative_ratio: number;
    imperative_ratio: number;
    subjunctive_ratio: number;
  };
  preferred_connectors: string[]; // e.g., ["furthermore", "additionally", "however"]
  avoid_connectors: string[]; // e.g., ["so", "like", "basically"]
  punctuation_cadence: {
    comma_per_sentence: number;
    semicolon_per_sentence: number;
    colon_per_sentence: number;
    dash_per_sentence: number;
  };
  terminology: {
    preferred: string[]; // Domain-specific terms to use
    taboo: string[]; // Terms to avoid
  };
  formatting_habits: {
    bullet_points: boolean;
    numbered_lists: boolean;
    section_headers: boolean;
    emphasis_markers: string[]; // e.g., ["bold", "italic", "underline"]
    visual_style?: 'clean' | 'technical' | 'detailed' | 'minimal'; // From multimodal analysis
  };
}

export type PatentSection =
  | 'ABSTRACT'
  | 'CLAIMS'
  | 'BACKGROUND'
  | 'SUMMARY'
  | 'BRIEF_DESCRIPTION'
  | 'DETAILED_DESCRIPTION';

export interface SectionStyleRules {
  word_count_range: [number, number]; // [min, max] words
  sentence_count_range: [number, number]; // [min, max] sentences
  paragraph_structure: 'single' | 'multi' | 'mixed';
  micro_rules: Record<string, any>; // Section-specific rules
  // Examples of micro-rules by section:
  // ABSTRACT: { word_cap: 150, avoid_citations: true }
  // CLAIMS: { opening_phrases: ["A system comprising", "A method for"], numeral_policy: "arabic" }
  // BACKGROUND: { problem_solution_format: true }
}

// Safety constraints to preserve meaning and compliance
export interface SafetyConstraints {
  preserve_meaning: boolean; // Always true - never change technical meaning
  jurisdiction_overrides: Record<string, any>; // USPTO/EPO specific overrides
  content_restrictions: {
    avoid_legal_opinions: boolean;
    maintain_technical_accuracy: boolean;
    preserve_claim_scope: boolean;
  };
}

export interface StyleProfileMetadata {
  training_samples: number; // Number of samples used
  total_tokens: number; // Total tokens processed
  entropy_score: number; // Style consistency measure
  coverage_score: number; // How well the profile covers the author's style
  created_at: string;
  version: string;
  jurisdiction_hints?: string[]; // ['USPTO', 'EPO', 'PCT']
  multimodal_analysis?: boolean; // Whether images were included in analysis
}

// API Request/Response Types
export interface StyleLearningRequest {
  userId: string;
  sampleDocuments: File[];
  jurisdictionHints?: string[];
}

export interface StyleLearningResponse {
  jobId: string;
  status: 'accepted' | 'rejected';
  message: string;
  estimatedDuration?: number; // in seconds
}

export interface StyleProfileResponse {
  profile: StyleProfile | null;
  status: 'not_learned' | 'learning' | 'learned' | 'needs_more_data' | 'failed';
  lastUpdated: string;
  version: number;
  locked: boolean;
  lockedBy?: string;
  lockedAt?: string;
}

export interface StyleTrainingJobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  metrics?: {
    totalTokens: number;
    entropy: number;
    coverage: number;
    topNgrams: string[];
  };
  error?: string;
  completedAt?: string;
}

// Database Model Types (generated from Prisma)
export type StyleProfileDB = {
  id: string;
  tenantId: string;
  userId: string;
  version: number;
  json: StyleProfile;
  status: 'NOT_LEARNED' | 'LEARNING' | 'LEARNED' | 'NEEDS_MORE_DATA' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lockedAt?: Date;
  lockedBy?: string;
};

export type StyleTrainingJobDB = {
  id: string;
  tenantId: string;
  userId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  inputsMetadata?: any;
  metrics?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentDB = {
  id: string;
  tenantId: string;
  userId: string;
  type: 'SAMPLE' | 'REFERENCE';
  filename: string;
  contentPtr?: string;
  tokens: number;
  hash: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: Date;
};
