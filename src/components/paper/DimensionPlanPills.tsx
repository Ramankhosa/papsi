'use client';

import { motion } from 'framer-motion';
import { Check, Circle } from 'lucide-react';

interface DimensionPlanItem {
  dimensionKey: string;
  dimensionLabel: string;
  status: 'accepted' | 'pending' | 'todo';
}

interface DimensionPlanPillsProps {
  plan: DimensionPlanItem[];
  activeDimensionKey?: string | null;
  acceptedCount: number;
  totalCount: number;
  disabled?: boolean;
  onSelect?: (dimensionKey: string) => void;
}

export default function DimensionPlanPills({
  plan,
  activeDimensionKey,
  acceptedCount,
  totalCount,
  disabled,
  onSelect,
}: DimensionPlanPillsProps) {
  if (!plan || plan.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {plan.map((item) => {
        const isAccepted = item.status === 'accepted';
        const isActive = activeDimensionKey && activeDimensionKey === item.dimensionKey;

        const classes = isAccepted
          ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
          : isActive || item.status === 'pending'
            ? 'text-indigo-600 bg-indigo-50 border-indigo-300 animate-pulse'
            : 'text-slate-400 bg-slate-50 border-slate-200';

        return (
          <motion.button
            key={item.dimensionKey}
            type="button"
            onClick={() => onSelect?.(item.dimensionKey)}
            disabled={Boolean(disabled)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.2px] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            title={item.dimensionLabel}
          >
            {isAccepted ? (
              <Check className="h-3 w-3" />
            ) : (
              <Circle className="h-2.5 w-2.5" />
            )}
            <span className="max-w-[140px] truncate">{item.dimensionLabel}</span>
          </motion.button>
        );
      })}

      <span className="ml-1 text-[11px] font-semibold text-indigo-500">
        {acceptedCount}/{totalCount}
      </span>
    </div>
  );
}
