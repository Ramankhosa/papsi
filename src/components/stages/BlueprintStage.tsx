'use client';

/**
 * BlueprintStage - Interactive Paper Blueprint Editor
 * 
 * A mind-map style interface for viewing and editing the paper blueprint.
 * Users can:
 * - Generate blueprint from research topic
 * - Edit thesis statement and central objective
 * - Add/edit/delete dimensions in each section
 * - Freeze blueprint when ready for section generation
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Target,
  Lightbulb,
  AlertCircle,
  Loader2,
  BookOpen,
  Layers,
  GitBranch,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

// ============================================================================
// Types
// ============================================================================

interface DimensionType {
  dimension: string;
  type?: 'foundational' | 'methodological' | 'empirical' | 'comparative' | 'gap';
}

interface SectionPlanItem {
  sectionKey: string;
  purpose: string;
  mustCover: string[];
  mustCoverTyping?: Record<string, string>;
  mustAvoid: string[];
  wordBudget?: number;
  dependencies: string[];
  outputsPromised: string[];
  suggestedCitationCount?: number;
}

interface Blueprint {
  id: string;
  sessionId: string;
  thesisStatement: string;
  centralObjective: string;
  keyContributions: string[];
  sectionPlan: SectionPlanItem[];
  preferredTerms: Record<string, string> | null;
  narrativeArc?: string;
  status: 'DRAFT' | 'FROZEN' | 'REVISION_PENDING';
  version: number;
}

interface BlueprintStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  onNavigateToStage?: (stage: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DIMENSION_TYPES = [
  { value: 'foundational', label: 'Foundational', color: 'bg-purple-500', description: 'Seminal/historical concepts' },
  { value: 'methodological', label: 'Methodological', color: 'bg-blue-500', description: 'Techniques & approaches' },
  { value: 'empirical', label: 'Empirical', color: 'bg-green-500', description: 'Evidence & data' },
  { value: 'comparative', label: 'Comparative', color: 'bg-orange-500', description: 'Alternatives & baselines' },
  { value: 'gap', label: 'Gap', color: 'bg-red-500', description: 'Limitations & gaps' }
];

const SECTION_ICONS: Record<string, any> = {
  introduction: Lightbulb,
  literature_review: BookOpen,
  methodology: Layers,
  results: Target,
  discussion: GitBranch,
  conclusion: Zap,
  default: BookOpen
};

// ============================================================================
// Sub-Components
// ============================================================================

interface DimensionCardProps {
  dimension: string;
  type?: string;
  sectionKey: string;
  isEditing: boolean;
  isFrozen: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSave: (newDimension: string, newType: string) => void;
  onCancel: () => void;
}

function DimensionCard({
  dimension,
  type = 'empirical',
  isEditing,
  isFrozen,
  onEdit,
  onDelete,
  onSave,
  onCancel
}: DimensionCardProps) {
  const [editValue, setEditValue] = useState(dimension);
  const [editType, setEditType] = useState(type);

  const typeConfig = DIMENSION_TYPES.find(t => t.value === type) || DIMENSION_TYPES[2];

  if (isEditing) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-2 border-blue-300 dark:border-blue-600 shadow-lg"
      >
        <Textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="Enter a citation-mappable dimension..."
          className="text-sm mb-2 min-h-[60px] resize-none bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
          autoFocus
        />
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DIMENSION_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setEditType(t.value)}
              className={`
                px-2 py-1 rounded-full text-xs font-medium transition-all
                ${editType === t.value
                  ? `${t.color} text-white shadow-md scale-105`
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:scale-105'
                }
              `}
              title={t.description}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-slate-500"
          >
            <X className="w-4 h-4 mr-1" /> Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onSave(editValue.trim(), editType)}
            disabled={!editValue.trim() || editValue.trim().length < 10}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Check className="w-4 h-4 mr-1" /> Save
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      whileHover={{ scale: isFrozen ? 1 : 1.02 }}
      className={`
        group relative p-3 rounded-xl
        bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900
        border border-slate-200 dark:border-slate-700
        shadow-sm hover:shadow-md transition-all duration-200
        ${!isFrozen ? 'cursor-pointer' : ''}
      `}
      onClick={() => !isFrozen && onEdit()}
    >
      {/* Type indicator dot */}
      <div className={`absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${typeConfig.color} shadow-lg`} />
      
      {/* Dimension text */}
      <p className="text-sm text-slate-700 dark:text-slate-200 pr-16 leading-relaxed">
        {dimension}
      </p>
      
      {/* Type badge */}
      <Badge
        variant="outline"
        className={`absolute top-2 right-2 text-[10px] px-1.5 py-0 ${typeConfig.color} bg-opacity-10 border-0 text-white`}
      >
        {typeConfig.label}
      </Badge>
      
      {/* Action buttons (visible on hover, hidden when frozen) */}
      {!isFrozen && (
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded-md bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

interface SectionNodeProps {
  section: SectionPlanItem;
  isFrozen: boolean;
  onUpdateSection: (updated: SectionPlanItem) => void;
}

function SectionNode({ section, isFrozen, onUpdateSection }: SectionNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingDimensionIndex, setEditingDimensionIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const Icon = SECTION_ICONS[section.sectionKey] || SECTION_ICONS.default;
  const dimensionCount = section.mustCover.length;

  const handleSaveDimension = (index: number, newDimension: string, newType: string) => {
    const updated = { ...section };
    updated.mustCover = [...section.mustCover];
    updated.mustCover[index] = newDimension;
    updated.mustCoverTyping = { ...section.mustCoverTyping, [newDimension]: newType };
    
    // Remove old key if dimension text changed
    if (section.mustCover[index] !== newDimension && section.mustCoverTyping?.[section.mustCover[index]]) {
      delete updated.mustCoverTyping[section.mustCover[index]];
    }
    
    onUpdateSection(updated);
    setEditingDimensionIndex(null);
  };

  const handleDeleteDimension = (index: number) => {
    const updated = { ...section };
    const removedDimension = section.mustCover[index];
    updated.mustCover = section.mustCover.filter((_, i) => i !== index);
    
    if (section.mustCoverTyping?.[removedDimension]) {
      updated.mustCoverTyping = { ...section.mustCoverTyping };
      delete updated.mustCoverTyping[removedDimension];
    }
    
    onUpdateSection(updated);
  };

  const handleAddDimension = (newDimension: string, newType: string) => {
    const updated = { ...section };
    updated.mustCover = [...section.mustCover, newDimension];
    updated.mustCoverTyping = { ...section.mustCoverTyping, [newDimension]: newType };
    onUpdateSection(updated);
    setIsAddingNew(false);
  };

  const formatSectionName = (key: string) => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative"
    >
      {/* Connector line from center */}
      <div className="absolute -left-8 top-8 w-8 h-0.5 bg-gradient-to-r from-blue-300 to-transparent dark:from-blue-600" />
      
      <Card className="overflow-hidden border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        {/* Section Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-semibold text-slate-900 dark:text-white">
              {formatSectionName(section.sectionKey)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
              {section.purpose}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {dimensionCount} dimensions
            </Badge>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-5 h-5 text-slate-400" />
            </motion.div>
          </div>
        </button>

        {/* Dimensions List */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <CardContent className="pt-0 pb-4 px-4">
                <div className="space-y-2 ml-2 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                  {section.mustCover.map((dim, idx) => (
                    <DimensionCard
                      key={`${section.sectionKey}-${idx}`}
                      dimension={dim}
                      type={section.mustCoverTyping?.[dim]}
                      sectionKey={section.sectionKey}
                      isEditing={editingDimensionIndex === idx}
                      isFrozen={isFrozen}
                      onEdit={() => setEditingDimensionIndex(idx)}
                      onDelete={() => handleDeleteDimension(idx)}
                      onSave={(newDim, newType) => handleSaveDimension(idx, newDim, newType)}
                      onCancel={() => setEditingDimensionIndex(null)}
                    />
                  ))}

                  {/* Add New Dimension */}
                  {isAddingNew ? (
                    <DimensionCard
                      dimension=""
                      type="empirical"
                      sectionKey={section.sectionKey}
                      isEditing={true}
                      isFrozen={false}
                      onEdit={() => {}}
                      onDelete={() => setIsAddingNew(false)}
                      onSave={handleAddDimension}
                      onCancel={() => setIsAddingNew(false)}
                    />
                  ) : !isFrozen && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setIsAddingNew(true)}
                      className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 
                        text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 
                        dark:hover:border-blue-500 dark:hover:text-blue-400
                        flex items-center justify-center gap-2 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">Add Dimension</span>
                    </motion.button>
                  )}
                </div>

                {/* Section metadata */}
                {section.suggestedCitationCount && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs text-slate-400">
                      Suggested citations: ~{section.suggestedCitationCount}
                    </span>
                  </div>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BlueprintStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage
}: BlueprintStageProps) {
  // Debug: Log props on every render - this should appear in browser console
  console.log('[BlueprintStage] RENDER - sessionId:', sessionId, 'authToken:', authToken ? 'present' : 'null');
  
  const { showToast } = useToast();
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Editing states
  const [editingThesis, setEditingThesis] = useState(false);
  const [editingObjective, setEditingObjective] = useState(false);
  const [thesisValue, setThesisValue] = useState('');
  const [objectiveValue, setObjectiveValue] = useState('');

  // Load blueprint
  const loadBlueprint = useCallback(async () => {
    console.log('[BlueprintStage] loadBlueprint called - authToken:', authToken ? 'present' : 'null', 'sessionId:', sessionId);
    
    if (!authToken || !sessionId) {
      // If auth token or session ID is not yet available, stop loading but don't error
      console.log('[BlueprintStage] Missing authToken or sessionId, setting loading=false');
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      console.log('[BlueprintStage] Fetching blueprint from API...');
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      
      const data = await res.json();
      console.log('[BlueprintStage] API response:', { ok: res.ok, hasBlueprint: !!data.blueprint, status: res.status });
      
      if (!res.ok) throw new Error(data.error || 'Failed to load blueprint');
      
      setBlueprint(data.blueprint);
      if (data.blueprint) {
        setThesisValue(data.blueprint.thesisStatement || '');
        setObjectiveValue(data.blueprint.centralObjective || '');
      }
      setError(null);
    } catch (err) {
      console.error('[BlueprintStage] Error loading blueprint:', err);
      setError(err instanceof Error ? err.message : 'Failed to load blueprint');
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    loadBlueprint();
  }, [loadBlueprint]);

  // Generate blueprint
  const handleGenerate = async () => {
    if (!authToken) return;
    
    try {
      setGenerating(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'generate' })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate blueprint');
      
      setBlueprint(data.blueprint);
      setThesisValue(data.blueprint.thesisStatement || '');
      setObjectiveValue(data.blueprint.centralObjective || '');
      showToast({ type: 'success', title: 'Blueprint generated!', message: 'Review and customize your paper structure.' });
    } catch (err) {
      showToast({ 
        type: 'error',
        title: 'Generation failed', 
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setGenerating(false);
    }
  };

  // Save blueprint updates
  const handleSave = async (updates: Partial<Blueprint>) => {
    if (!authToken || !blueprint) return;
    
    try {
      setSaving(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'update', ...updates })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      
      setBlueprint(data.blueprint);
      showToast({ type: 'success', title: 'Saved', message: 'Blueprint updated successfully.' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Freeze/unfreeze blueprint
  const handleToggleFreeze = async () => {
    if (!authToken || !blueprint) return;
    
    const action = blueprint.status === 'FROZEN' ? 'unfreeze' : 'freeze';
    
    try {
      setSaving(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action}`);
      
      setBlueprint(data.blueprint);
      showToast({
        type: 'success',
        title: action === 'freeze' ? 'Blueprint Frozen' : 'Blueprint Unlocked',
        message: action === 'freeze' 
          ? 'Your blueprint is now locked. You can proceed to literature search.'
          : 'Blueprint unlocked for editing. Existing sections marked as stale.'
      });
      
      // Navigate to literature search after freezing
      if (action === 'freeze' && onNavigateToStage) {
        setTimeout(() => onNavigateToStage('LITERATURE_SEARCH'), 1500);
      }
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Update section
  const handleUpdateSection = (sectionKey: string, updated: SectionPlanItem) => {
    if (!blueprint) return;
    
    const newSectionPlan = blueprint.sectionPlan.map(s =>
      s.sectionKey === sectionKey ? updated : s
    );
    
    handleSave({ sectionPlan: newSectionPlan } as any);
  };

  const isFrozen = blueprint?.status === 'FROZEN';

  // Debug: Log current state - this should appear in browser console
  console.log('[BlueprintStage] STATE - loading:', loading, 'blueprint:', blueprint ? 'exists' : 'null', 'error:', error, 'authToken:', authToken ? 'present' : 'null');

  // ============================================================================
  // DEBUG: Visible state panel (temporary for debugging)
  // ============================================================================
  
  const debugInfo = {
    sessionId: sessionId || 'null',
    authToken: authToken ? 'present' : 'null',
    loading,
    blueprint: blueprint ? 'exists' : 'null',
    error: error || 'null'
  };

  // ============================================================================
  // Render: Missing Auth Token - Show waiting message
  // ============================================================================
  
  if (!authToken) {
    console.log('[BlueprintStage] Rendering: No auth token available');
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Waiting for authentication...</p>
          <p className="text-xs text-slate-400 mt-2">If this persists, try refreshing the page or logging in again.</p>
        </div>
        {/* Debug panel */}
        <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-mono">
          <div className="text-slate-500 mb-1">Debug Info:</div>
          <pre className="text-slate-600 dark:text-slate-300">{JSON.stringify(debugInfo, null, 2)}</pre>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Loading State
  // ============================================================================
  
  if (loading) {
    console.log('[BlueprintStage] Rendering: loading state');
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Loading blueprint...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: No Blueprint (Generate CTA)
  // ============================================================================

  if (!blueprint) {
    console.log('[BlueprintStage] Rendering: no-blueprint CTA (Generate Blueprint button)');
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          {/* Hero Icon */}
          <div className="relative mx-auto w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl rotate-6 opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl -rotate-3 opacity-40" />
            <div className="relative bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl w-full h-full flex items-center justify-center shadow-xl">
              <Target className="w-12 h-12 text-white" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
            Create Your Paper Blueprint
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8 max-w-md mx-auto">
            Generate an intelligent blueprint that defines the structure and key dimensions 
            each section must cover. This ensures coherent, well-organized academic writing.
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={generating}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating Blueprint...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Blueprint
              </>
            )}
          </Button>

          <p className="mt-4 text-xs text-slate-400">
            Make sure you've completed the Research Topic stage first
          </p>
        </motion.div>
      </div>
    );
  }

  // ============================================================================
  // Render: Blueprint Editor (Mind Map Style)
  // ============================================================================

  console.log('[BlueprintStage] Rendering blueprint editor - sections:', blueprint.sectionPlan?.length || 0);

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Paper Blueprint</h1>
              <div className="flex items-center gap-2">
                <Badge variant={isFrozen ? 'default' : 'secondary'} className="text-xs">
                  {isFrozen ? (
                    <><Lock className="w-3 h-3 mr-1" /> Frozen</>
                  ) : (
                    <><Unlock className="w-3 h-3 mr-1" /> Draft</>
                  )}
                </Badge>
                <span className="text-xs text-slate-400">v{blueprint.version}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </span>
            )}
            <Button
              variant={isFrozen ? 'outline' : 'default'}
              onClick={handleToggleFreeze}
              disabled={saving}
              className={!isFrozen ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white' : ''}
            >
              {isFrozen ? (
                <><Unlock className="w-4 h-4 mr-2" /> Unlock for Editing</>
              ) : (
                <><Lock className="w-4 h-4 mr-2" /> Freeze & Continue</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Frozen Warning Banner */}
      {isFrozen && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Blueprint is frozen. Unlock to make changes.</span>
          </div>
        </div>
      )}

      {/* Main Content - Mind Map Layout */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Central Node: Thesis & Objective */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative max-w-2xl mx-auto mb-12"
        >
          <Card className="border-0 shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 overflow-hidden">
            {/* Decorative background */}
            <div className="absolute inset-0 opacity-5">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl" />
            </div>

            <CardContent className="relative p-6">
              {/* Thesis Statement */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                    Thesis Statement
                  </span>
                  {!isFrozen && !editingThesis && (
                    <button
                      onClick={() => setEditingThesis(true)}
                      className="ml-auto p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingThesis ? (
                  <div className="space-y-2">
                    <Textarea
                      value={thesisValue}
                      onChange={(e) => setThesisValue(e.target.value)}
                      className="min-h-[80px] resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setThesisValue(blueprint.thesisStatement);
                        setEditingThesis(false);
                      }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => {
                        handleSave({ thesisStatement: thesisValue });
                        setEditingThesis(false);
                      }}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    {blueprint.thesisStatement}
                  </p>
                )}
              </div>

              {/* Central Objective */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                    Central Objective
                  </span>
                  {!isFrozen && !editingObjective && (
                    <button
                      onClick={() => setEditingObjective(true)}
                      className="ml-auto p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-500"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingObjective ? (
                  <div className="space-y-2">
                    <Textarea
                      value={objectiveValue}
                      onChange={(e) => setObjectiveValue(e.target.value)}
                      className="min-h-[60px] resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setObjectiveValue(blueprint.centralObjective);
                        setEditingObjective(false);
                      }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => {
                        handleSave({ centralObjective: objectiveValue });
                        setEditingObjective(false);
                      }}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                    {blueprint.centralObjective}
                  </p>
                )}
              </div>

              {/* Key Contributions */}
              {blueprint.keyContributions && blueprint.keyContributions.length > 0 && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">
                    Key Contributions
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {blueprint.keyContributions.map((contrib, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {contrib.length > 60 ? contrib.slice(0, 60) + '...' : contrib}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Connector to sections */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-8 w-0.5 h-8 bg-gradient-to-b from-blue-300 to-transparent dark:from-blue-600" />
        </motion.div>

        {/* Section Nodes */}
        <div className="grid md:grid-cols-2 gap-6 pl-8">
          {blueprint.sectionPlan.map((section, idx) => (
            <SectionNode
              key={section.sectionKey}
              section={section}
              isFrozen={isFrozen}
              onUpdateSection={(updated) => handleUpdateSection(section.sectionKey, updated)}
            />
          ))}
        </div>

        {/* Dimension Type Legend */}
        <div className="mt-12 flex items-center justify-center gap-6 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">DIMENSION TYPES:</span>
          {DIMENSION_TYPES.map(type => (
            <div key={type.value} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${type.color}`} />
              <span className="text-xs text-slate-500 dark:text-slate-400">{type.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

