'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Check, ZoomIn, Plus, Minus } from 'lucide-react'

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

// Compact color palette - just border accents, no gradients
const FAMILY_COLORS = [
  { border: 'border-l-stone-400', bg: 'bg-white', text: 'text-stone-700', handle: '!bg-stone-400' },
  { border: 'border-l-slate-400', bg: 'bg-white', text: 'text-slate-700', handle: '!bg-slate-400' },
  { border: 'border-l-zinc-400', bg: 'bg-white', text: 'text-zinc-700', handle: '!bg-zinc-400' },
  { border: 'border-l-amber-500', bg: 'bg-amber-50/30', text: 'text-amber-800', handle: '!bg-amber-500' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/30', text: 'text-emerald-800', handle: '!bg-emerald-500' },
  { border: 'border-l-sky-500', bg: 'bg-sky-50/30', text: 'text-sky-800', handle: '!bg-sky-500' },
  { border: 'border-l-rose-500', bg: 'bg-rose-50/30', text: 'text-rose-800', handle: '!bg-rose-500' },
  { border: 'border-l-indigo-500', bg: 'bg-indigo-50/30', text: 'text-indigo-800', handle: '!bg-indigo-500' },
  { border: 'border-l-teal-500', bg: 'bg-teal-50/30', text: 'text-teal-800', handle: '!bg-teal-500' },
  { border: 'border-l-orange-500', bg: 'bg-orange-50/30', text: 'text-orange-800', handle: '!bg-orange-500' },
  { border: 'border-l-cyan-500', bg: 'bg-cyan-50/30', text: 'text-cyan-800', handle: '!bg-cyan-500' },
  { border: 'border-l-violet-500', bg: 'bg-violet-50/30', text: 'text-violet-800', handle: '!bg-violet-500' },
]

function getFamilyColorIndex(family: string | undefined): number {
  if (!family) return 0
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    const char = family.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash) % FAMILY_COLORS.length
}

function DimensionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DimensionNodeData
  const isExpanded = nodeData.state === 'EXPANDED'
  const isFamily = nodeData.type === 'DIMENSION_FAMILY'
  const isCollapsed = nodeData.collapsed
  const hasChildren = nodeData.hasChildren
  const isSelected = nodeData.selected || selected
  const isExpanding = nodeData.expanding || false
  const isNew = nodeData.isNew || false
  
  // Hover state for showing full description
  const [isHovered, setIsHovered] = useState(false)

  const familyColor = useMemo(() => {
    const colorIndex = getFamilyColorIndex(nodeData.family)
    return FAMILY_COLORS[colorIndex]
  }, [nodeData.family])

  const canExpand = !isExpanded && !hasChildren

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (canExpand) {
      nodeData.onExpand?.()
    }
  }, [canExpand, nodeData])

  return (
    <div
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-new={isNew ? "true" : undefined}
      className={`
        group relative rounded-lg transition-all duration-150 cursor-pointer
        w-[280px] border-l-4 border border-slate-200
        ${isSelected
          ? 'bg-violet-50 border-l-violet-500 shadow-md ring-1 ring-violet-300'
          : `${familyColor.bg} ${familyColor.border} hover:shadow-sm hover:border-slate-300`
        }
      `}
    >
      {/* Compact Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-2 !h-2 !border !border-white !-left-1 ${
          isSelected ? '!bg-violet-500' : familyColor.handle
        }`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-2 !h-2 !border !border-white !-right-1 ${
          isSelected ? '!bg-violet-500' : familyColor.handle
        }`}
      />

      {/* Compact content area */}
      <div className="px-2.5 py-2">
        {/* Header row: checkbox + title + expand button */}
        <div className="flex items-start gap-2">
          {/* Tiny checkbox */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onSelect?.()
            }}
            className={`
              flex-shrink-0 w-4 h-4 rounded mt-0.5
              flex items-center justify-center
              transition-all duration-100
              ${isSelected 
                ? 'bg-violet-500 text-white' 
                : 'border border-slate-300 hover:border-violet-400 hover:bg-violet-50'
              }
            `}
          >
            {isSelected && <Check className="w-2.5 h-2.5" />}
          </button>
          
          {/* Title - wraps instead of truncates, takes full width */}
          <div className="flex-1 min-w-0 pr-6">
            <h4 className={`font-semibold text-[13px] leading-tight ${
              isSelected ? 'text-violet-800' : familyColor.text
            }`}>
              {nodeData.title}
            </h4>
            
            {/* Description - shows more lines, expands on hover */}
            {nodeData.description && (
              <p className={`
                text-[11px] text-slate-600 mt-1 leading-snug
                ${isHovered ? '' : 'line-clamp-3'}
              `}>
                {nodeData.description}
              </p>
            )}
            
            {/* Family tag - minimal, only if not obvious */}
            {isFamily && nodeData.family && (
              <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {nodeData.family}
              </span>
            )}
          </div>
        </div>
        
        {/* Expand button - positioned inline, smaller */}
        {canExpand && (
          <div className="absolute right-1.5 top-2">
            {isExpanding ? (
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onExpand?.()
                }}
                className="
                  w-6 h-6 rounded-full
                  bg-emerald-500 hover:bg-emerald-600
                  text-white
                  flex items-center justify-center
                  shadow-sm hover:shadow
                  transition-all duration-150
                  hover:scale-105
                "
                title="Explore sub-dimensions"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Collapse/Expand toggle at arrow tip (right edge) */}
      {(hasChildren || isExpanded) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            nodeData.onCollapse?.()
          }}
          className={`
            absolute -right-3 top-1/2 -translate-y-1/2 z-10
            group/collapse
            w-6 h-6 rounded-full
            flex items-center justify-center
            transition-all duration-200
            shadow-sm hover:shadow-md
            ${isCollapsed 
              ? 'bg-amber-500 hover:bg-amber-600 text-white' 
              : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }
          `}
        >
          {isCollapsed ? (
            <Plus className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
          {/* Tooltip on hover */}
          <span className={`
            absolute right-full mr-2 top-1/2 -translate-y-1/2
            px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap
            opacity-0 group-hover/collapse:opacity-100
            pointer-events-none
            transition-opacity duration-150
            ${isCollapsed 
              ? 'bg-amber-600 text-white' 
              : 'bg-slate-700 text-white'
            }
          `}>
            {isCollapsed ? 'Show children' : 'Hide children'}
          </span>
        </button>
      )}
      
      {/* Selected indicator - tiny badge */}
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-violet-500 rounded-full flex items-center justify-center shadow-sm">
          <Check className="w-2.5 h-2.5 text-white" />
        </div>
      )}
    </div>
  )
}

export default memo(DimensionNode)
