'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Layers, ChevronRight, ChevronDown, Check, Sparkles, Square, CheckSquare } from 'lucide-react'

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
  onSelect?: () => void
  onExpand?: () => void
  onCollapse?: () => void
}

function DimensionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DimensionNodeData
  const isExpanded = nodeData.state === 'EXPANDED'
  const isFamily = nodeData.type === 'DIMENSION_FAMILY'
  const isOption = nodeData.type === 'DIMENSION_OPTION'
  const isCollapsed = nodeData.collapsed
  const hasChildren = nodeData.hasChildren
  const isSelected = nodeData.selected || selected
  
  return (
    <div
      className={`
        group relative rounded-xl border-2 transition-all duration-200 cursor-pointer
        w-[200px] overflow-hidden
        ${isSelected
          ? 'bg-gradient-to-br from-violet-50 to-purple-100 border-violet-500 shadow-lg shadow-violet-200/60 ring-2 ring-violet-300'
          : isFamily
            ? 'bg-gradient-to-br from-slate-50 to-slate-100 border-slate-300 hover:border-violet-400 hover:shadow-md'
            : 'bg-white border-slate-200 hover:border-violet-300 hover:shadow-md'
        }
      `}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-2.5 !h-2.5 !border-2 !border-white transition-all ${
          isSelected ? '!bg-violet-600' : '!bg-violet-400'
        }`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-2.5 !h-2.5 !border-2 !border-white transition-all ${
          isSelected ? '!bg-violet-600' : '!bg-violet-400'
        }`}
      />
      
      {/* Selection indicator strip */}
      {isSelected && (
        <div className="absolute top-0 left-0 w-1 h-full bg-violet-500" />
      )}

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
          >
            {isSelected ? (
              <Check className="w-3 h-3" />
            ) : (
              <div className="w-2 h-2 rounded-sm border border-slate-300" />
            )}
          </button>
          
          {/* Title & content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <div className={`
                w-4 h-4 rounded flex items-center justify-center flex-shrink-0
                ${isFamily ? 'bg-slate-300' : 'bg-violet-100'}
              `}>
                {isOption ? (
                  <Sparkles className="w-2.5 h-2.5 text-violet-600" />
                ) : (
                  <Layers className={`w-2.5 h-2.5 ${isFamily ? 'text-slate-600' : 'text-violet-600'}`} />
                )}
              </div>
              <span className={`font-semibold text-xs truncate ${
                isSelected ? 'text-violet-800' : 'text-slate-800'
              }`}>
                {nodeData.title}
              </span>
            </div>
            
            {/* Description */}
            {nodeData.description && (
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 leading-tight">
                {nodeData.description}
              </p>
            )}
          </div>
          
          {/* Expand/Collapse buttons */}
          <div className="flex flex-col gap-1">
            {/* Expand button - for collapsed dimension families */}
            {isFamily && !isExpanded && !hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onExpand?.()
                }}
                className="w-6 h-6 rounded bg-violet-100 hover:bg-violet-200 flex items-center justify-center transition-colors"
                title="Expand dimension"
              >
                <ChevronRight className="w-4 h-4 text-violet-600" />
              </button>
            )}
            
            {/* Collapse/Show button - for nodes with children OR expanded state */}
            {(hasChildren || isExpanded) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onCollapse?.()
                }}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  isCollapsed 
                    ? 'bg-amber-100 hover:bg-amber-200' 
                    : 'bg-slate-100 hover:bg-slate-200'
                }`}
                title={isCollapsed ? 'Show children' : 'Collapse & hide children'}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-amber-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-600" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer - Type indicator */}
      <div className={`
        px-3 py-1.5 text-[9px] font-medium flex items-center justify-between
        ${isSelected 
          ? 'bg-violet-100/80 text-violet-700' 
          : isFamily 
            ? 'bg-slate-100 text-slate-500' 
            : 'bg-slate-50 text-slate-400'
        }
      `}>
        <span>
          {isFamily ? '📂 Dimension' : '✦ Option'}
        </span>
        {isSelected && <span>Selected</span>}
      </div>
    </div>
  )
}

export default memo(DimensionNode)
