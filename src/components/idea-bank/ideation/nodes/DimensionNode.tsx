'use client'

import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Layers, ChevronRight, ChevronDown, Check, Sparkles, ZoomIn, FolderOpen, Minus } from 'lucide-react'

interface DimensionNodeData {
  title: string
  description?: string
  family?: string
  state?: string
  type?: string
  tags?: string[]
  selected?: boolean
  collapsed?: boolean
  hasChildren?: boolean
  expanding?: boolean
  isNew?: boolean
  onSelect?: () => void
  onExpand?: () => void
  onCollapse?: () => void
}

// Subtle, muted color palette for family grouping - easy on the eyes
const FAMILY_COLORS = [
  { bg: 'from-stone-50 to-stone-100', border: 'border-stone-300', accent: 'bg-stone-200', text: 'text-stone-700', handle: '!bg-stone-400', strip: 'bg-stone-400', footer: 'bg-stone-100 border-stone-200' },
  { bg: 'from-slate-50 to-slate-100', border: 'border-slate-300', accent: 'bg-slate-200', text: 'text-slate-700', handle: '!bg-slate-400', strip: 'bg-slate-400', footer: 'bg-slate-100 border-slate-200' },
  { bg: 'from-zinc-50 to-zinc-100', border: 'border-zinc-300', accent: 'bg-zinc-200', text: 'text-zinc-700', handle: '!bg-zinc-400', strip: 'bg-zinc-400', footer: 'bg-zinc-100 border-zinc-200' },
  { bg: 'from-neutral-50 to-neutral-100', border: 'border-neutral-300', accent: 'bg-neutral-200', text: 'text-neutral-700', handle: '!bg-neutral-400', strip: 'bg-neutral-400', footer: 'bg-neutral-100 border-neutral-200' },
  { bg: 'from-amber-50/60 to-amber-100/60', border: 'border-amber-200', accent: 'bg-amber-100', text: 'text-amber-800', handle: '!bg-amber-400', strip: 'bg-amber-400', footer: 'bg-amber-50 border-amber-200' },
  { bg: 'from-emerald-50/60 to-emerald-100/60', border: 'border-emerald-200', accent: 'bg-emerald-100', text: 'text-emerald-800', handle: '!bg-emerald-400', strip: 'bg-emerald-400', footer: 'bg-emerald-50 border-emerald-200' },
  { bg: 'from-sky-50/60 to-sky-100/60', border: 'border-sky-200', accent: 'bg-sky-100', text: 'text-sky-800', handle: '!bg-sky-400', strip: 'bg-sky-400', footer: 'bg-sky-50 border-sky-200' },
  { bg: 'from-rose-50/60 to-rose-100/60', border: 'border-rose-200', accent: 'bg-rose-100', text: 'text-rose-800', handle: '!bg-rose-400', strip: 'bg-rose-400', footer: 'bg-rose-50 border-rose-200' },
  { bg: 'from-indigo-50/60 to-indigo-100/60', border: 'border-indigo-200', accent: 'bg-indigo-100', text: 'text-indigo-800', handle: '!bg-indigo-400', strip: 'bg-indigo-400', footer: 'bg-indigo-50 border-indigo-200' },
  { bg: 'from-teal-50/60 to-teal-100/60', border: 'border-teal-200', accent: 'bg-teal-100', text: 'text-teal-800', handle: '!bg-teal-400', strip: 'bg-teal-400', footer: 'bg-teal-50 border-teal-200' },
  { bg: 'from-orange-50/60 to-orange-100/60', border: 'border-orange-200', accent: 'bg-orange-100', text: 'text-orange-800', handle: '!bg-orange-400', strip: 'bg-orange-400', footer: 'bg-orange-50 border-orange-200' },
  { bg: 'from-cyan-50/60 to-cyan-100/60', border: 'border-cyan-200', accent: 'bg-cyan-100', text: 'text-cyan-800', handle: '!bg-cyan-400', strip: 'bg-cyan-400', footer: 'bg-cyan-50 border-cyan-200' },
]

// Simple hash function to get consistent color index from family name
function getFamilyColorIndex(family: string | undefined): number {
  if (!family) return 0
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    const char = family.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash) % FAMILY_COLORS.length
}

function DimensionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DimensionNodeData
  const isExpanded = nodeData.state === 'EXPANDED'
  const isFamily = nodeData.type === 'DIMENSION_FAMILY'
  const isOption = nodeData.type === 'DIMENSION_OPTION'
  const isCollapsed = nodeData.collapsed
  const hasChildren = nodeData.hasChildren
  const isSelected = nodeData.selected || selected
  const isExpanding = nodeData.expanding || false
  const isNew = nodeData.isNew || false

  // Get family-based color scheme
  const familyColor = useMemo(() => {
    const colorIndex = getFamilyColorIndex(nodeData.family)
    return FAMILY_COLORS[colorIndex]
  }, [nodeData.family])

  // Determine if we can expand this node - show on any node that doesn't have children yet
  const canExpand = !isExpanded && !hasChildren

  // Double-click to expand
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (canExpand) {
      nodeData.onExpand?.()
    }
  }, [canExpand, nodeData])

  return (
    <div
      onDoubleClick={handleDoubleClick}
      data-new={isNew ? "true" : undefined}
      className={`
        group relative rounded-xl border-2 transition-all duration-200 cursor-pointer
        w-[240px] overflow-hidden
        ${isSelected
          ? 'bg-gradient-to-br from-violet-50 to-purple-100 border-violet-500 shadow-lg shadow-violet-200/60 ring-2 ring-violet-300 animate-pulse-selected-node'
          : `bg-gradient-to-br ${familyColor.bg} ${familyColor.border} hover:shadow-md hover:brightness-[0.98]`
        }
      `}
    >
      {/* Handles - colored by family */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-2.5 !h-2.5 !border-2 !border-white transition-all ${
          isSelected ? '!bg-violet-600' : familyColor.handle
        }`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-2.5 !h-2.5 !border-2 !border-white transition-all ${
          isSelected ? '!bg-violet-600' : familyColor.handle
        }`}
      />
      
      {/* Family color indicator strip on left edge */}
      <div className={`absolute top-0 left-0 w-1 h-full ${isSelected ? 'bg-violet-500' : familyColor.strip}`} />

      {/* Main content */}
      <div className="p-3">
        <div className="flex items-start gap-2">
          {/* Checkbox */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onSelect?.()
            }}
            className={`
              flex-shrink-0 w-5 h-5 rounded flex items-center justify-center
              transition-all duration-150 hover:scale-110
              ${isSelected 
                ? 'bg-violet-500 text-white' 
                : 'bg-slate-100 text-slate-400 hover:bg-violet-100 hover:text-violet-500'
              }
            `}
            title={isSelected ? 'Deselect' : 'Select for idea generation'}
          >
            {isSelected ? (
              <Check className="w-3 h-3" />
            ) : (
              <div className="w-2 h-2 rounded-sm border border-slate-300" />
            )}
          </button>
          
          {/* Title & content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className={`
                w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                ${isSelected ? 'bg-violet-200' : familyColor.accent}
              `}>
                {isOption ? (
                  <Sparkles className={`w-3 h-3 ${isSelected ? 'text-violet-600' : familyColor.text}`} />
                ) : (
                  <Layers className={`w-3 h-3 ${isSelected ? 'text-violet-600' : familyColor.text}`} />
                )}
              </div>
              <span className={`font-semibold text-sm truncate ${
                isSelected ? 'text-violet-800' : familyColor.text
              }`}>
                {nodeData.title}
              </span>
            </div>
            
            {/* Description */}
            {nodeData.description && (
              <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-2 leading-tight">
                {nodeData.description}
              </p>
            )}
          </div>
        </div>
        
        {/* EXPAND BUTTON - Zoom icon at right edge */}
        {canExpand && (
          <div className="absolute -right-3 top-1/2 transform -translate-y-1/2">
            {isExpanding ? (
              // Beautiful modern loading indicator
              <div className="w-8 h-8 bg-white rounded-full shadow-lg ring-2 ring-blue-100 flex items-center justify-center">
                <div className="relative">
                  <div className="w-4 h-4">
                    {/* Blue dots in a circle */}
                    <div className="absolute top-0 left-1/2 w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
                    <div className="absolute top-1 right-0 w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                    <div className="absolute bottom-0 left-1/2 w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                    <div className="absolute top-1 left-0 w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.6s'}}></div>
                  </div>
                  {/* Rotating outer ring */}
                  <div className="absolute inset-0 rounded-full border-2 border-blue-200"></div>
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin"></div>
                </div>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onExpand?.()
                }}
                className="
                  w-8 h-8
                  bg-gradient-to-r from-emerald-500 to-teal-500
                  hover:from-emerald-600 hover:to-teal-600
                  text-white rounded-full
                  flex items-center justify-center
                  shadow-lg hover:shadow-xl
                  transition-all duration-200
                  hover:scale-110
                  ring-2 ring-white
                "
                title="Click to explore sub-dimensions"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        
        {/* Collapse/Expand Children Toggle - for nodes with children */}
        {(hasChildren || isExpanded) && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              {isCollapsed ? 'Children hidden' : 'Showing children'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                nodeData.onCollapse?.()
              }}
              className={`
                flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
                transition-colors
                ${isCollapsed 
                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-700' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }
              `}
              title={isCollapsed ? 'Show children' : 'Hide children'}
            >
              {isCollapsed ? (
                <>
                  <FolderOpen className="w-3 h-3" />
                  Show
                </>
              ) : (
                <>
                  <Minus className="w-3 h-3" />
                  Hide
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Footer - Type indicator with family color */}
      <div className={`
        px-3 py-1.5 text-[9px] font-medium flex items-center justify-between
        border-t
        ${isSelected 
          ? 'bg-violet-100/80 text-violet-700 border-violet-200' 
          : familyColor.footer
        }
      `}>
        <span className={`flex items-center gap-1.5 ${isSelected ? '' : familyColor.text} opacity-70`}>
          {isFamily ? (
            <>
              <Layers className="w-3 h-3" />
              {nodeData.family || 'Dimension Family'}
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {nodeData.family || 'Option'}
            </>
          )}
        </span>
        {isSelected && (
          <span className="bg-violet-500 text-white px-1.5 py-0.5 rounded text-[8px]">
            ✓ Selected
          </span>
        )}
      </div>
    </div>
  )
}

export default memo(DimensionNode)
