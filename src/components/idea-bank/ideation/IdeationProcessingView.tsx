'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Sparkles,
  Network,
  Lightbulb,
  Target,
  Layers,
  Zap,
  GitBranch,
  Puzzle,
  FlaskConical,
  Scale,
  Rocket,
  Eye,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProcessingStage {
  id: string
  name: string
  title: string
  description: string
  icon: React.ReactNode
  color: string
  bgGradient: string
  thinkingPhrases: string[]
  substeps: string[]
  tips: string[]
}

interface IdeationProcessingViewProps {
  stage: string
  seedText?: string
  onCancel: () => void
}

const PROCESSING_STAGES: Record<string, ProcessingStage> = {
  normalizing: {
    id: 'normalizing',
    name: 'Analyze',
    title: 'Analyzing Your Invention',
    description: 'Extracting the core essence and identifying hidden assumptions',
    icon: <Brain className="w-8 h-8" />,
    color: 'violet',
    bgGradient: 'from-violet-500/20 via-purple-500/10 to-indigo-500/20',
    thinkingPhrases: [
      'Identifying the core entity...',
      'Extracting key components...',
      'Analyzing intent and goals...',
      'Finding constraints and limits...',
      'Detecting unstated assumptions...',
      'Discovering technical contradictions...',
      'Formulating patentable problem...',
      'Generating clarifying questions...',
    ],
    substeps: [
      'Parse invention description',
      'Identify core entity & goal',
      'Extract constraints',
      'Find hidden assumptions',
      'Map contradictions',
    ],
    tips: [
      'The AI looks for tradeoffs you might not have noticed',
      'Contradictions are where real inventions happen',
      'Better input = better patent ideas',
    ],
  },
  classifying: {
    id: 'classifying',
    name: 'Classify',
    title: 'Classifying Invention Type',
    description: 'Determining the patent category and technical domain',
    icon: <Layers className="w-8 h-8" />,
    color: 'blue',
    bgGradient: 'from-blue-500/20 via-cyan-500/10 to-sky-500/20',
    thinkingPhrases: [
      'Analyzing invention archetype...',
      'Mapping to patent classes...',
      'Identifying technical domain...',
      'Evaluating hybrid potential...',
      'Selecting applicable dimensions...',
      'Matching TRIZ operators...',
    ],
    substeps: [
      'Determine invention type',
      'Assign patent categories',
      'Select applicable operators',
      'Initialize mind map',
    ],
    tips: [
      'Your invention might span multiple categories',
      'The archetype determines which creativity tools apply',
      'Some inventions work best as method + device hybrids',
    ],
  },
  mapping_contradictions: {
    id: 'mapping_contradictions',
    name: 'Contradictions',
    title: 'Mapping Technical Contradictions',
    description: 'Applying TRIZ inventive principles to resolve conflicts',
    icon: <Scale className="w-8 h-8" />,
    color: 'amber',
    bgGradient: 'from-amber-500/20 via-orange-500/10 to-yellow-500/20',
    thinkingPhrases: [
      'Analyzing parameter conflicts...',
      'Mapping to TRIZ matrix...',
      'Identifying inventive principles...',
      'Finding separation strategies...',
      'Exploring resolution paths...',
      'Discovering second-order effects...',
    ],
    substeps: [
      'Identify contradictions',
      'Map to TRIZ principles',
      'Generate resolution strategies',
      'Check for side effects',
    ],
    tips: [
      'Every great invention resolves a contradiction',
      'TRIZ has 40 inventive principles used by top innovators',
      'Sometimes inverting the problem reveals the solution',
    ],
  },
  expanding: {
    id: 'expanding',
    name: 'Build',
    title: 'Building Mind Map',
    description: 'Creating dimension families and exploration paths',
    icon: <GitBranch className="w-8 h-8" />,
    color: 'emerald',
    bgGradient: 'from-emerald-500/20 via-green-500/10 to-teal-500/20',
    thinkingPhrases: [
      'Creating dimension families...',
      'Generating material options...',
      'Exploring form variations...',
      'Mapping energy alternatives...',
      'Analyzing spatial configurations...',
      'Building temporal sequences...',
    ],
    substeps: [
      'Initialize dimension tree',
      'Generate family nodes',
      'Position mind map layout',
      'Connect exploration paths',
    ],
    tips: [
      'Each dimension is a creative direction to explore',
      'The best ideas often come from unexpected combinations',
      'Don\'t just pick the obvious options!',
    ],
  },
  checking_obviousness: {
    id: 'checking_obviousness',
    name: 'Novelty Check',
    title: 'Checking Combination Novelty',
    description: 'Ensuring your selection is non-obvious and patentable',
    icon: <Eye className="w-8 h-8" />,
    color: 'rose',
    bgGradient: 'from-rose-500/20 via-pink-500/10 to-red-500/20',
    thinkingPhrases: [
      'Evaluating combination novelty...',
      'Checking for obvious patterns...',
      'Analyzing domain distance...',
      'Assessing inventive step...',
      'Suggesting improvements...',
    ],
    substeps: [
      'Score combination novelty',
      'Check for obvious patterns',
      'Suggest wild card options',
      'Validate inventive leap',
    ],
    tips: [
      'Combinations from distant domains score higher',
      'Removing something can be more inventive than adding',
      'The AI suggests wild cards to boost novelty',
    ],
  },
  generating: {
    id: 'generating',
    name: 'Generate',
    title: 'Generating Inventive Ideas',
    description: 'Creating patent-worthy concepts with forced analogy transfer',
    icon: <Rocket className="w-8 h-8" />,
    color: 'violet',
    bgGradient: 'from-violet-500/20 via-fuchsia-500/10 to-purple-500/20',
    thinkingPhrases: [
      'Forcing inventive leaps...',
      'Applying TRIZ operators...',
      'Generating cross-domain analogies...',
      'Creating claim hooks...',
      'Validating non-obviousness...',
      'Building technical specifications...',
      'Crafting patent language...',
      'Generating variants...',
    ],
    substeps: [
      'Apply creativity operators',
      'Force analogy transfer',
      'Generate idea frames',
      'Craft claim language',
      'Create variants',
    ],
    tips: [
      'Each idea includes a claim hook ready for patent drafting',
      'The AI explains WHY each idea is non-obvious',
      'Variants help you find the strongest angle',
    ],
  },
}

// Neural network animation nodes
const NeuralNetworkAnimation = ({ color }: { color: string }) => {
  const nodes = useMemo(() => {
    const positions = []
    for (let i = 0; i < 12; i++) {
      positions.push({
        id: i,
        x: 20 + Math.random() * 60,
        y: 20 + Math.random() * 60,
        size: 4 + Math.random() * 8,
        delay: Math.random() * 2,
      })
    }
    return positions
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden opacity-30">
      <svg className="w-full h-full">
        {/* Connection lines */}
        {nodes.map((node, i) =>
          nodes.slice(i + 1).map((other, j) => {
            const distance = Math.sqrt(
              Math.pow(node.x - other.x, 2) + Math.pow(node.y - other.y, 2)
            )
            if (distance < 35) {
              return (
                <motion.line
                  key={`${i}-${j}`}
                  x1={`${node.x}%`}
                  y1={`${node.y}%`}
                  x2={`${other.x}%`}
                  y2={`${other.y}%`}
                  stroke={`var(--${color}-400)`}
                  strokeWidth="1"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{
                    pathLength: [0, 1, 1, 0],
                    opacity: [0, 0.6, 0.6, 0],
                  }}
                  transition={{
                    duration: 3,
                    delay: node.delay,
                    repeat: Infinity,
                    repeatDelay: 1,
                  }}
                />
              )
            }
            return null
          })
        )}
        {/* Nodes */}
        {nodes.map((node) => (
          <motion.circle
            key={node.id}
            cx={`${node.x}%`}
            cy={`${node.y}%`}
            r={node.size}
            fill={`var(--${color}-500)`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: [0.5, 1.2, 1, 0.8, 1],
              opacity: [0.3, 0.8, 0.6, 0.8, 0.3],
            }}
            transition={{
              duration: 2.5,
              delay: node.delay,
              repeat: Infinity,
              repeatDelay: 0.5,
            }}
          />
        ))}
      </svg>
    </div>
  )
}

// Thinking bubbles animation
const ThinkingBubbles = () => (
  <div className="flex items-center gap-1 ml-2">
    {[0, 1, 2].map((i) => (
      <motion.div
        key={i}
        className="w-2 h-2 rounded-full bg-current"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{
          duration: 1,
          delay: i * 0.2,
          repeat: Infinity,
        }}
      />
    ))}
  </div>
)

// Extracted concepts display
const ExtractedConcepts = ({ seedText }: { seedText: string }) => {
  const [visibleConcepts, setVisibleConcepts] = useState<string[]>([])
  
  // Extract keywords from seed text
  const concepts = useMemo(() => {
    const words = seedText.toLowerCase().split(/\s+/)
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'that', 'this', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some', 'no', 'most', 'other', 'such'])
    return words
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 8)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  }, [seedText])

  useEffect(() => {
    let idx = 0
    const interval = setInterval(() => {
      if (idx < concepts.length) {
        setVisibleConcepts(prev => [...prev, concepts[idx]])
        idx++
      } else {
        clearInterval(interval)
      }
    }, 600)
    return () => clearInterval(interval)
  }, [concepts])

  if (!seedText || concepts.length === 0) return null

  return (
    <div className="mt-4">
      <div className="text-xs text-slate-400 mb-2 flex items-center">
        <Sparkles className="w-3 h-3 mr-1" />
        Analyzing concepts:
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <AnimatePresence>
          {visibleConcepts.map((concept, i) => (
            <motion.span
              key={`concept-${i}-${concept}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="px-3 py-1 rounded-full bg-white/80 border border-slate-200 text-xs text-slate-600 font-medium shadow-sm"
            >
              {concept}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default function IdeationProcessingView({
  stage,
  seedText,
  onCancel,
}: IdeationProcessingViewProps) {
  const [currentThoughtIdx, setCurrentThoughtIdx] = useState(0)
  const [completedSubsteps, setCompletedSubsteps] = useState<number[]>([])
  const [currentTipIdx, setCurrentTipIdx] = useState(0)
  
  const stageConfig = PROCESSING_STAGES[stage] || PROCESSING_STAGES.normalizing

  // Cycle through thinking phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentThoughtIdx(prev => 
        (prev + 1) % stageConfig.thinkingPhrases.length
      )
    }, 2500)
    return () => clearInterval(interval)
  }, [stageConfig.thinkingPhrases.length])

  // Progress through substeps
  useEffect(() => {
    setCompletedSubsteps([])
    const substepCount = stageConfig.substeps.length
    let idx = 0
    const interval = setInterval(() => {
      if (idx < substepCount - 1) {
        setCompletedSubsteps(prev => [...prev, idx])
        idx++
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [stage, stageConfig.substeps.length])

  // Cycle through tips
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTipIdx(prev => (prev + 1) % stageConfig.tips.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [stageConfig.tips.length])

  // Stage progress
  const stageOrder = ['normalizing', 'classifying', 'mapping_contradictions', 'expanding', 'checking_obviousness', 'generating']
  const currentStageIdx = stageOrder.indexOf(stage)

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl"
      >
        {/* Main Card */}
        <div className={`relative bg-gradient-to-br ${stageConfig.bgGradient} rounded-3xl shadow-2xl border border-white/50 overflow-hidden`}>
          {/* Neural Network Background */}
          <NeuralNetworkAnimation color={stageConfig.color} />
          
          <div className="relative z-10 p-8">
            {/* Stage Icon with Pulse */}
            <div className="flex justify-center mb-6">
              <motion.div
                className={`w-20 h-20 rounded-2xl bg-gradient-to-br from-${stageConfig.color}-500 to-${stageConfig.color}-600 flex items-center justify-center text-white shadow-lg`}
                animate={{
                  scale: [1, 1.05, 1],
                  boxShadow: [
                    `0 10px 40px -10px var(--${stageConfig.color}-500)`,
                    `0 20px 60px -10px var(--${stageConfig.color}-500)`,
                    `0 10px 40px -10px var(--${stageConfig.color}-500)`,
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {stageConfig.icon}
              </motion.div>
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
              {stageConfig.title}
            </h2>
            <p className="text-slate-600 text-center mb-6">
              {stageConfig.description}
            </p>

            {/* Thinking Display */}
            <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 mb-6 border border-white/80">
              <div className="flex items-center justify-center text-slate-700">
                <Brain className="w-4 h-4 mr-2 text-violet-500" />
                <motion.span
                  key={currentThoughtIdx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="font-medium"
                >
                  {stageConfig.thinkingPhrases[currentThoughtIdx]}
                </motion.span>
                <ThinkingBubbles />
              </div>
              
              {/* Show extracted concepts for normalization stage */}
              {stage === 'normalizing' && seedText && (
                <ExtractedConcepts seedText={seedText} />
              )}
            </div>

            {/* Substeps Progress */}
            <div className="bg-white/40 backdrop-blur-sm rounded-xl p-4 mb-6">
              <div className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wide">
                Stage Progress
              </div>
              <div className="space-y-2">
                {stageConfig.substeps.map((substep, idx) => {
                  const isCompleted = completedSubsteps.includes(idx)
                  const isActive = idx === completedSubsteps.length
                  
                  return (
                    <motion.div
                      key={substep}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                        isCompleted 
                          ? 'bg-green-50 text-green-700' 
                          : isActive 
                            ? 'bg-violet-50 text-violet-700' 
                            : 'text-slate-400'
                      }`}
                      initial={{ opacity: 0.5 }}
                      animate={{ opacity: isCompleted || isActive ? 1 : 0.5 }}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                        isCompleted 
                          ? 'bg-green-500 text-white' 
                          : isActive 
                            ? 'bg-violet-500 text-white' 
                            : 'bg-slate-200 text-slate-400'
                      }`}>
                        {isCompleted ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : isActive ? (
                          <motion.div
                            className="w-2 h-2 rounded-full bg-white"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <span className="text-sm font-medium">{substep}</span>
                      {isActive && (
                        <motion.div
                          className="ml-auto"
                          animate={{ x: [0, 5, 0] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          <ArrowRight className="w-4 h-4" />
                        </motion.div>
                      )}
                    </motion.div>
                  )
                })}
              </div>
            </div>

            {/* Overall Progress */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-500">Overall Progress</span>
                <span className="text-xs text-slate-500">
                  Stage {currentStageIdx + 1} of {stageOrder.length}
                </span>
              </div>
              <div className="flex gap-1">
                {stageOrder.map((s, idx) => (
                  <motion.div
                    key={s}
                    className={`h-2 flex-1 rounded-full ${
                      idx < currentStageIdx
                        ? 'bg-green-500'
                        : idx === currentStageIdx
                          ? 'bg-violet-500'
                          : 'bg-slate-200'
                    }`}
                    initial={idx === currentStageIdx ? { scaleX: 0 } : {}}
                    animate={idx === currentStageIdx ? {
                      scaleX: [0, 0.3, 0.6, 0.8, 1],
                      transition: { duration: 10, ease: 'linear' }
                    } : {}}
                    style={{ transformOrigin: 'left' }}
                  />
                ))}
              </div>
            </div>

            {/* Tip Carousel */}
            <div className="bg-amber-50/80 backdrop-blur-sm rounded-xl p-4 border border-amber-200/50">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs text-amber-600 font-medium mb-1">Did you know?</div>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={currentTipIdx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-sm text-amber-800"
                    >
                      {stageConfig.tips[currentTipIdx]}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Cancel Button */}
            <div className="mt-6 text-center">
              <Button
                variant="outline"
                onClick={onCancel}
                className="bg-white/50 hover:bg-white/80 text-slate-600"
              >
                Cancel Process
              </Button>
            </div>
          </div>
        </div>

        {/* Stage Names Below */}
        <div className="flex justify-center gap-2 mt-6">
          {stageOrder.slice(0, 5).map((s, idx) => {
            const config = PROCESSING_STAGES[s]
            const isActive = s === stage
            const isComplete = stageOrder.indexOf(s) < currentStageIdx
            
            return (
              <div
                key={s}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-violet-100 text-violet-700 shadow-sm'
                    : isComplete
                      ? 'bg-green-100 text-green-700'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isComplete && <CheckCircle2 className="w-3 h-3" />}
                {isActive && (
                  <motion.div
                    className="w-2 h-2 rounded-full bg-violet-500"
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                )}
                {config?.name || s}
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

