"use client"

import React from "react"

type StepState = "ok" | "running" | "queued" | "error" | undefined

export type ActivityStep = {
  id: string // e.g., "llm_call_summary", "load_context"
  state?: StepState // e.g., "ok"
}

function titleCase(s: string) {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function humanizeSuffix(raw: string) {
  const map: Record<string, string> = {
    summary: "Summary of the Invention",
    briefDescriptionOfDrawings: "Drawing Overview",
    fieldOfInvention: "Field of the Invention",
    background: "Background",
  }
  return map[raw] ?? titleCase(raw)
}

export function humanizeStep(raw: string) {
  if (raw === "load_context") return "Collecting your materials"
  if (raw === "integrity_check") return "Final consistency review"

  const prefixes = [
    { key: "build_prompt_", label: "Understanding your goals: " },
    { key: "llm_call_", label: "Expert drafting pass: " },
    { key: "parse_", label: "Interpreting results: " },
    { key: "guard_", label: "Quality & compliance checks: " },
    { key: "pair_guard_", label: "Quality & compliance checks: " },
    { key: "limit_enforce_", label: "Refinement & concision: " },
  ] as const

  for (const p of prefixes) {
    if (raw.startsWith(p.key)) {
      const suffix = raw.slice(p.key.length)
      return p.label + humanizeSuffix(suffix)
    }
  }

  return titleCase(raw)
}

function StateIcon({ state }: { state?: StepState }) {
  if (state === "ok") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" className="text-emerald-500">
        <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (state === "error") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" className="text-rose-500">
        <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  if (state === "queued") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" className="text-violet-400">
        <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
        <path d="M12 8v4l3 3" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  // running or undefined → animated pulse
  return (
    <span className="relative inline-block w-[14px] h-[14px]">
      <span className="absolute inset-[3px] rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.9)]" />
      <span className="absolute w-[6px] h-[6px] rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.8)] origin-[7px_7px] top-[1px] left-[1px] animate-[orbit_1.6s_linear_infinite]" />
    </span>
  )
}

export default function BackendActivityPanel({
  title = "Backend activity",
  personaStyleEnabled,
  onTogglePersonaStyle,
  activeLabel,
  steps,
}: {
  title?: string
  personaStyleEnabled?: boolean
  onTogglePersonaStyle?: () => void
  activeLabel?: string
  steps: ActivityStep[]
}) {
  return (
    <div className="relative rounded-xl p-[14px] overflow-hidden border border-white/10 bg-[rgba(8,11,20,0.75)]">
      <div className="absolute -inset-px opacity-25 blur-2xl pointer-events-none bg-[conic-gradient(from_180deg_at_50%_50%,rgba(56,189,248,0.25),rgba(168,85,247,0.25),rgba(16,185,129,0.25),rgba(56,189,248,0.25))] animate-[swirl_14s_linear_infinite]" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold tracking-wide text-white/90">{title}</span>
          <button
            type="button"
            onClick={onTogglePersonaStyle}
            className={
              "relative inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs border transition " +
              (personaStyleEnabled ? "bg-emerald-600/15 border-emerald-400/40" : "bg-white/10 border-white/20")
            }
            aria-pressed={!!personaStyleEnabled}
            aria-label="Toggle persona style"
          >
            <span
              className={
                "inline-block h-2.5 w-2.5 rounded-full " +
                (personaStyleEnabled ? "bg-emerald-400" : "bg-slate-400")
              }
            />
            <span className="text-white/90">Persona Style</span>
          </button>
        </div>

        {activeLabel && (
          <div className="inline-flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg text-[13px] text-sky-200 border border-white/20 bg-gradient-to-r from-sky-400/10 to-violet-400/10 animate-[shimmer_2.4s_linear_infinite]">
            <span className="relative inline-block w-2 h-2 rounded-full bg-sky-400">
              <span className="absolute -inset-1 rounded-full border-2 border-sky-300/50 animate-[pulse_1.8s_ease-out_infinite]" />
            </span>
            <span>Actively crafting: {activeLabel}</span>
          </div>
        )}

        <ul className="grid gap-2">
          {steps.map((s) => (
            <li key={s.id} className="relative flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-white/5 border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <StateIcon state={s.state} />
                <span className="text-sm text-white/90 truncate">{humanizeStep(s.id)}</span>
              </div>
              <span
                className={
                  "text-[11px] px-2 py-0.5 rounded-full border lowercase " +
                  (s.state === "ok"
                    ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
                    : s.state === "error"
                    ? "text-rose-400 border-rose-400/40 bg-rose-400/10"
                    : s.state === "queued"
                    ? "text-violet-300 border-violet-300/40 bg-violet-300/10"
                    : "text-sky-300 border-sky-300/40 bg-sky-300/10")
                }
              >
                {s.state === "ok" ? "done" : s.state ?? "working"}
              </span>
              <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent [animation:scan_1.9s_ease-in-out_infinite]" aria-hidden />
            </li>
          ))}
          {steps.length === 0 && (
            <li className="text-sm text-white/50">No steps yet. Click Generate.</li>
          )}
        </ul>
      </div>

      <style jsx>{`
        @keyframes swirl { from { transform: rotate(0deg) scale(1.1); } to { transform: rotate(360deg) scale(1.1); } }
        @keyframes shimmer { 0% { filter: brightness(1); } 50% { filter: brightness(1.2); } 100% { filter: brightness(1); } }
        @keyframes pulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }
        @keyframes orbit { from { transform: rotate(0deg) translateX(7px) rotate(0deg); } to { transform: rotate(360deg) translateX(7px) rotate(-360deg); } }
        @keyframes scan { 0% { transform: translateX(-100%); } 60% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  )
}

