'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  Connection,
  Node,
  Edge,
  NodeTypes,
  MarkerType,
} from '@xyflow/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Plus,
  Play,
  Loader2,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Target,
  Layers,
  Zap,
  Search,
  FileText,
  ArrowRight,
  X,
  Settings,
  RefreshCw,
  Download,
  Edit3,
  ChevronLeft,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

// Import custom nodes
import SeedNode from './nodes/SeedNode'
import DimensionNode from './nodes/DimensionNode'
import OperatorNode from './nodes/OperatorNode'
import IdeaNode from './nodes/IdeaNode'
import CombineTray from './CombineTray'
import IdeaFramePanel from './IdeaFramePanel'

interface IdeationWorkspaceProps {
  onExportToBank: () => void
}

// Session status stages
type SessionStage = 
  | 'idle'           // Initial - no session
  | 'seed_input'     // Editing seed (new or returning to edit)
  | 'normalizing'    // Processing - analyzing seed
  | 'clarifying'     // Input needed - questions from AI
  | 'classifying'    // Processing - classifying invention
  | 'expanding'      // Processing - building dimensions
  | 'exploring'      // Workspace - user explores mind map
  | 'generating'     // Processing - creating ideas
  | 'reviewing'      // Workspace - reviewing ideas

// Helper to determine which view to show
const isInputView = (stage: SessionStage) => 
  ['idle', 'seed_input', 'clarifying'].includes(stage)

const isProcessingView = (stage: SessionStage) =>
  ['normalizing', 'classifying', 'expanding', 'generating'].includes(stage)

const isWorkspaceView = (stage: SessionStage) =>
  ['exploring', 'reviewing'].includes(stage)

interface IdeationSession {
  id: string
  status: string
  seedText: string
  seedGoal?: string
  seedConstraints: string[]
  normalization?: any
  classification?: any
}

interface IdeaFrame {
  id: string
  title: string
  problem: string
  principle: string
  technicalEffect?: string
  status: string
  noveltyScore?: number
  userRating?: number
  data?: any
}

const nodeTypes: NodeTypes = {
  seed: SeedNode,
  dimension: DimensionNode,
  operator: OperatorNode,
  idea: IdeaNode,
}

export default function IdeationWorkspace({ onExportToBank }: IdeationWorkspaceProps) {
  // Session state
  const [sessions, setSessions] = useState<any[]>([])
  const [currentSession, setCurrentSession] = useState<IdeationSession | null>(null)
  const [stage, setStage] = useState<SessionStage>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Input state
  const [seedText, setSeedText] = useState('')
  const [seedGoal, setSeedGoal] = useState('')
  const [seedConstraints, setSeedConstraints] = useState<string[]>([])
  const [newConstraint, setNewConstraint] = useState('')
  
  // Clarifying questions state
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<number, string>>({})
  
  // Edit mode - to preserve selections when regenerating
  const [preservedSelections, setPreservedSelections] = useState<Set<string>>(new Set())

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<ReactFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  // Selection state for combine tray
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  
  // Collapsed nodes state
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  
  // Idea frames
  const [ideaFrames, setIdeaFrames] = useState<IdeaFrame[]>([])
  const [selectedIdea, setSelectedIdea] = useState<IdeaFrame | null>(null)
  const [showIdeaPanel, setShowIdeaPanel] = useState(false)

  // Combine tray visibility
  const [showTray, setShowTray] = useState(false)

  // Auto-fit view when nodes change
  const fitViewToNodes = useCallback(() => {
    if (reactFlowInstance && nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          duration: 300,
          maxZoom: 1.2,
        })
      }, 100)
    }
  }, [reactFlowInstance, nodes.length])

  // Load existing sessions
  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSessions(data.sessions || [])
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  const loadSession = async (sessionId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        
        // Load graph nodes and edges
        if (data.graph) {
          setNodes(data.graph.nodes.map((n: any) => ({
            id: n.id,
            type: getNodeType(n.type),
            position: n.position,
            data: n.data,
          })))
          setEdges(data.graph.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: e.animated,
            markerEnd: { type: MarkerType.ArrowClosed },
          })))
        }

        // Load idea frames
        if (data.ideaFrames) {
          setIdeaFrames(data.ideaFrames)
        }

        // Set stage based on session status
        setStage(mapStatusToStage(data.session.status))
        
        // Auto-fit view after loading
        setTimeout(() => fitViewToNodes(), 200)
      }
    } catch (e) {
      setError('Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  const getNodeType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'SEED': 'seed',
      'DIMENSION_FAMILY': 'dimension',
      'DIMENSION_OPTION': 'dimension',
      'OPERATOR': 'operator',
      'IDEA_FRAME': 'idea',
      'COMPONENT': 'dimension',
      'CONSTRAINT': 'dimension',
    }
    return typeMap[type] || 'default'
  }

  const mapStatusToStage = (status: string): SessionStage => {
    const stageMap: Record<string, SessionStage> = {
      'SEED_INPUT': 'seed_input',
      'CLARIFYING': 'clarifying',
      'CLASSIFYING': 'classifying',
      'EXPANDING': 'expanding',
      'EXPLORING': 'exploring',
      'GENERATING': 'generating',
      'REVIEWING': 'reviewing',
    }
    return stageMap[status] || 'idle'
  }

  // Create new session
  const handleCreateSession = async () => {
    if (!seedText.trim()) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          seedText: seedText.trim(),
          seedGoal: seedGoal.trim() || undefined,
          seedConstraints: seedConstraints.filter(c => c.trim()),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        setStage('seed_input')
        
        // Create seed node
        const seedNode: ReactFlowNode = {
          id: 'seed-root',
          type: 'seed',
          position: { x: 400, y: 100 },
          data: {
            title: seedText.slice(0, 100),
            description: seedText,
            state: 'EXPANDED',
          },
        }
        setNodes([seedNode])

        // Start normalization
        await handleNormalize(data.session.id)
      } else {
        const err = await response.json()
        setError(err.error || 'Failed to create session')
      }
    } catch (e) {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  // Normalize seed
  const handleNormalize = async (sessionId: string) => {
    setStage('normalizing')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/normalize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, normalization: data.normalization } : null)
        
        if (data.hasUnknowns) {
          setStage('clarifying')
        } else {
          await handleClassify(sessionId)
        }
      } else {
        throw new Error('Normalization failed')
      }
    } catch (e) {
      setError('Failed to normalize seed')
      setStage('seed_input')
    }
  }

  // Classify invention
  const handleClassify = async (sessionId: string) => {
    setStage('classifying')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/classify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, classification: data.classification } : null)
        
        // Initialize dimensions
        await handleInitializeDimensions(sessionId)
      } else {
        throw new Error('Classification failed')
      }
    } catch (e) {
      setError('Failed to classify invention')
      setStage('seed_input')
    }
  }

  // Initialize dimensions
  const handleInitializeDimensions = async (sessionId: string) => {
    setStage('expanding')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ action: 'initialize' }),
      })

      if (response.ok) {
        // Reload full session to get updated graph
        await loadSession(sessionId)
        setStage('exploring')
        setShowTray(true)
        
        // Restore preserved selections if any
        if (preservedSelections.size > 0) {
          setSelectedNodes(preservedSelections)
          setPreservedSelections(new Set())
        }
      } else {
        throw new Error('Failed to initialize dimensions')
      }
    } catch (e) {
      setError('Failed to initialize dimensions')
    }
  }

  // Go back to edit seed (preserving current selections)
  const handleEditSeed = () => {
    // Preserve current selections for when we regenerate
    if (selectedNodes.size > 0) {
      setPreservedSelections(new Set(selectedNodes))
    }
    
    // Populate form with current session data
    if (currentSession) {
      setSeedText(currentSession.seedText)
      setSeedGoal(currentSession.seedGoal || '')
      setSeedConstraints(currentSession.seedConstraints || [])
    }
    
    // Go back to seed input
    setStage('seed_input')
    setShowTray(false)
    setShowIdeaPanel(false)
  }

  // Submit clarifying answers and continue
  const handleSubmitClarifyingAnswers = async () => {
    if (!currentSession) return
    
    const questions = currentSession.normalization?.unknownsToAsk as string[] || []
    
    // If there are answers, combine with seed text
    if (Object.keys(clarifyingAnswers).length > 0 && questions.length > 0) {
      const answersText = Object.entries(clarifyingAnswers)
        .map(([idx, answer]) => {
          const question = questions[parseInt(idx)]
          return question && answer ? `Q: ${question}\nA: ${answer}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
      
      if (answersText) {
        // Update seed text with additional context from answers
        const updatedSeedText = seedText + '\n\nAdditional clarifications:\n' + answersText
        setSeedText(updatedSeedText)
      }
    }
    
    // Clear answers and proceed to classification
    setClarifyingAnswers({})
    await handleClassify(currentSession.id)
  }

  // Expand a node
  const handleExpandNode = async (nodeId: string) => {
    if (!currentSession) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ action: 'expand', nodeId }),
      })

      if (response.ok) {
        await loadSession(currentSession.id)
      }
    } catch (e) {
      setError('Failed to expand node')
    }
  }

  // Toggle node selection
  const handleNodeSelect = (nodeId: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  // Bucket type for multi-bucket generation
  interface IdeaBucket {
    id: string
    name: string
    dimensionIds: string[]
  }

  // Generate ideas - operators now come from tray selection, not mind map
  const handleGenerateIdeas = async (
    count: number = 5, 
    intent: string = 'DIVERGENT', 
    selectedOperatorIds: string[] = [],
    buckets?: IdeaBucket[]
  ) => {
    if (!currentSession) return

    setStage('generating')
    setLoading(true)
    try {
      // Get selected dimension nodes from mind map
      const selectedNodeData = nodes.filter(n => selectedNodes.has(n.id))
      const components = selectedNodeData.filter(n => (n.data as any)?.type === 'COMPONENT').map(n => n.id)
      const dimensions = selectedNodeData.filter(n => 
        (n.data as any)?.type === 'DIMENSION_FAMILY' || (n.data as any)?.type === 'DIMENSION_OPTION'
      ).map(n => n.id)

      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          recipe: {
            selectedComponents: components,
            selectedDimensions: [...dimensions, ...Array.from(selectedNodes).filter(id => 
              !components.includes(id)
            )],
            selectedOperators: selectedOperatorIds, // Operators from tray selection
            recipeIntent: intent,
            count,
            buckets: buckets || null, // Pass buckets if using multi-bucket mode
          },
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // Reload session to get idea frames
        await loadSession(currentSession.id)
        setStage('reviewing')
        setShowIdeaPanel(true)
      } else {
        throw new Error('Failed to generate ideas')
      }
    } catch (e) {
      setError('Failed to generate ideas')
      setStage('exploring')
    } finally {
      setLoading(false)
    }
  }

  // Check novelty
  const handleCheckNovelty = async (ideaFrameId: string) => {
    if (!currentSession) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/novelty`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ ideaFrameId }),
      })

      if (response.ok) {
        await loadSession(currentSession.id)
      }
    } catch (e) {
      setError('Failed to check novelty')
    }
  }

  // Export to idea bank
  const handleExportToBank = async (ideaFrameIds: string[]) => {
    if (!currentSession || ideaFrameIds.length === 0) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ ideaFrameIds }),
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Successfully exported ${data.exportedCount} idea(s) to Idea Bank!`)
        onExportToBank()
      }
    } catch (e) {
      setError('Failed to export to Idea Bank')
    }
  }

  // Handle edge connection
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, eds)),
    [setEdges]
  )

  // Node click handler - single click to select
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Don't select seed nodes
    if (node.type === 'seed') return
    
    // Toggle selection
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) {
        next.delete(node.id)
      } else {
        next.add(node.id)
      }
      return next
    })
  }, [])

  // Node double click to expand
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.data?.state === 'COLLAPSED') {
      handleExpandNode(node.id)
    }
  }, [currentSession])

  // Add constraint
  const handleAddConstraint = () => {
    if (newConstraint.trim()) {
      setSeedConstraints(prev => [...prev, newConstraint.trim()])
      setNewConstraint('')
    }
  }

  // Remove constraint
  const handleRemoveConstraint = (index: number) => {
    setSeedConstraints(prev => prev.filter((_, i) => i !== index))
  }

  // Reset workspace
  const handleReset = () => {
    setCurrentSession(null)
    setStage('idle')
    setSeedText('')
    setSeedGoal('')
    setSeedConstraints([])
    setNodes([])
    setEdges([])
    setSelectedNodes(new Set())
    setIdeaFrames([])
    setShowTray(false)
    setShowIdeaPanel(false)
    setError(null)
  }

  // ===== INPUT VIEW =====
  // Shows for: idle, seed_input, clarifying stages
  if (isInputView(stage) || (!currentSession && stage !== 'normalizing')) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl"
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 mb-4 shadow-lg shadow-violet-500/25">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              Patent Ideation Engine
            </h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Transform your invention concept into structured, patent-ready ideas 
              using AI-powered mind mapping and TRIZ operators.
            </p>
          </div>

          {/* Stage Indicator */}
          {currentSession && (
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm">
                {['Input', 'Analyze', 'Build', 'Explore'].map((step, idx) => {
                  const stageIdx = stage === 'idle' || stage === 'seed_input' ? 0 :
                                   stage === 'clarifying' ? 0 :
                                   stage === 'normalizing' || stage === 'classifying' ? 1 :
                                   stage === 'expanding' ? 2 : 3
                  const isActive = idx === stageIdx
                  const isComplete = idx < stageIdx
                  
                  return (
                    <div key={step} className="flex items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold
                        ${isComplete ? 'bg-green-500 text-white' : 
                          isActive ? 'bg-violet-500 text-white' : 
                          'bg-slate-200 text-slate-500'}`}>
                        {isComplete ? '✓' : idx + 1}
                      </div>
                      <span className={`text-xs ml-1 ${isActive ? 'font-semibold text-violet-700' : 'text-slate-500'}`}>
                        {step}
                      </span>
                      {idx < 3 && <ChevronRight className="w-3 h-3 text-slate-300 mx-1" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Input Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
            <div className="p-6 space-y-6">
              {/* Seed Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Describe Your Invention
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <Textarea
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                  placeholder="Example: A disposable syringe that prevents reuse by breaking the plunger after first use, using only mechanical means without electronics..."
                  rows={4}
                  className="w-full bg-slate-50 border-slate-200 focus:border-violet-500 focus:ring-violet-500/20 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
                <p className="text-xs text-slate-400 mt-2">
                  Minimum 10 characters. Be specific about the problem and desired solution.
                </p>
              </div>

              {/* Goal Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Primary Goal
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <Input
                  value={seedGoal}
                  onChange={(e) => setSeedGoal(e.target.value)}
                  placeholder="Example: Prevent needle reuse while keeping manufacturing cost under $0.10"
                  className="bg-slate-50 border-slate-200 focus:border-violet-500 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
              </div>

              {/* Constraints */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Constraints
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newConstraint}
                    onChange={(e) => setNewConstraint(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddConstraint()}
                    placeholder="Add a constraint (e.g., 'no electronics')"
                    className="bg-slate-50 border-slate-200 focus:border-violet-500 rounded-xl"
                    disabled={stage === 'clarifying'}
                  />
                  <Button
                    onClick={handleAddConstraint}
                    variant="outline"
                    className="rounded-xl"
                    disabled={stage === 'clarifying'}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {seedConstraints.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {seedConstraints.map((constraint, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="bg-violet-50 text-violet-700 hover:bg-violet-100 cursor-pointer"
                        onClick={() => stage !== 'clarifying' && handleRemoveConstraint(i)}
                      >
                        {constraint}
                        {stage !== 'clarifying' && <X className="w-3 h-3 ml-1" />}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* ===== CLARIFYING QUESTIONS SECTION ===== */}
              {stage === 'clarifying' && (
                <div className="border-t border-slate-200 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">AI Has Questions</h3>
                      <p className="text-xs text-slate-500">Help refine your invention concept</p>
                    </div>
                  </div>
                  
                  {/* Display questions with input fields */}
                  {currentSession?.normalization?.unknownsToAsk && 
                   (currentSession.normalization.unknownsToAsk as string[]).length > 0 ? (
                    <div className="space-y-4">
                      {(currentSession.normalization.unknownsToAsk as string[]).map((question: string, idx: number) => (
                        <div key={idx} className="p-4 bg-amber-50/50 rounded-xl border border-amber-100">
                          <label className="block text-sm font-medium text-amber-800 mb-2">
                            Q{idx + 1}: {question}
                          </label>
                          <Textarea
                            value={clarifyingAnswers[idx] || ''}
                            onChange={(e) => setClarifyingAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                            placeholder="Type your answer here..."
                            rows={2}
                            className="w-full bg-white border-amber-200 focus:border-amber-500 focus:ring-amber-500/20 rounded-lg text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl text-center text-slate-500">
                      <p>The AI is ready to proceed. Click continue to build the mind map.</p>
                    </div>
                  )}
                  
                  {/* Action Buttons for Clarifying Stage */}
                  <div className="flex gap-3 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Go back to seed input to allow editing
                        setStage('seed_input')
                        setClarifyingAnswers({})
                      }}
                      className="flex-1"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Edit Input
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => currentSession && handleClassify(currentSession.id)}
                      className="flex-1"
                    >
                      Skip & Continue
                    </Button>
                    <Button
                      onClick={handleSubmitClarifyingAnswers}
                      disabled={Object.keys(clarifyingAnswers).length === 0 && 
                        (currentSession?.normalization?.unknownsToAsk as string[] || []).length > 0}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      {Object.keys(clarifyingAnswers).length > 0 ? 'Submit & Continue' : 'Continue'}
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                  <button 
                    onClick={() => setError(null)}
                    className="ml-auto hover:bg-red-100 rounded p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Action Footer - Different states */}
            <div className="bg-slate-50 px-6 py-4 flex items-center justify-between border-t border-slate-100">
              <div className="text-sm text-slate-500">
                {currentSession ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Session Active
                  </span>
                ) : sessions.length > 0 ? (
                  <span>{sessions.length} previous session(s)</span>
                ) : (
                  <span>Ready to start</span>
                )}
              </div>
              
              {/* Main Action Buttons based on stage */}
              {stage === 'idle' || stage === 'seed_input' ? (
                <div className="flex gap-2">
                  {currentSession && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Resume to mind map if we have dimensions
                        if (nodes.length > 1) {
                          setStage('exploring')
                          setShowTray(true)
                        } else {
                          // Otherwise start fresh analysis
                          handleNormalize(currentSession.id)
                        }
                      }}
                      className="rounded-xl"
                    >
                      {nodes.length > 1 ? (
                        <>
                          <ArrowRight className="w-4 h-4 mr-2" />
                          Go to Mind Map
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Continue Analysis
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={handleCreateSession}
                    disabled={seedText.trim().length < 10 || loading}
                    className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-xl px-6 shadow-lg shadow-violet-500/25"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : currentSession ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Restart Fresh
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Ideation
                      </>
                    )}
                  </Button>
                </div>
              ) : null /* Clarifying stage has its own buttons above */}
            </div>
          </div>

          {/* Previous Sessions */}
          {sessions.length > 0 && !currentSession && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Previous Sessions</h3>
              <div className="space-y-2">
                {sessions.slice(0, 5).map((session) => (
                  <button
                    key={session.id}
                    onClick={() => loadSession(session.id)}
                    className="w-full text-left p-3 bg-white rounded-xl border border-slate-200 hover:border-violet-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900 truncate">
                        {session.seedText.slice(0, 50)}...
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {session.ideaCount} ideas
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    )
  }

  // ===== PROCESSING VIEW (Loading Overlay) =====
  // Shows for: normalizing, classifying, expanding, generating stages
  if (isProcessingView(stage)) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md text-center"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-8">
            <Loader2 className="w-16 h-16 animate-spin text-violet-500 mx-auto mb-6" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              {stage === 'normalizing' && 'Analyzing Your Invention'}
              {stage === 'classifying' && 'Classifying Invention Type'}
              {stage === 'expanding' && 'Building Mind Map'}
              {stage === 'generating' && 'Generating Ideas'}
            </h3>
            <p className="text-slate-500 mb-6">
              {stage === 'normalizing' && 'Extracting key components and concepts...'}
              {stage === 'classifying' && 'Identifying invention category and archetypes...'}
              {stage === 'expanding' && 'Creating dimension families and options...'}
              {stage === 'generating' && 'Combining dimensions with TRIZ operators...'}
            </p>
            
            {/* Progress Steps */}
            <div className="flex justify-center gap-2 mb-6">
              {['Analyze', 'Classify', 'Build'].map((step, idx) => {
                const currentIdx = stage === 'normalizing' ? 0 : 
                                   stage === 'classifying' ? 1 : 2
                return (
                  <div key={step} className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all
                      ${idx < currentIdx ? 'bg-green-500 text-white' : 
                        idx === currentIdx ? 'bg-violet-500 text-white animate-pulse' : 
                        'bg-slate-200 text-slate-500'}`}>
                      {idx < currentIdx ? '✓' : idx + 1}
                    </div>
                    {idx < 2 && <div className={`w-8 h-0.5 ${idx < currentIdx ? 'bg-green-500' : 'bg-slate-200'}`} />}
                  </div>
                )
              })}
            </div>

            {/* Cancel Button */}
            <Button
              variant="outline"
              onClick={handleReset}
              className="text-slate-500"
            >
              Cancel
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  // ===== WORKSPACE VIEW (Mind Map) =====
  // Shows for: exploring, reviewing stages
  return (
    <div className="h-[calc(100vh-80px)] flex">
      {/* React Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes
            .filter(n => {
              // Hide children of collapsed nodes
              const parentId = ((n.data as any)?.parentId || (n.data as any)?.parentNodeId) as string | undefined
              if (parentId && collapsedNodes.has(parentId)) {
                return false
              }
              return true
            })
            .map(n => ({
              ...n,
              data: {
                ...n.data,
                selected: selectedNodes.has(n.id),
                collapsed: collapsedNodes.has(n.id),
                hasChildren: nodes.some(child => {
                  const parentId = (child.data as any)?.parentId || (child.data as any)?.parentNodeId
                  return parentId === n.id
                }),
                onSelect: () => {
                  if (n.type !== 'seed') {
                    setSelectedNodes(prev => {
                      const next = new Set(prev)
                      if (next.has(n.id)) {
                        next.delete(n.id)
                      } else {
                        next.add(n.id)
                      }
                      return next
                    })
                  }
                },
                onExpand: () => handleExpandNode(n.id),
                onCollapse: () => {
                  setCollapsedNodes(prev => {
                    const next = new Set(prev)
                    if (next.has(n.id)) {
                      next.delete(n.id)
                    } else {
                      next.add(n.id)
                    }
                    return next
                  })
                },
              },
            }))}
          edges={edges
            .filter(e => {
              // Hide edges to collapsed children
              const targetNode = nodes.find(n => n.id === e.target)
              const parentNodeId = ((targetNode?.data as any)?.parentId || (targetNode?.data as any)?.parentNodeId) as string | undefined
              if (parentNodeId && collapsedNodes.has(parentNodeId)) {
                return false
              }
              return true
            })
            .map(e => {
              // Animate edges between selected nodes
              const sourceSelected = selectedNodes.has(e.source)
              const targetSelected = selectedNodes.has(e.target)
              const bothSelected = sourceSelected && targetSelected
              
              return {
                ...e,
                animated: bothSelected,
                style: bothSelected 
                  ? { stroke: '#8b5cf6', strokeWidth: 3 }
                  : sourceSelected || targetSelected
                    ? { stroke: '#a78bfa', strokeWidth: 2 }
                    : { stroke: '#94a3b8', strokeWidth: 2 },
                className: bothSelected ? 'animate-pulse' : '',
              }
            })}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.2,
            minZoom: 0.3,
            maxZoom: 1.5,
          }}
          onInit={(instance) => setReactFlowInstance(instance)}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-gradient-to-br from-slate-50 to-slate-100"
        >
          <Background color="#cbd5e1" gap={30} size={1} />
          <Controls 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            showInteractive={false}
          />
          <MiniMap 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            nodeColor={(node) => {
              if (selectedNodes.has(node.id)) return '#8b5cf6'
              if (node.type === 'seed') return '#06b6d4'
              if (node.type === 'operator') return '#f59e0b'
              return '#64748b'
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            position="bottom-left"
          />

          {/* Compact Control Panel */}
          <Panel position="top-left" className="m-3">
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 w-64">
              {/* Session Info */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">Mind Map</span>
                    <p className="text-[10px] text-slate-400">{nodes.length} nodes</p>
                  </div>
                </div>
              </div>

              {/* Current Stage */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-700">
                  {stage === 'exploring' ? 'Explore & Select Dimensions' :
                   stage === 'reviewing' ? 'Review Generated Ideas' :
                   'Ready'}
                </span>
              </div>

              {/* Classification Badge */}
              {currentSession?.classification && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    {(currentSession.classification as any).dominantClass?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {(currentSession.classification as any).archetype}
                  </span>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditSeed}
                  className="flex-1 text-xs h-8 border-violet-200 text-violet-700 hover:bg-violet-50"
                >
                  <ChevronLeft className="w-3 h-3 mr-1" />
                  Edit Input
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="flex-1 text-xs h-8"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  New
                </Button>
              </div>

              {/* Tips */}
              <div className="mt-2 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-500">
                💡 Click nodes to select • Double-click to expand • Use tray to generate ideas
              </div>
            </div>
          </Panel>

          {/* Selection Panel - Compact floating widget */}
          {(stage === 'exploring' || stage === 'generating' || stage === 'reviewing') && (
            <Panel position="top-right" className="m-3">
              <div className={`
                bg-white/95 backdrop-blur-sm rounded-xl border shadow-lg p-3 w-48
                transition-all duration-200
                ${selectedNodes.size > 0 ? 'border-violet-400' : 'border-slate-200'}
              `}>
                {/* Selection Count */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedNodes.size > 0 ? `${selectedNodes.size} Selected` : 'No Selection'}
                  </span>
                  {selectedNodes.size > 0 && (
                    <button
                      onClick={() => setSelectedNodes(new Set())}
                      className="text-[10px] text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                
                {/* Selected Items Preview */}
                {selectedNodes.size > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2 max-h-16 overflow-y-auto">
                    {Array.from(selectedNodes).slice(0, 4).map(nodeId => {
                      const node = nodes.find(n => n.id === nodeId)
                      return (
                        <span
                          key={nodeId}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 truncate max-w-[70px]"
                        >
                          {(node?.data as any)?.title || nodeId}
                        </span>
                      )
                    })}
                    {selectedNodes.size > 4 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        +{selectedNodes.size - 4}
                      </span>
                    )}
                  </div>
                )}
                
                {/* Action Button */}
                <Button
                  onClick={() => setShowTray(true)}
                  disabled={selectedNodes.size === 0}
                  className={`w-full h-8 text-xs ${
                    selectedNodes.size > 0 
                      ? 'bg-violet-500 hover:bg-violet-600 text-white' 
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  {selectedNodes.size > 0 ? 'Generate Ideas' : 'Select Dimensions'}
                </Button>
              </div>
            </Panel>
          )}
        </ReactFlow>

        {/* Loading Overlay */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"
            >
              <div className="text-center">
                <Loader2 className="w-12 h-12 animate-spin text-violet-500 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">
                  {stage === 'normalizing' && 'Analyzing your invention...'}
                  {stage === 'classifying' && 'Classifying invention type...'}
                  {stage === 'expanding' && 'Initializing dimensions...'}
                  {stage === 'generating' && 'Generating ideas...'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Combine Tray Sidebar */}
      <AnimatePresence>
        {showTray && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="w-80 border-l border-slate-200 bg-white overflow-hidden flex flex-col"
          >
            <CombineTray
              selectedNodes={selectedNodes}
              nodes={nodes}
              availableOperators={
                // Get operators from session classification
                ((currentSession?.classification as any)?.applicableOperators as any[]) || []
              }
              onGenerate={handleGenerateIdeas}
              onClear={() => setSelectedNodes(new Set())}
              loading={loading}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ideas Panel */}
      <AnimatePresence>
        {showIdeaPanel && ideaFrames.length > 0 && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="w-96 border-l border-slate-200 bg-white overflow-hidden flex flex-col"
          >
            <IdeaFramePanel
              ideas={ideaFrames}
              onSelectIdea={setSelectedIdea}
              onCheckNovelty={handleCheckNovelty}
              onExport={handleExportToBank}
              onClose={() => setShowIdeaPanel(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

