'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  LineChart, 
  PieChart, 
  GitBranch, 
  Sparkles, 
  Plus, 
  Trash2, 
  Eye, 
  Download, 
  Loader2,
  Image as ImageIcon,
  Wand2,
  ChevronDown,
  Check,
  X,
  RefreshCw,
  Zap,
  Network,
  Clock,
  Boxes,
  Activity,
  LayoutGrid,
  ArrowRightLeft,
  MessageSquare,
  Send,
  Pencil
} from 'lucide-react';

interface PaperFigurePlannerStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  session?: any;
}

type FigureCategory = 'DATA_CHART' | 'DIAGRAM' | 'STATISTICAL_PLOT' | 'ILLUSTRATION' | 'CUSTOM';

type FigurePlan = {
  id: string;
  figureNo: number;
  title: string;
  caption: string;
  figureType: string;
  category: FigureCategory;
  notes?: string;
  imagePath?: string;
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
  generatedCode?: string;
};

// Figure types with descriptions and visual examples
const FIGURE_OPTIONS = [
  // Data Charts
  { value: 'bar', label: 'Bar Chart', icon: BarChart3, category: 'DATA_CHART', 
    desc: 'Compare values across categories', example: '📊 ▐▐▐ ▐▐ ▐▐▐▐' },
  { value: 'line', label: 'Line Chart', icon: LineChart, category: 'DATA_CHART',
    desc: 'Show trends over time', example: '📈 ╱╲╱╲╱' },
  { value: 'pie', label: 'Pie Chart', icon: PieChart, category: 'DATA_CHART',
    desc: 'Show proportions of a whole', example: '🥧 ◔◔◔' },
  { value: 'scatter', label: 'Scatter Plot', icon: Activity, category: 'DATA_CHART',
    desc: 'Show correlations between variables', example: '⚬ · ⚬ · ⚬' },
  { value: 'radar', label: 'Radar Chart', icon: Network, category: 'DATA_CHART',
    desc: 'Compare multiple variables', example: '◇ ◆ ◇' },
  // Diagrams  
  { value: 'flowchart', label: 'Flowchart', icon: GitBranch, category: 'DIAGRAM',
    desc: 'Process flows & decision trees', example: '□ → ◇ → □' },
  { value: 'sequence', label: 'Sequence Diagram', icon: ArrowRightLeft, category: 'DIAGRAM',
    desc: 'Interactions over time', example: '│→│→│' },
  { value: 'architecture', label: 'Architecture', icon: Boxes, category: 'DIAGRAM',
    desc: 'System components & connections', example: '⬡―⬡―⬡' },
  { value: 'class', label: 'Class Diagram', icon: LayoutGrid, category: 'DIAGRAM',
    desc: 'Object-oriented structure', example: '┌─┐┌─┐' },
  { value: 'er', label: 'ER Diagram', icon: Network, category: 'DIAGRAM',
    desc: 'Entity relationships', example: '○─◇─○' },
  { value: 'gantt', label: 'Gantt Chart', icon: Clock, category: 'DIAGRAM',
    desc: 'Project timeline', example: '▬▬▬ ▬▬' },
];

const CATEGORY_COLORS: Record<FigureCategory, string> = {
  DATA_CHART: 'bg-sky-500',
  DIAGRAM: 'bg-violet-500',
  STATISTICAL_PLOT: 'bg-emerald-500',
  ILLUSTRATION: 'bg-amber-500',
  CUSTOM: 'bg-slate-500'
};

export default function PaperFigurePlannerStage({ 
  sessionId, 
  authToken, 
  onSessionUpdated,
  session 
}: PaperFigurePlannerStageProps) {
  const [figures, setFigures] = useState<FigurePlan[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [previewFigure, setPreviewFigure] = useState<FigurePlan | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Modification request state
  const [modificationRequest, setModificationRequest] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [showModifyInput, setShowModifyInput] = useState(false);
  
  // Simple form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [figureType, setFigureType] = useState('bar');
  const [category, setCategory] = useState<FigureCategory>('DATA_CHART');

  // Calculate next figure number
  const nextFigureNo = useMemo(() => {
    if (figures.length === 0) return 1;
    return Math.max(...figures.map(fig => fig.figureNo)) + 1;
  }, [figures]);

  const selectedType = FIGURE_OPTIONS.find(t => t.value === figureType);

  // Load figures
  const loadFigures = useCallback(async () => {
    if (!authToken || !sessionId) return;
    try {
    const response = await fetch(`/api/papers/${sessionId}/figures`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    setFigures(data.figures || []);
    } catch (error) {
      console.error('Failed to load figures:', error);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    if (sessionId && authToken) {
      loadFigures();
    }
  }, [sessionId, authToken, loadFigures]);

  // Create figure
  const handleCreate = async () => {
    if (!authToken || !title.trim()) return;
    
    setIsCreating(true);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title,
          caption: description,
          figureType,
          category,
          notes: description,
          figureNo: nextFigureNo,
          status: 'PLANNED'
        })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      setFigures(prev => [...prev, data.figure]);
      setTitle('');
      setDescription('');
    } catch (err) {
      console.error('Failed to create figure:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // Generate figure
  const handleGenerate = async (figure: FigurePlan) => {
    if (!authToken) return;
    
    setGenerating(figure.id);
    setFigures(prev => prev.map(f => 
      f.id === figure.id ? { ...f, status: 'GENERATING' as const } : f
    ));

    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${figure.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          figureType: figure.figureType,
          category: figure.category,
          title: figure.title,
          caption: figure.caption,
          description: figure.notes || figure.caption,
          theme: 'academic',
          useLLM: true
        })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);

      setFigures(prev => prev.map(f => 
        f.id === figure.id 
          ? { ...f, status: 'GENERATED' as const, imagePath: data.imagePath } 
          : f
      ));
    } catch (err) {
      setFigures(prev => prev.map(f => 
        f.id === figure.id ? { ...f, status: 'FAILED' as const } : f
      ));
    } finally {
      setGenerating(null);
    }
  };

  // Delete figure
  const handleDelete = async (figureId: string) => {
    if (!authToken) return;
    try {
      await fetch(`/api/papers/${sessionId}/figures/${figureId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
      setFigures(prev => prev.filter(f => f.id !== figureId));
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  // Get AI suggestions
  const handleGetSuggestions = async () => {
    if (!authToken) return;
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/suggest`, {
        method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
          paperTitle: session?.researchTopic?.title || '',
          paperAbstract: session?.researchTopic?.abstract || '',
          sections: session?.annexureDrafts?.[0]?.extraSections || {},
          useLLM: true
      })
    });
      
    const data = await response.json();
      if (response.ok) {
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Apply suggestion
  const applySuggestion = (suggestion: any) => {
    setTitle(suggestion.title);
    setDescription(suggestion.description);
    setFigureType(suggestion.suggestedType || 'flowchart');
    setCategory(suggestion.category || 'DIAGRAM');
    setShowSuggestions(false);
  };

  // Handle modification request - regenerate with user feedback
  const handleModify = async (figure: FigurePlan) => {
    if (!authToken || !modificationRequest.trim()) return;
    
    setIsModifying(true);
    setFigures(prev => prev.map(f => 
      f.id === figure.id ? { ...f, status: 'GENERATING' as const } : f
    ));

    try {
      // Combine original description with modification request
      const enhancedDescription = `
Original request: ${figure.notes || figure.caption || figure.title}

User modification request: ${modificationRequest}

Please regenerate the figure incorporating the user's feedback and corrections.
`.trim();

      const response = await fetch(`/api/papers/${sessionId}/figures/${figure.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          figureType: figure.figureType,
          category: figure.category,
          title: figure.title,
          caption: figure.caption,
          description: enhancedDescription,
          modificationRequest: modificationRequest, // Pass explicitly for logging
          theme: 'academic',
          useLLM: true
        })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);

      setFigures(prev => prev.map(f => 
        f.id === figure.id 
          ? { ...f, status: 'GENERATED' as const, imagePath: data.imagePath } 
          : f
      ));
      
      // Update preview with new image
      setPreviewFigure(prev => prev?.id === figure.id 
        ? { ...prev, status: 'GENERATED' as const, imagePath: data.imagePath }
        : prev
      );
      
      // Clear modification input
      setModificationRequest('');
      setShowModifyInput(false);
    } catch (err) {
      console.error('Modification failed:', err);
      setFigures(prev => prev.map(f => 
        f.id === figure.id ? { ...f, status: 'FAILED' as const } : f
      ));
    } finally {
      setIsModifying(false);
    }
  };

  // Handle type selection
  const selectType = (option: typeof FIGURE_OPTIONS[0]) => {
    setFigureType(option.value);
    setCategory(option.category as FigureCategory);
    setShowTypeDropdown(false);
  };

  const plannedFigures = figures.filter(f => f.status === 'PLANNED' || f.status === 'FAILED');
  const generatedFigures = figures.filter(f => f.status === 'GENERATED');

  return (
    <div className="min-h-[600px] bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Clean Header */}
      <div className="px-6 py-8 border-b border-slate-100">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                Figures
              </h1>
              <p className="text-slate-500 mt-1">
                Create beautiful charts and diagrams for your paper
              </p>
            </div>

            {/* AI Suggestions Button */}
            <Button 
              variant="outline" 
              onClick={handleGetSuggestions}
              disabled={loadingSuggestions}
              className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300"
            >
              {loadingSuggestions ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              AI Suggestions
            </Button>
          </div>
          
          {/* Stats Row */}
          <div className="flex gap-6 mt-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-sm text-slate-600">{plannedFigures.length} planned</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm text-slate-600">{generatedFigures.length} generated</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Create New Figure - Clean Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-8">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Plus className="w-5 h-5 text-white" />
              </div>
                    <div>
                <h2 className="font-semibold text-slate-900">New Figure</h2>
                <p className="text-sm text-slate-500">Describe what you want to visualize</p>
                      </div>
                    </div>

            <div className="space-y-4">
              {/* Type Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowTypeDropdown(!showTypeDropdown)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {selectedType && (
                      <>
                        <div className={`w-9 h-9 rounded-lg ${CATEGORY_COLORS[category]} flex items-center justify-center`}>
                          <selectedType.icon className="w-4 h-4 text-white" />
                        </div>
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800">{selectedType.label}</span>
                            <span className="text-slate-400 text-sm font-mono">{selectedType.example}</span>
                          </div>
                          <span className="text-xs text-slate-500">{selectedType.desc}</span>
                    </div>
                      </>
                    )}
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {showTypeDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-20 w-full mt-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
                    >
                      {/* Scrollable dropdown container */}
                      <div className="max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                        {/* Charts Section */}
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 sticky top-0">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Charts</span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'DATA_CHART').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 ${figureType === option.value ? 'bg-blue-50' : ''}`}
                          >
                            <div className={`w-9 h-9 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
          </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-blue-600 shrink-0" />
                            )}
                          </button>
                        ))}
                        
                        {/* Diagrams Section */}
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 sticky top-0">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Diagrams</span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'DIAGRAM').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 ${figureType === option.value ? 'bg-violet-50' : ''}`}
                          >
                            <div className={`w-9 h-9 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-violet-600 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Title */}
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Figure title (e.g., Performance Comparison)"
                className="h-12 rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400"
              />

              {/* Description */}
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what you want to show... (AI will generate the figure based on this)"
                rows={3}
                className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400 resize-none"
              />

              {/* Create Button */}
              <Button 
                onClick={handleCreate}
                disabled={isCreating || !title.trim()}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium shadow-lg shadow-blue-500/25"
              >
                {isCreating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-5 h-5 mr-2" />
                    Add Figure
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Figures List */}
        {figures.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-medium text-slate-700 px-1">Your Figures</h3>
            
            <div className="space-y-3">
              <AnimatePresence>
                {figures.map((figure) => {
                  const typeInfo = FIGURE_OPTIONS.find(t => t.value === figure.figureType);
                  const Icon = typeInfo?.icon || ImageIcon;
                  const isGenerating = generating === figure.id;
                  
                  return (
                    <motion.div
                      key={figure.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-stretch">
                        {/* Thumbnail */}
                        <div 
                          className="w-24 h-24 bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
                          onClick={() => figure.imagePath && setPreviewFigure(figure)}
                        >
                          {figure.status === 'GENERATING' ? (
                            <div className="flex flex-col items-center gap-1">
                              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                              <span className="text-[10px] text-slate-400">Generating</span>
                            </div>
                          ) : figure.imagePath ? (
                            <img 
                              src={figure.imagePath} 
                              alt={figure.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Icon className="w-8 h-8 text-slate-300" />
                          )}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 p-4 flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-400">Fig. {figure.figureNo}</span>
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                figure.status === 'GENERATED' ? 'bg-emerald-500' :
                                figure.status === 'GENERATING' ? 'bg-blue-500 animate-pulse' :
                                figure.status === 'FAILED' ? 'bg-red-500' :
                                'bg-slate-300'
                              }`} />
                            </div>
                            <h4 className="font-medium text-slate-900 truncate">{figure.title}</h4>
                            <p className="text-sm text-slate-500 truncate">{figure.caption}</p>
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-1 ml-4">
                            {figure.status === 'PLANNED' && (
                              <Button
                                size="sm"
                                onClick={() => handleGenerate(figure)}
                                disabled={isGenerating}
                                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                Generate
                              </Button>
                            )}
                            {figure.status === 'GENERATED' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setPreviewFigure(figure)}
                                  className="rounded-lg"
                                  title="View"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setPreviewFigure(figure);
                                    setShowModifyInput(true);
                                  }}
                                  className="rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  title="Request modifications"
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleGenerate(figure)}
                                  className="rounded-lg"
                                  title="Regenerate"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {figure.status === 'FAILED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleGenerate(figure)}
                                className="rounded-lg text-red-600 border-red-200 hover:bg-red-50"
                              >
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Retry
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(figure.id)}
                              className="rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                </Button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            
            {/* Generate All Button */}
            {plannedFigures.length > 1 && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => plannedFigures.forEach(f => handleGenerate(f))}
                  disabled={!!generating}
                  className="rounded-xl gap-2"
                >
                  <Wand2 className="w-4 h-4" />
                  Generate All ({plannedFigures.length})
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {figures.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <ImageIcon className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">No figures yet</h3>
            <p className="text-slate-500 mt-1">Create your first figure above or get AI suggestions</p>
          </div>
        )}
      </div>

      {/* AI Suggestions Dialog */}
      <Dialog open={showSuggestions} onOpenChange={setShowSuggestions}>
        <DialogContent className="max-w-xl bg-white border-0 shadow-2xl rounded-2xl">
          <DialogHeader className="pb-4 border-b border-slate-100">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-5 h-5 text-amber-500" />
              AI Suggestions
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            {loadingSuggestions ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-3" />
                <p className="text-slate-600">Analyzing your paper...</p>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-12 text-center">
                <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No suggestions yet</p>
                <p className="text-sm text-slate-400 mt-1">Add more content to your paper</p>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => applySuggestion(suggestion)}
                    className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={`${CATEGORY_COLORS[suggestion.category as FigureCategory] || 'bg-slate-500'} text-white text-[10px]`}>
                            {suggestion.category?.replace('_', ' ')}
                          </Badge>
                          {suggestion.importance === 'recommended' && (
                            <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">
                              Recommended
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-medium text-slate-900 group-hover:text-amber-700">{suggestion.title}</h4>
                        <p className="text-sm text-slate-500 mt-1 line-clamp-2">{suggestion.description}</p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-amber-200 flex items-center justify-center shrink-0 transition-colors">
                        <Plus className="w-4 h-4 text-slate-500 group-hover:text-amber-700" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog with Modification Feature */}
      <Dialog open={!!previewFigure} onOpenChange={(open) => {
        if (!open) {
          setPreviewFigure(null);
          setShowModifyInput(false);
          setModificationRequest('');
        }
      }}>
        <DialogContent className="max-w-3xl bg-white border-0 shadow-2xl rounded-2xl">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-xl">
              Figure {previewFigure?.figureNo}: {previewFigure?.title}
            </DialogTitle>
            <p className="text-slate-500 text-sm mt-1">{previewFigure?.caption}</p>
          </DialogHeader>
          
          {/* Figure Preview */}
          {previewFigure?.imagePath && (
            <div className="bg-slate-50 rounded-xl p-6 relative">
              {isModifying && (
                <div className="absolute inset-0 bg-white/80 rounded-xl flex flex-col items-center justify-center z-10">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                  <p className="text-slate-600 font-medium">Regenerating with your changes...</p>
                  <p className="text-slate-400 text-sm">This may take a moment</p>
                </div>
              )}
              <img 
                src={previewFigure.imagePath} 
                alt={previewFigure.title}
                className="max-w-full h-auto mx-auto rounded-lg shadow-sm"
              />
            </div>
          )}
          
          {/* Modification Request Section */}
          <div className="border-t border-slate-100 pt-4">
            {!showModifyInput ? (
              <button
                onClick={() => setShowModifyInput(true)}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-500 hover:text-blue-600 transition-colors group"
              >
                <Pencil className="w-4 h-4" />
                <span className="font-medium">Request modifications</span>
                <span className="text-slate-400 group-hover:text-blue-400 text-sm">(AI will regenerate based on your feedback)</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">What would you like to change?</span>
                </div>
                <Textarea
                  value={modificationRequest}
                  onChange={e => setModificationRequest(e.target.value)}
                  placeholder="E.g., Make the bars blue instead of green, add a legend on the right side, increase font size for labels, change the title to..."
                  rows={3}
                  className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400 resize-none"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => previewFigure && handleModify(previewFigure)}
                    disabled={isModifying || !modificationRequest.trim()}
                    className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white gap-2"
                  >
                    {isModifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Apply Changes
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowModifyInput(false);
                      setModificationRequest('');
                    }}
                    disabled={isModifying}
                    className="rounded-xl"
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-slate-400 text-center">
                  AI will regenerate the figure incorporating your feedback
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={() => {
              setPreviewFigure(null);
              setShowModifyInput(false);
              setModificationRequest('');
            }} className="rounded-lg">
              Close
            </Button>
            <Button 
              variant="outline"
              onClick={() => previewFigure && handleGenerate(previewFigure)}
              disabled={isModifying}
              className="rounded-lg gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </Button>
            <Button asChild className="rounded-lg bg-slate-900 hover:bg-slate-800">
              <a href={previewFigure?.imagePath} download className="gap-2">
                <Download className="w-4 h-4" /> Download
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
