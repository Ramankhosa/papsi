'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  BookOpen,
  Wand2,
  Plus,
  GripVertical,
  Loader2,
  Check,
  X,
  ArrowUpRight,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  AlignLeft,
  AlignJustify,
  Scissors,
  FileText,
  Lightbulb,
  Quote,
  Eye,
  Download,
  Search,
  Info,
  AlertCircle,
  Zap,
  Move,
  RotateCcw,
  HelpCircle,
  GitBranch,
  BarChart3,
  Network,
  Workflow,
  ChevronDown,
  ExternalLink,
  Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// ============================================================================
// Types
// ============================================================================

interface FigurePlan {
  id: string;
  figureNo: number;
  title: string;
  caption?: string;
  description?: string;
  imagePath?: string;
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
  category?: string;
  figureType?: string;
}

interface AISuggestion {
  id: string;
  type: 'figure' | 'citation' | 'rewrite' | 'expand';
  title: string;
  description: string;
  actionLabel: string;
  relevance: number;
}

interface TextSelection {
  text: string;
  start: number;
  end: number;
}

interface Citation {
  id: string;
  title: string;
  authors?: string;
  year?: string | number;
  venue?: string;
  doi?: string;
  citationKey: string;
  source: 'paper' | 'library';
  sourceType?: string;
}

interface FloatingWritingPanelProps {
  sessionId: string;
  authToken: string | null;
  currentSection?: string;
  currentContent?: string;
  figures?: FigurePlan[];
  citations?: Citation[];
  onInsertFigure?: (figureId: string, position?: 'cursor' | 'end') => void;
  onInsertCitation?: (citation: Citation) => void;
  onTextAction?: (action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple', selectedText: string, instructions?: string) => Promise<string>;
  onGenerateFigure?: (description: string) => void;
  onGenerateDiagram?: (description: string, diagramType: string) => void;
  selectedText?: TextSelection | null;
  onRefreshFigures?: () => void;
  onRefreshCitations?: () => void;
  isVisible?: boolean;
}

// ============================================================================
// Help Tooltip Component
// ============================================================================

function HelpTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg max-w-[200px] text-center whitespace-normal"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Diagram type options
const DIAGRAM_TYPES = [
  { id: 'auto', label: 'Auto-detect', icon: <Sparkles className="w-3 h-3" />, description: 'AI chooses best diagram type' },
  { id: 'flowchart', label: 'Flowchart', icon: <Workflow className="w-3 h-3" />, description: 'Process and workflow diagrams' },
  { id: 'sequence', label: 'Sequence', icon: <GitBranch className="w-3 h-3" />, description: 'Interaction sequences' },
  { id: 'class', label: 'Class/ER', icon: <Network className="w-3 h-3" />, description: 'Entity relationships' },
  { id: 'chart', label: 'Chart', icon: <BarChart3 className="w-3 h-3" />, description: 'Data visualizations' },
];

// ============================================================================
// Panel Tab Component
// ============================================================================

type TabId = 'figures' | 'ai' | 'actions' | 'citations';

interface PanelTab {
  id: TabId;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

// ============================================================================
// Figure Card Component
// ============================================================================

function FigureCard({ 
  figure, 
  onInsert, 
  onPreview,
  compact = false 
}: { 
  figure: FigurePlan; 
  onInsert: () => void;
  onPreview: () => void;
  compact?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <motion.div
      className={`relative bg-white border border-slate-200 rounded-xl overflow-hidden transition-all cursor-pointer ${
        isHovered ? 'shadow-lg border-blue-300' : 'shadow-sm'
      } ${compact ? 'p-2' : 'p-3'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      draggable
      onDragStart={(e) => {
        // Set drag data for drop handling
        const event = e as unknown as React.DragEvent;
        event.dataTransfer?.setData('text/plain', `[Figure ${figure.figureNo}]`);
        event.dataTransfer?.setData('application/figure-id', figure.id);
      }}
    >
      {/* Thumbnail */}
      <div className={`bg-slate-100 rounded-lg flex items-center justify-center ${compact ? 'h-16' : 'h-20'} mb-2 overflow-hidden`}>
        {figure.status === 'GENERATING' ? (
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        ) : figure.imagePath ? (
          <img 
            src={figure.imagePath} 
            alt={figure.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon className="w-6 h-6 text-slate-300" />
        )}
      </div>
      
      {/* Info */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-medium text-slate-400">Fig. {figure.figureNo}</span>
          <div className={`w-1.5 h-1.5 rounded-full ${
            figure.status === 'GENERATED' ? 'bg-emerald-500' :
            figure.status === 'GENERATING' ? 'bg-blue-500 animate-pulse' :
            figure.status === 'FAILED' ? 'bg-red-500' :
            'bg-slate-300'
          }`} />
        </div>
        <p className="text-xs font-medium text-slate-700 line-clamp-2">{figure.title}</p>
      </div>
      
      {/* Hover Actions */}
      <AnimatePresence>
        {isHovered && figure.status === 'GENERATED' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent rounded-xl flex items-end justify-center p-2 gap-1"
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              className="h-7 px-2 text-xs rounded-lg"
            >
              <Eye className="w-3 h-3 mr-1" />
              View
            </Button>
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); onInsert(); }}
              className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              <Plus className="w-3 h-3 mr-1" />
              Insert
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Drag hint */}
      {figure.status === 'GENERATED' && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-4 h-4 text-slate-400" />
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// AI Suggestion Card Component
// ============================================================================

function SuggestionCard({ 
  suggestion, 
  onApply,
  isLoading = false 
}: { 
  suggestion: AISuggestion; 
  onApply: () => void;
  isLoading?: boolean;
}) {
  const iconMap = {
    figure: <ImageIcon className="w-4 h-4" />,
    citation: <Quote className="w-4 h-4" />,
    rewrite: <Pencil className="w-4 h-4" />,
    expand: <AlignJustify className="w-4 h-4" />
  };
  
  const colorMap = {
    figure: 'text-violet-600 bg-violet-50 border-violet-200',
    citation: 'text-amber-600 bg-amber-50 border-amber-200',
    rewrite: 'text-blue-600 bg-blue-50 border-blue-200',
    expand: 'text-emerald-600 bg-emerald-50 border-emerald-200'
  };
  
  return (
    <div className={`p-3 rounded-xl border ${colorMap[suggestion.type]} transition-all hover:shadow-md`}>
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-lg ${colorMap[suggestion.type]}`}>
          {iconMap[suggestion.type]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">{suggestion.title}</p>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{suggestion.description}</p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onApply}
        disabled={isLoading}
        className="w-full mt-2 h-8 text-xs rounded-lg"
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Zap className="w-3 h-3 mr-1" />
        )}
        {suggestion.actionLabel}
      </Button>
    </div>
  );
}

// ============================================================================
// Text Action Button Component with Expandable Remarks
// ============================================================================

function TextActionButton({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  loading = false,
  actionId,
  expandedAction,
  onToggleExpand,
  customRemarks,
  onRemarksChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: (remarks?: string) => void;
  disabled?: boolean;
  loading?: boolean;
  actionId: string;
  expandedAction: string | null;
  onToggleExpand: (id: string | null) => void;
  customRemarks: string;
  onRemarksChange: (remarks: string) => void;
}) {
  const isExpanded = expandedAction === actionId;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (!isExpanded) {
              onClick();
            }
          }}
          disabled={disabled || loading}
          className="flex-1 p-2.5 text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{label}</p>
              <p className="text-[10px] text-slate-500 truncate">{description}</p>
            </div>
          </div>
        </button>
        
        {/* Remarks toggle button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(isExpanded ? null : actionId);
            if (!isExpanded) {
              onRemarksChange('');
            }
          }}
          disabled={disabled || loading}
          className={`p-2 rounded-lg border transition-all ${
            isExpanded 
              ? 'bg-blue-100 border-blue-300 text-blue-600' 
              : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Add custom instructions"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>
      
      {/* Expandable remarks input */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-blue-500" />
                <span className="text-[10px] font-medium text-blue-700">Custom Instructions</span>
              </div>
              <Textarea
                value={customRemarks}
                onChange={(e) => onRemarksChange(e.target.value)}
                placeholder={`E.g., "Focus on clarity" or "Keep technical terms"...`}
                rows={2}
                className="text-xs rounded-lg resize-none bg-white border-blue-200 focus:border-blue-400"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onClick(customRemarks)}
                  disabled={loading}
                  className="flex-1 h-7 rounded-lg text-xs bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <Zap className="w-3 h-3 mr-1" />
                  )}
                  {label} with Instructions
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onToggleExpand(null)}
                  className="h-7 rounded-lg text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main Floating Panel Component
// ============================================================================

export default function FloatingWritingPanel({
  sessionId,
  authToken,
  currentSection,
  currentContent,
  figures = [],
  citations = [],
  onInsertFigure,
  onInsertCitation,
  onTextAction,
  onGenerateFigure,
  onGenerateDiagram,
  selectedText,
  onRefreshFigures,
  onRefreshCitations,
  isVisible = true
}: FloatingWritingPanelProps) {
  // Panel state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('figures');
  const [searchQuery, setSearchQuery] = useState('');
  const [citationSearch, setCitationSearch] = useState('');
  
  // Drag state
  const dragControls = useDragControls();
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Resize state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 288, height: 500 }); // Default w-72 = 288px
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Min/max size constraints
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const MIN_HEIGHT = 400;
  const MAX_HEIGHT = 800;

  // Load saved position and size from localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem('floatingPanelPosition');
    const savedSize = localStorage.getItem('floatingPanelSize');
    if (savedPosition) {
      try {
        const parsed = JSON.parse(savedPosition);
        setPosition(parsed);
      } catch {
        // Ignore parse errors
      }
    }
    if (savedSize) {
      try {
        const parsed = JSON.parse(savedSize);
        setPanelSize(parsed);
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save size to localStorage
  const savePanelSize = useCallback((size: { width: number; height: number }) => {
    localStorage.setItem('floatingPanelSize', JSON.stringify(size));
  }, []);

  // Save position to localStorage when it changes
  const handleDragEnd = useCallback((_: any, info: { point: { x: number; y: number } }) => {
    setIsDragging(false);
    const newPosition = { x: info.point.x, y: info.point.y };
    // We don't save the actual point, we save the offset from default position
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'corner' | 'left' | 'bottom') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      
      let newWidth = resizeRef.current.startWidth;
      let newHeight = resizeRef.current.startHeight;
      
      if (direction === 'corner' || direction === 'left') {
        // Resize from left - moving left increases width, moving right decreases
        newWidth = resizeRef.current.startWidth - (moveEvent.clientX - resizeRef.current.startX);
      }
      if (direction === 'corner' || direction === 'bottom') {
        newHeight = resizeRef.current.startHeight + (moveEvent.clientY - resizeRef.current.startY);
      }
      
      // Apply constraints
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
      
      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (resizeRef.current) {
        savePanelSize(panelSize);
      }
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelSize, savePanelSize]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Reset position and size to default
  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setPanelSize({ width: 288, height: 500 });
    setIsFullscreen(false);
    localStorage.removeItem('floatingPanelPosition');
    localStorage.removeItem('floatingPanelSize');
  }, []);
  
  // Figure preview state
  const [previewFigure, setPreviewFigure] = useState<FigurePlan | null>(null);
  
  // AI state
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  
  // Quick figure generation state
  const [showQuickFigure, setShowQuickFigure] = useState(false);
  const [figureDescription, setFigureDescription] = useState('');
  const [generatingFigure, setGeneratingFigure] = useState(false);
  
  // Diagram generation state
  const [showDiagramGen, setShowDiagramGen] = useState(false);
  const [diagramDescription, setDiagramDescription] = useState('');
  const [selectedDiagramType, setSelectedDiagramType] = useState('auto');
  const [generatingDiagram, setGeneratingDiagram] = useState(false);
  
  // Custom instructions for text actions
  const [customInstructions, setCustomInstructions] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  
  // Expandable action state - tracks which action has remarks expanded
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [actionRemarks, setActionRemarks] = useState('');
  
  // Citation management state
  const [citationSourceFilter, setCitationSourceFilter] = useState<'all' | 'paper' | 'library'>('all');
  const [loadingCitations, setLoadingCitations] = useState(false);
  const [paperCitations, setPaperCitations] = useState<Citation[]>([]);
  const [citationCounts, setCitationCounts] = useState({ paper: 0, library: 0, total: 0 });
  const [importingCitation, setImportingCitation] = useState<string | null>(null);
  
  // Add citation state (DOI / BibTeX)
  const [showAddCitation, setShowAddCitation] = useState(false);
  const [addCitationMode, setAddCitationMode] = useState<'doi' | 'bibtex'>('doi');
  const [doiInput, setDoiInput] = useState('');
  const [bibtexInput, setBibtexInput] = useState('');
  const [addingCitation, setAddingCitation] = useState(false);
  const [addCitationError, setAddCitationError] = useState<string | null>(null);
  
  // Help panel state
  const [showHelp, setShowHelp] = useState(false);

  // Tabs configuration
  const tabs: PanelTab[] = [
    { id: 'figures', icon: <ImageIcon className="w-4 h-4" />, label: 'Figures', badge: figures.filter(f => f.status === 'GENERATED').length },
    { id: 'ai', icon: <Sparkles className="w-4 h-4" />, label: 'AI Assist', badge: aiSuggestions.length },
    { id: 'actions', icon: <Wand2 className="w-4 h-4" />, label: 'Actions' },
    { id: 'citations', icon: <BookOpen className="w-4 h-4" />, label: 'Citations', badge: citationCounts.total || citations.length },
  ];

  // Filter figures based on search
  const filteredFigures = figures.filter(f => 
    f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Use API-fetched citations or fall back to prop-based citations
  const displayCitations = paperCitations.length > 0 ? paperCitations : citations.map(c => ({
    ...c,
    citationKey: c.citationKey || `${c.authors?.split(' ')[0] || 'Unknown'}${c.year || ''}`,
    source: 'paper' as const,
  }));

  // Handle diagram generation
  const handleGenerateDiagram = async () => {
    if (!onGenerateDiagram) return;
    
    const description = diagramDescription.trim() || selectedText?.text || '';
    if (!description) return;
    
    setGeneratingDiagram(true);
    try {
      await onGenerateDiagram(description, selectedDiagramType);
      setDiagramDescription('');
      setShowDiagramGen(false);
    } catch (err) {
      console.error('Diagram generation failed:', err);
    } finally {
      setGeneratingDiagram(false);
    }
  };

  // Generate AI suggestions based on current context
  const generateSuggestions = useCallback(async () => {
    if (!currentContent || !currentSection) return;
    
    setLoadingSuggestions(true);
    try {
      // Analyze content and generate contextual suggestions
      const suggestions: AISuggestion[] = [];
      
      // Check if section could benefit from a figure
      if (currentContent.length > 200 && figures.length === 0) {
        suggestions.push({
          id: 'suggest-figure',
          type: 'figure',
          title: 'Add a visualization',
          description: 'This section could benefit from a diagram or chart to illustrate the concepts.',
          actionLabel: 'Generate Figure',
          relevance: 0.9
        });
      }
      
      // Check for opportunities to expand
      if (currentContent.length < 500) {
        suggestions.push({
          id: 'suggest-expand',
          type: 'expand',
          title: 'Expand this section',
          description: 'Add more detail and depth to strengthen your argument.',
          actionLabel: 'Expand Content',
          relevance: 0.7
        });
      }
      
      // Check for long paragraphs that could be rewritten
      const paragraphs = currentContent.split('\n\n');
      if (paragraphs.some(p => p.length > 800)) {
        suggestions.push({
          id: 'suggest-rewrite',
          type: 'rewrite',
          title: 'Improve readability',
          description: 'Break up long paragraphs for better flow.',
          actionLabel: 'Rewrite Section',
          relevance: 0.8
        });
      }
      
      setAiSuggestions(suggestions);
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [currentContent, currentSection, figures.length]);

  // Generate suggestions when content changes significantly
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentContent && currentContent.length > 100) {
        generateSuggestions();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [currentContent, generateSuggestions]);

  // Fetch citations from API
  const fetchCitations = useCallback(async () => {
    if (!authToken || !sessionId) return;
    
    setLoadingCitations(true);
    try {
      const params = new URLSearchParams({
        source: citationSourceFilter,
        q: citationSearch,
        limit: '50',
      });
      
      const response = await fetch(`/api/papers/${sessionId}/panel-citations?${params}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setPaperCitations(data.citations || []);
        setCitationCounts(data.counts || { paper: 0, library: 0, total: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch citations:', err);
    } finally {
      setLoadingCitations(false);
    }
  }, [authToken, sessionId, citationSourceFilter, citationSearch]);

  // Fetch citations when tab opens or filter changes
  useEffect(() => {
    if (activeTab === 'citations') {
      fetchCitations();
    }
  }, [activeTab, citationSourceFilter, fetchCitations]);

  // Debounced search for citations
  useEffect(() => {
    if (activeTab !== 'citations') return;
    
    const timer = setTimeout(() => {
      fetchCitations();
    }, 300);
    return () => clearTimeout(timer);
  }, [citationSearch, activeTab, fetchCitations]);

  // Import citation from library to paper
  const handleImportCitation = async (referenceId: string) => {
    if (!authToken || !sessionId) return;
    
    setImportingCitation(referenceId);
    try {
      const response = await fetch(`/api/papers/${sessionId}/panel-citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ referenceId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        // Update the local list
        if (data.imported) {
          // Replace the library item with paper item
          setPaperCitations(prev => {
            const filtered = prev.filter(c => c.id !== referenceId);
            return [data.citation, ...filtered];
          });
          setCitationCounts(prev => ({
            ...prev,
            paper: prev.paper + 1,
          }));
        }
        // Insert the citation
        if (onInsertCitation) {
          onInsertCitation(data.citation);
        }
      }
    } catch (err) {
      console.error('Failed to import citation:', err);
    } finally {
      setImportingCitation(null);
    }
  };

  // Handle DOI lookup and add citation
  const handleAddCitationByDOI = async () => {
    if (!authToken || !sessionId || !doiInput.trim()) return;
    
    setAddingCitation(true);
    setAddCitationError(null);
    
    try {
      // Clean DOI - extract from URL if needed
      let cleanDOI = doiInput.trim();
      if (cleanDOI.includes('doi.org/')) {
        cleanDOI = cleanDOI.split('doi.org/')[1];
      }
      cleanDOI = cleanDOI.replace(/^https?:\/\//, '');
      
      // Fetch metadata from CrossRef
      const crossRefResponse = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDOI)}`, {
        headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' },
      });
      
      if (!crossRefResponse.ok) {
        throw new Error('DOI not found. Please check the DOI and try again.');
      }
      
      const crossRefData = await crossRefResponse.json();
      const work = crossRefData.message;
      
      const authors = (work.author || []).map((a: any) =>
        `${a.given || ''} ${a.family || ''}`.trim()
      ).filter(Boolean);
      
      // Create citation in paper
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          citation: {
            sourceType: 'JOURNAL_ARTICLE',
            title: work.title?.[0] || '',
            authors: authors.length > 0 ? authors : ['Unknown'],
            year: work.issued?.['date-parts']?.[0]?.[0],
            venue: work['container-title']?.[0] || work.publisher,
            volume: work.volume,
            issue: work.issue,
            pages: work.page,
            doi: work.DOI,
            url: work.URL,
          }
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add citation');
      }
      
      // Success - refresh citations and reset form
      setDoiInput('');
      setShowAddCitation(false);
      fetchCitations();
    } catch (err) {
      setAddCitationError(err instanceof Error ? err.message : 'Failed to add citation');
    } finally {
      setAddingCitation(false);
    }
  };

  // Handle BibTeX import
  const handleAddCitationByBibTeX = async () => {
    if (!authToken || !sessionId || !bibtexInput.trim()) return;
    
    setAddingCitation(true);
    setAddCitationError(null);
    
    try {
      // Parse BibTeX client-side to extract basic info
      const bibtex = bibtexInput.trim();
      
      // Simple regex parsing for common BibTeX fields
      const titleMatch = bibtex.match(/title\s*=\s*[{"]([^}"]+)[}"]/i);
      const authorMatch = bibtex.match(/author\s*=\s*[{"]([^}"]+)[}"]/i);
      const yearMatch = bibtex.match(/year\s*=\s*[{"]?(\d{4})[}"']?/i);
      const journalMatch = bibtex.match(/(?:journal|booktitle)\s*=\s*[{"]([^}"]+)[}"]/i);
      const volumeMatch = bibtex.match(/volume\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const issueMatch = bibtex.match(/(?:number|issue)\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const pagesMatch = bibtex.match(/pages\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const doiMatch = bibtex.match(/doi\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const urlMatch = bibtex.match(/url\s*=\s*[{"]([^}"]+)[}"]/i);
      const publisherMatch = bibtex.match(/publisher\s*=\s*[{"]([^}"]+)[}"]/i);
      
      // Parse authors (handle "and" separator)
      let authors: string[] = ['Unknown'];
      if (authorMatch) {
        authors = authorMatch[1]
          .split(/\s+and\s+/i)
          .map(a => a.trim().replace(/[{}]/g, ''))
          .filter(Boolean);
      }
      
      // Detect source type from entry type
      const typeMatch = bibtex.match(/@(\w+)\s*\{/i);
      let sourceType = 'OTHER';
      if (typeMatch) {
        const entryType = typeMatch[1].toLowerCase();
        if (entryType === 'article') sourceType = 'JOURNAL_ARTICLE';
        else if (entryType === 'inproceedings' || entryType === 'conference') sourceType = 'CONFERENCE_PAPER';
        else if (entryType === 'book') sourceType = 'BOOK';
        else if (entryType === 'incollection') sourceType = 'BOOK_CHAPTER';
        else if (entryType === 'phdthesis' || entryType === 'mastersthesis') sourceType = 'THESIS';
        else if (entryType === 'techreport') sourceType = 'REPORT';
        else if (entryType === 'misc' || entryType === 'online') sourceType = 'WEBSITE';
      }
      
      if (!titleMatch) {
        throw new Error('Could not parse title from BibTeX. Please check the format.');
      }
      
      // Create citation in paper
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          citation: {
            sourceType,
            title: titleMatch[1].replace(/[{}]/g, ''),
            authors,
            year: yearMatch ? parseInt(yearMatch[1]) : undefined,
            venue: journalMatch?.[1]?.replace(/[{}]/g, '') || publisherMatch?.[1]?.replace(/[{}]/g, ''),
            volume: volumeMatch?.[1]?.replace(/[{}]/g, ''),
            issue: issueMatch?.[1]?.replace(/[{}]/g, ''),
            pages: pagesMatch?.[1]?.replace(/[{}]/g, '').replace(/--/g, '-'),
            doi: doiMatch?.[1]?.replace(/[{}]/g, ''),
            url: urlMatch?.[1],
          }
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add citation');
      }
      
      // Success - refresh citations and reset form
      setBibtexInput('');
      setShowAddCitation(false);
      fetchCitations();
    } catch (err) {
      setAddCitationError(err instanceof Error ? err.message : 'Failed to parse BibTeX');
    } finally {
      setAddingCitation(false);
    }
  };

  // Handle text action with optional inline remarks
  const handleTextAction = async (action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple', inlineRemarks?: string) => {
    if (!selectedText?.text || !onTextAction) return;
    
    setLoadingAction(action);
    try {
      // Use inline remarks if provided, otherwise fall back to custom instructions
      const instructions = inlineRemarks || customInstructions || undefined;
      await onTextAction(action, selectedText.text, instructions);
      setCustomInstructions('');
      setShowCustomInput(false);
      setExpandedAction(null);
      setActionRemarks('');
    } catch (err) {
      console.error('Text action failed:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  // Handle quick figure generation
  const handleQuickFigure = async () => {
    if (!figureDescription.trim() || !onGenerateFigure) return;
    
    setGeneratingFigure(true);
    try {
      await onGenerateFigure(figureDescription);
      setFigureDescription('');
      setShowQuickFigure(false);
    } catch (err) {
      console.error('Figure generation failed:', err);
    } finally {
      setGeneratingFigure(false);
    }
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Drag constraints container - covers the whole viewport */}
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-30" />
      
      {/* Main Panel */}
      <motion.div
        ref={panelRef}
        drag={!isFullscreen && !isResizing}
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={constraintsRef}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ 
          opacity: 1, 
          scale: 1,
          width: isFullscreen ? '100vw' : isCollapsed ? 56 : panelSize.width,
          height: isFullscreen ? '100vh' : undefined,
        }}
        whileDrag={{ scale: 1.02, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
        style={{ 
          x: isFullscreen ? 0 : position.x, 
          y: isFullscreen ? 0 : position.y,
          position: 'fixed',
          right: isFullscreen ? 0 : 24,
          top: isFullscreen ? 0 : '50%',
          marginTop: isFullscreen ? 0 : (isCollapsed ? -100 : -(panelSize.height / 2)),
          zIndex: isFullscreen ? 100 : 40,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`${isDragging ? 'cursor-grabbing' : ''} ${isResizing ? 'select-none' : ''}`}
      >
        <div 
          className={`bg-white shadow-2xl border overflow-hidden transition-colors flex flex-col ${
            isDragging ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
          } ${isFullscreen ? 'rounded-none h-full' : 'rounded-2xl'}`}
          style={{ 
            height: isFullscreen ? '100%' : isCollapsed ? 'auto' : panelSize.height,
          }}
        >
          {/* Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-12 bg-white border border-slate-200 rounded-l-lg shadow-md flex items-center justify-center hover:bg-slate-50 transition-colors z-10"
          >
            {isCollapsed ? (
              <ChevronLeft className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {isCollapsed ? (
            // Collapsed View - Icon Bar
            <div className="py-4 flex flex-col items-center gap-2">
              {/* Drag Handle for collapsed */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="w-10 h-6 rounded-lg flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors mb-1"
                title="Drag to move"
              >
                <GripVertical className="w-4 h-4" />
              </div>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setIsCollapsed(false); }}
                  className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'
                  }`}
                  title={tab.label}
                >
                  {tab.icon}
                  {tab.badge && tab.badge > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            // Expanded View
            <>
              {/* Drag Handle Header */}
              <div 
                onPointerDown={(e) => !isFullscreen && dragControls.start(e)}
                className={`px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white select-none ${
                  isFullscreen ? '' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {!isFullscreen && <Move className="w-3.5 h-3.5 text-slate-400" />}
                    <h3 className="font-semibold text-slate-800 text-sm">Writing Assistant</h3>
                    {isFullscreen && (
                      <Badge className="bg-blue-100 text-blue-700 text-[10px]">Fullscreen</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isFullscreen && (
                      <button
                        onClick={resetPosition}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Reset position & size"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={toggleFullscreen}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {!isFullscreen && (
                      <Badge variant="outline" className="text-[10px]">
                        {currentSection || 'No section'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-100">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
                      activeTab === tab.id 
                        ? 'text-blue-600' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {tab.icon}
                      {tab.badge && tab.badge > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">
                          {tab.badge}
                        </span>
                      )}
                    </div>
                    {activeTab === tab.id && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className={`overflow-y-auto ${isFullscreen ? 'flex-1' : ''}`} style={{ maxHeight: isFullscreen ? 'none' : panelSize.height - 120 }}>
                <AnimatePresence mode="wait">
                  {/* Figures Tab */}
                  {activeTab === 'figures' && (
                    <motion.div
                      key="figures"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Search figures..."
                          className="pl-9 h-9 text-sm rounded-xl"
                        />
                      </div>

                      {/* Quick Create Button */}
                      <button
                        onClick={() => setShowQuickFigure(!showQuickFigure)}
                        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-blue-600"
                      >
                        <Plus className="w-4 h-4" />
                        Quick Generate Figure
                      </button>

                      {/* Quick Figure Form */}
                      <AnimatePresence>
                        {showQuickFigure && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
                              <Textarea
                                value={figureDescription}
                                onChange={e => setFigureDescription(e.target.value)}
                                placeholder="Describe the figure you want to generate..."
                                rows={2}
                                className="text-sm rounded-lg resize-none"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={handleQuickFigure}
                                  disabled={generatingFigure || !figureDescription.trim()}
                                  className="flex-1 h-8 rounded-lg text-xs"
                                >
                                  {generatingFigure ? (
                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                  ) : (
                                    <Sparkles className="w-3 h-3 mr-1" />
                                  )}
                                  Generate
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowQuickFigure(false)}
                                  className="h-8 rounded-lg text-xs"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Figure Grid */}
                      {filteredFigures.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {filteredFigures.map(figure => (
                            <FigureCard
                              key={figure.id}
                              figure={figure}
                              compact
                              onInsert={() => onInsertFigure?.(figure.id)}
                              onPreview={() => setPreviewFigure(figure)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">No figures yet</p>
                          <p className="text-xs text-slate-400 mt-1">Create one above or go to Figure Planner</p>
                        </div>
                      )}

                      {/* Refresh Button */}
                      {figures.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onRefreshFigures}
                          className="w-full h-8 text-xs text-slate-500"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Refresh Figures
                        </Button>
                      )}

                      {/* Drag Hint */}
                      <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg text-xs text-slate-500">
                        <Info className="w-3 h-3" />
                        <span>Drag figures to insert at cursor position</span>
                      </div>
                    </motion.div>
                  )}

                  {/* AI Suggestions Tab */}
                  {activeTab === 'ai' && (
                    <motion.div
                      key="ai"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600">Context-aware suggestions</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={generateSuggestions}
                          disabled={loadingSuggestions}
                          className="h-7 px-2 text-xs"
                        >
                          {loadingSuggestions ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                        </Button>
                      </div>

                      {loadingSuggestions ? (
                        <div className="py-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Analyzing your content...</p>
                        </div>
                      ) : aiSuggestions.length > 0 ? (
                        <div className="space-y-2">
                          {aiSuggestions.map(suggestion => (
                            <SuggestionCard
                              key={suggestion.id}
                              suggestion={suggestion}
                              onApply={() => {
                                if (suggestion.type === 'figure') {
                                  setActiveTab('figures');
                                  setShowQuickFigure(true);
                                } else if (suggestion.type === 'rewrite' || suggestion.type === 'expand') {
                                  setActiveTab('actions');
                                }
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">No suggestions right now</p>
                          <p className="text-xs text-slate-400 mt-1">Keep writing and I&apos;ll offer tips</p>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Text Actions Tab */}
                  {activeTab === 'actions' && (
                    <motion.div
                      key="actions"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      {/* Selection indicator - simplified, no animation for stability */}
                      {selectedText?.text ? (
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-blue-500" />
                              <p className="text-xs text-blue-700 font-semibold">Text Selected</p>
                            </div>
                            <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                              {selectedText.text.length} chars
                            </span>
                          </div>
                          <div className="p-2 bg-white/80 rounded-lg border border-blue-100">
                            <p className="text-xs text-slate-700 line-clamp-2 leading-relaxed">&ldquo;{selectedText.text.slice(0, 100)}{selectedText.text.length > 100 ? '...' : ''}&rdquo;</p>
                          </div>
                          <p className="mt-1.5 text-[10px] text-blue-600 text-center">
                            Choose an action below
                          </p>
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-amber-700">No text selected</p>
                            <p className="text-[10px] text-amber-600 mt-0.5">Highlight text in the editor to use AI actions</p>
                          </div>
                        </div>
                      )}

                      {/* Text Transformation Actions */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-xs font-medium text-slate-600">Text Transformations</p>
                          <HelpTooltip text="AI rewrites your selected text while preserving meaning. Click the pencil icon to add custom instructions." />
                        </div>
                        <div className="space-y-1.5">
                          <TextActionButton
                            icon={<Pencil className="w-3.5 h-3.5" />}
                            label="Rewrite"
                            description="Improve clarity and flow"
                            onClick={(remarks) => handleTextAction('rewrite', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'rewrite'}
                            actionId="rewrite"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<AlignJustify className="w-3.5 h-3.5" />}
                            label="Expand"
                            description="Add more detail and depth"
                            onClick={(remarks) => handleTextAction('expand', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'expand'}
                            actionId="expand"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<Scissors className="w-3.5 h-3.5" />}
                            label="Condense"
                            description="Make it shorter and tighter"
                            onClick={(remarks) => handleTextAction('condense', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'condense'}
                            actionId="condense"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<FileText className="w-3.5 h-3.5" />}
                            label="More Formal"
                            description="Academic tone adjustment"
                            onClick={(remarks) => handleTextAction('formal', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'formal'}
                            actionId="formal"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<AlignLeft className="w-3.5 h-3.5" />}
                            label="Simplify"
                            description="Easier to understand"
                            onClick={(remarks) => handleTextAction('simple', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'simple'}
                            actionId="simple"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                        </div>
                      </div>

                      {/* Diagram Generation from Text */}
                      <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-xs font-medium text-slate-600">Generate Diagram</p>
                          <HelpTooltip text="Create diagrams from selected text or description. AI analyzes content and generates flowcharts, sequence diagrams, or charts." />
                        </div>
                        
                        <button
                          onClick={() => setShowDiagramGen(!showDiagramGen)}
                          className="w-full p-2.5 rounded-lg border border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition-colors flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-violet-600"
                        >
                          <Workflow className="w-4 h-4" />
                          {selectedText?.text ? 'Generate from Selection' : 'Create Diagram'}
                        </button>

                        <AnimatePresence>
                          {showDiagramGen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-2 p-3 bg-violet-50 rounded-xl border border-violet-100 space-y-3">
                                {/* Diagram Type Selection */}
                                <div>
                                  <label className="text-[10px] font-medium text-violet-700 mb-1.5 block">Diagram Type</label>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {DIAGRAM_TYPES.map(type => (
                                      <button
                                        key={type.id}
                                        onClick={() => setSelectedDiagramType(type.id)}
                                        className={`flex items-center gap-1.5 p-2 rounded-lg text-left transition-all ${
                                          selectedDiagramType === type.id
                                            ? 'bg-violet-600 text-white'
                                            : 'bg-white text-slate-600 hover:bg-violet-100'
                                        }`}
                                      >
                                        {type.icon}
                                        <span className="text-[10px] font-medium">{type.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Description (if no selection) */}
                                {!selectedText?.text && (
                                  <div>
                                    <label className="text-[10px] font-medium text-violet-700 mb-1.5 block">Description</label>
                                    <Textarea
                                      value={diagramDescription}
                                      onChange={e => setDiagramDescription(e.target.value)}
                                      placeholder="Describe what you want to visualize..."
                                      rows={2}
                                      className="text-xs rounded-lg resize-none"
                                    />
                                  </div>
                                )}

                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={handleGenerateDiagram}
                                    disabled={generatingDiagram || (!selectedText?.text && !diagramDescription.trim())}
                                    className="flex-1 h-8 rounded-lg text-xs bg-violet-600 hover:bg-violet-700"
                                  >
                                    {generatingDiagram ? (
                                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                    ) : (
                                      <Sparkles className="w-3 h-3 mr-1" />
                                    )}
                                    Generate
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setShowDiagramGen(false)}
                                    className="h-8 rounded-lg text-xs"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Tip for custom instructions */}
                      <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-500">
                          <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
                          <span>
                            Click the <Pencil className="w-2.5 h-2.5 inline mx-0.5" /> icon next to any action to add custom instructions before executing.
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Citations Tab */}
                  {activeTab === 'citations' && (
                    <motion.div
                      key="citations"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-2 flex flex-col h-full"
                    >
                      {/* Header with Add button */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-slate-600">Citations</p>
                          <span className="text-[10px] text-slate-400">
                            ({citationCounts.paper} in paper)
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setShowAddCitation(!showAddCitation)}
                            className={`p-1.5 rounded-md transition-colors ${
                              showAddCitation 
                                ? 'bg-emerald-100 text-emerald-600' 
                                : 'hover:bg-slate-100 text-slate-500'
                            }`}
                            title="Add citation via DOI or BibTeX"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={fetchCitations}
                            disabled={loadingCitations}
                            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-50"
                            title="Refresh"
                          >
                            {loadingCitations ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Add Citation Panel (DOI / BibTeX) */}
                      <AnimatePresence>
                        {showAddCitation && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100 space-y-2">
                              {/* Mode Toggle */}
                              <div className="flex p-0.5 bg-emerald-100 rounded-lg">
                                <button
                                  onClick={() => { setAddCitationMode('doi'); setAddCitationError(null); }}
                                  className={`flex-1 py-1 px-2 text-[10px] font-medium rounded-md transition-all ${
                                    addCitationMode === 'doi' ? 'bg-white text-emerald-800 shadow-sm' : 'text-emerald-600'
                                  }`}
                                >
                                  DOI Lookup
                                </button>
                                <button
                                  onClick={() => { setAddCitationMode('bibtex'); setAddCitationError(null); }}
                                  className={`flex-1 py-1 px-2 text-[10px] font-medium rounded-md transition-all ${
                                    addCitationMode === 'bibtex' ? 'bg-white text-emerald-800 shadow-sm' : 'text-emerald-600'
                                  }`}
                                >
                                  BibTeX
                                </button>
                              </div>
                              
                              {addCitationMode === 'doi' ? (
                                <div className="space-y-1.5">
                                  <Input
                                    value={doiInput}
                                    onChange={e => setDoiInput(e.target.value)}
                                    placeholder="10.1000/xyz123 or https://doi.org/..."
                                    className="h-8 text-xs rounded-lg"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={handleAddCitationByDOI}
                                    disabled={addingCitation || !doiInput.trim()}
                                    className="w-full h-7 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700"
                                  >
                                    {addingCitation ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                                    Lookup & Add
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <Textarea
                                    value={bibtexInput}
                                    onChange={e => setBibtexInput(e.target.value)}
                                    placeholder="@article{key,&#10;  title = {Title},&#10;  author = {Name},&#10;  year = {2024},&#10;  ...&#10;}"
                                    rows={3}
                                    className="text-[10px] rounded-lg resize-none font-mono"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={handleAddCitationByBibTeX}
                                    disabled={addingCitation || !bibtexInput.trim()}
                                    className="w-full h-7 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700"
                                  >
                                    {addingCitation ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                                    Parse & Add
                                  </Button>
                                </div>
                              )}
                              
                              {addCitationError && (
                                <p className="text-[10px] text-red-600 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  {addCitationError}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Source Filter Tabs - Compact */}
                      <div className="flex p-0.5 bg-slate-100 rounded-lg">
                        {[
                          { id: 'all' as const, label: 'All', count: citationCounts.total },
                          { id: 'paper' as const, label: 'Paper', count: citationCounts.paper },
                          { id: 'library' as const, label: 'Library', count: citationCounts.library },
                        ].map((filter) => (
                          <button
                            key={filter.id}
                            onClick={() => setCitationSourceFilter(filter.id)}
                            className={`flex-1 py-1 px-1.5 text-[10px] font-medium rounded-md transition-all ${
                              citationSourceFilter === filter.id
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {filter.label}
                            {filter.count > 0 && (
                              <span className={`ml-0.5 text-[9px] ${
                                citationSourceFilter === filter.id ? 'text-blue-600' : 'text-slate-400'
                              }`}>
                                {filter.count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Search - Compact */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <Input
                          value={citationSearch}
                          onChange={e => setCitationSearch(e.target.value)}
                          placeholder="Search..."
                          className="pl-8 h-8 text-xs rounded-lg"
                        />
                      </div>

                      {/* Citation List - Takes remaining space */}
                      {loadingCitations ? (
                        <div className="py-6 text-center flex-1">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mx-auto mb-2" />
                          <p className="text-xs text-slate-500">Loading...</p>
                        </div>
                      ) : paperCitations.length > 0 ? (
                        <div className="space-y-1 flex-1 overflow-y-auto pr-1" style={{ minHeight: 0 }}>
                          {paperCitations.map(citation => (
                            <div
                              key={citation.id}
                              className={`p-2 rounded-lg border transition-all group ${
                                citation.source === 'paper'
                                  ? 'border-blue-200 bg-blue-50/50 hover:border-blue-300 hover:bg-blue-50'
                                  : 'border-amber-200 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => {
                                      if (citation.source === 'library') {
                                        handleImportCitation(citation.id);
                                      } else {
                                        onInsertCitation?.(citation);
                                      }
                                    }}
                                    className="w-full text-left"
                                  >
                                    <p className={`text-xs font-medium line-clamp-2 ${
                                      citation.source === 'paper' ? 'text-blue-800' : 'text-amber-800'
                                    }`}>
                                      {citation.title}
                                    </p>
                                  </button>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {citation.authors && (
                                      <span className="text-[10px] text-slate-500 truncate max-w-[140px]">
                                        {citation.authors}
                                      </span>
                                    )}
                                    {citation.year && (
                                      <span className="text-[10px] text-slate-400">
                                        ({citation.year})
                                      </span>
                                    )}
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                      citation.source === 'paper'
                                        ? 'bg-blue-100 text-blue-600'
                                        : 'bg-amber-100 text-amber-600'
                                    }`}>
                                      {citation.source === 'paper' ? 'Paper' : 'Library'}
                                    </span>
                                  </div>
                                </div>
                                
                                {/* Action buttons */}
                                <div className="flex flex-col gap-1">
                                  {citation.source === 'library' ? (
                                    <button
                                      onClick={() => handleImportCitation(citation.id)}
                                      disabled={importingCitation === citation.id}
                                      className="p-1.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors disabled:opacity-50"
                                      title="Import to paper & insert"
                                    >
                                      {importingCitation === citation.id ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3" />
                                      )}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => onInsertCitation?.(citation)}
                                      className="p-1.5 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
                                      title="Insert citation"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  )}
                                  {citation.doi && (
                                    <button
                                      onClick={() => window.open(`https://doi.org/${citation.doi}`, '_blank')}
                                      className="p-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                                      title="View source"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              
                              {/* Citation key for quick copy */}
                              <div className="mt-1.5 flex items-center justify-between">
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(`[${citation.citationKey}]`);
                                  }}
                                  className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                  [{citation.citationKey}]
                                </button>
                                {citation.venue && (
                                  <span className="text-[9px] text-slate-400 truncate max-w-[120px]">
                                    {citation.venue}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : citationCounts.total === 0 ? (
                        <div className="text-center py-4 flex-1 flex flex-col items-center justify-center">
                          <BookOpen className="w-6 h-6 text-slate-300 mb-1" />
                          <p className="text-xs text-slate-500">No citations yet</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Use + button to add via DOI or BibTeX</p>
                        </div>
                      ) : (
                        <div className="text-center py-4 flex-1 flex flex-col items-center justify-center">
                          <Search className="w-5 h-5 text-slate-300 mb-1" />
                          <p className="text-xs text-slate-500">No matches</p>
                        </div>
                      )}

                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer with hints and help */}
              <div className="p-2 border-t border-slate-100 bg-slate-50 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    {isFullscreen ? (
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Minimize2 className="w-3 h-3" /> Press ESC or click minimize to exit
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Move className="w-3 h-3" /> Drag header to move • Drag edges to resize
                        </p>
                        <p className="text-[10px] text-slate-400">
                          <kbd className="px-1 py-0.5 bg-white rounded text-[10px] border">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-white rounded text-[10px] border">.</kbd> toggle
                        </p>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setShowHelp(!showHelp)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      showHelp ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-400'
                    }`}
                    title="Help"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>

                {/* Help Panel */}
                <AnimatePresence>
                  {showHelp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mt-2 overflow-hidden"
                    >
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2 text-xs">
                        <h4 className="font-semibold text-blue-800">Quick Guide</h4>
                        
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <ImageIcon className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Figures</p>
                              <p className="text-blue-600/80">View, insert, and generate figures. Drag thumbnails to insert references.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">AI Assist</p>
                              <p className="text-blue-600/80">Context-aware suggestions based on your content - figures, citations, improvements.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <Wand2 className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Actions</p>
                              <p className="text-blue-600/80">Select text → Rewrite, Expand, Condense, or generate diagrams from it.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <BookOpen className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Citations</p>
                              <p className="text-blue-600/80">Search and insert citations. Click any citation to add [Author, Year] at cursor.</p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-blue-200">
                          <p className="text-blue-600/80">
                            <strong>Tip:</strong> The AI models used can be configured by your administrator in Super Admin → LLM Config.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* Resize Handles - only show when not collapsed and not fullscreen */}
          {!isCollapsed && !isFullscreen && (
            <>
              {/* Left edge resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'left')}
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize group"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Bottom edge resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'bottom')}
                className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize group"
              >
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Corner resize handle (bottom-left) */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'corner')}
                className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize group z-10"
              >
                <div className="absolute bottom-1 left-1 w-2 h-2 border-l-2 border-b-2 border-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* Figure Preview Modal */}
      <AnimatePresence>
        {previewFigure && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setPreviewFigure(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">Figure {previewFigure.figureNo}: {previewFigure.title}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">{previewFigure.description}</p>
                </div>
                <button
                  onClick={() => setPreviewFigure(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {previewFigure.imagePath && (
                <div className="p-4 bg-slate-50">
                  <img
                    src={previewFigure.imagePath}
                    alt={previewFigure.title}
                    className="max-w-full h-auto mx-auto rounded-lg shadow-md"
                  />
                </div>
              )}
              <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPreviewFigure(null)}
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    onInsertFigure?.(previewFigure.id);
                    setPreviewFigure(null);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Insert Figure
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

