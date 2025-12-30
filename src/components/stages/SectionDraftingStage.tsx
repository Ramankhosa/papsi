'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, 
  Save, 
  Loader2, 
  Check, 
  BookOpen,
  Quote,
  Wand2,
  AlertCircle
} from 'lucide-react';
import { SectionEditor, type RichTextEditorRef } from '@/components/ui/rich-text-editor';
import CitationPickerModal from '@/components/paper/CitationPickerModal';
import CitationManager from '@/components/paper/CitationManager';

interface SectionDraftingStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  // Section selection controlled by parent/sidebar
  selectedSection?: string;
  onSectionSelect?: (sectionKey: string) => void;
}

function parseExtraSections(value: any): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, string>;
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function isCitationRequired(sectionKey: string): boolean {
  const noCitationSections = new Set(['abstract', 'conclusion', 'acknowledgments']);
  return !noCitationSections.has(sectionKey.toLowerCase());
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export default function SectionDraftingStage({ 
  sessionId, 
  authToken, 
  onSessionUpdated,
  selectedSection: externalSelectedSection,
  onSectionSelect
}: SectionDraftingStageProps) {
  const [paperTypeCode, setPaperTypeCode] = useState<string>('');
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [requiredSections, setRequiredSections] = useState<string[]>([]);
  const [wordLimits, setWordLimits] = useState<Record<string, number>>({});
  const [sections, setSections] = useState<Record<string, string>>({});
  const [internalSelectedSection, setInternalSelectedSection] = useState<string>('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [citations, setCitations] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showCitations, setShowCitations] = useState(false);

  // Use external selection if provided, otherwise use internal state
  const selectedSection = externalSelectedSection || internalSelectedSection;
  const setSelectedSection = onSectionSelect || setInternalSelectedSection;

  const editorRef = useRef<RichTextEditorRef>(null);
  const storageKey = `paper_section_config_${sessionId}`;

  const refreshSession = async () => {
    if (!onSessionUpdated) return;
    const response = await fetch(`/api/papers/${sessionId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    onSessionUpdated(data.session);
  };

  const applySectionConfig = (typeData: any, code: string) => {
    const defaults = {
      sectionOrder: typeData?.sectionOrder || [],
      requiredSections: typeData?.requiredSections || [],
      wordLimits: typeData?.defaultWordLimits || {}
    };

    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.paperTypeCode === code) {
            setSectionOrder(parsed.sectionOrder || defaults.sectionOrder);
            setRequiredSections(parsed.requiredSections || defaults.requiredSections);
            setWordLimits(parsed.wordLimits || defaults.wordLimits);
            // Only set default section if none is selected
            if (!selectedSection) {
              const nextOrder = parsed.sectionOrder || defaults.sectionOrder;
              setSelectedSection(nextOrder[0] || 'abstract');
            }
            return;
          }
        } catch {
          // ignore stored config
        }
      }
    }

    setSectionOrder(defaults.sectionOrder);
    setRequiredSections(defaults.requiredSections);
    setWordLimits(defaults.wordLimits);
    // Only set default section if none is selected
    if (!selectedSection) {
      setSelectedSection(defaults.sectionOrder[0] || 'abstract');
    }
  };

  useEffect(() => {
    const loadSession = async () => {
      const sessionRes = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!sessionRes.ok) return;
      const sessionData = await sessionRes.json();
      const session = sessionData.session;
      const code = session?.paperType?.code || process.env.DEFAULT_PAPER_TYPE || 'JOURNAL_ARTICLE';
      setPaperTypeCode(code);

      const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : [];
      const paperDraft = drafts
        .filter((draft: any) => (draft.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((a: any, b: any) => b.version - a.version)[0];

      if (paperDraft) {
        setSections(parseExtraSections(paperDraft.extraSections));
      }

      const typeRes = await fetch(`/api/paper-types/${code}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (typeRes.ok) {
        const typeData = await typeRes.json();
        applySectionConfig(typeData.paperType, code);
      }
    };

    const loadCitations = async () => {
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      setCitations(data.citations || []);
    };

    if (sessionId && authToken) {
      loadSession().catch(() => undefined);
      loadCitations().catch(() => undefined);
    }
  }, [sessionId, authToken]);

  const content = sections[selectedSection] || '';
  const currentWordCount = computeWordCount(content);
  const targetWordCount = wordLimits[selectedSection] || 0;
  const hasCitations = /\[CITE:[^\]]+\]/.test(content);
  const needsCitations = isCitationRequired(selectedSection);

  const getSectionStatus = (sectionKey: string) => {
    const sectionContent = sections[sectionKey] || '';
    const words = computeWordCount(sectionContent);
    const target = wordLimits[sectionKey] || 0;
    const requiredCitation = isCitationRequired(sectionKey);
    const sectionHasCitations = /\[CITE:[^\]]+\]/.test(sectionContent);

    if (words === 0) return 'empty';
    if (target > 0 && words < target * 0.5) return 'draft';
    if (requiredCitation && !sectionHasCitations) return 'draft';
    if (target > 0 && words >= target) return 'complete';
    return 'draft';
  };

  const handleContentChange = (value: string) => {
    setSections(prev => ({ ...prev, [selectedSection]: value }));
  };

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'save_section',
          sectionKey: selectedSection,
          content: sections[selectedSection] || ''
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Save failed');
      }

      showMessage('Section saved successfully', 'success');
      await refreshSession();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'generate_section',
          sectionKey: selectedSection,
          instructions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Generation failed');
      }

      setSections(prev => ({ ...prev, [selectedSection]: data.content || '' }));
      showMessage('Section generated successfully', 'success');
      await refreshSession();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const insertCitation = (key: string) => {
    if (editorRef.current) {
      editorRef.current.insertContent(` [CITE:${key}]`);
      return;
    }
    const updated = `${content}\n[CITE:${key}]`;
    handleContentChange(updated);
  };

  const handleInsertSelected = (keys: string[]) => {
    if (keys.length === 0) return;
    const insertText = keys.map(key => `[CITE:${key}]`).join(' ');
    if (editorRef.current) {
      editorRef.current.insertContent(` ${insertText} `);
    } else {
      handleContentChange(`${content}\n${insertText}`);
    }
  };

  if (!paperTypeCode) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Select a paper type in Outline Planning to start drafting.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-180px)] flex flex-col">
      {/* Main Editor Area - Full Width */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Editor Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {formatSectionLabel(selectedSection)}
              </h2>
              <div className="flex items-center gap-3 mt-1">
                <span className={`
                  inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                  ${currentWordCount >= (targetWordCount || 0) 
                    ? 'bg-emerald-50 text-emerald-700' 
                    : 'bg-slate-100 text-slate-600'
                  }
                `}>
                  {currentWordCount} words
                  {targetWordCount ? ` / ${targetWordCount} target` : ''}
                </span>
                {needsCitations && (
                  <span className={`
                    inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                    ${hasCitations 
                      ? 'bg-emerald-50 text-emerald-700' 
                      : 'bg-amber-50 text-amber-700'
                    }
                  `}>
                    <Quote className="w-3 h-3" />
                    {hasCitations ? 'Citations added' : 'Needs citations'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCitations(!showCitations)}
                className={`
                  flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors
                  ${showCitations 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }
                `}
              >
                <BookOpen className="w-4 h-4" />
                Citations
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Generate
              </button>
            </div>
          </div>
        </div>

        {/* Toast Messages */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`
                mx-6 mt-3 px-4 py-2 rounded-lg flex items-center gap-2 text-sm
                ${messageType === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}
              `}
            >
              {messageType === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Editor + Citations Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor */}
          <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${showCitations ? 'pr-0' : ''}`}>
            {/* Instructions Input */}
            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Optional: Add instructions for AI generation (e.g., 'Focus on methodology', 'Include recent studies')"
                  className="flex-1 text-sm bg-transparent border-none outline-none placeholder-slate-400 text-slate-700"
                />
              </div>
            </div>

            {/* Rich Text Editor */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-4xl mx-auto p-6">
                <SectionEditor
                  ref={editorRef}
                  value={content}
                  onChange={handleContentChange}
                  placeholder={`Start writing your ${formatSectionLabel(selectedSection).toLowerCase()} section here...`}
                />
              </div>
            </div>
          </div>

          {/* Citations Panel (Collapsible) */}
          <AnimatePresence>
            {showCitations && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-l border-slate-200 bg-slate-50/50 overflow-hidden flex flex-col"
              >
                <div className="p-4 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-semibold text-slate-900">Citations</span>
                      <span className="text-xs text-slate-400">({citations.length})</span>
                    </div>
                    <button
                      onClick={() => setPickerOpen(true)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      + Insert
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <CitationManager
                    sessionId={sessionId}
                    authToken={authToken}
                    citations={citations}
                    onCitationsUpdated={setCitations}
                    onInsertCitation={insertCitation}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Citation Picker Modal */}
      <CitationPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sessionId={sessionId}
        authToken={authToken}
        citations={citations}
        onInsert={handleInsertSelected}
        onCitationsUpdated={setCitations}
      />
    </div>
  );
}
