/**
 * User Instruction Service
 * 
 * Manages user-provided custom instructions for patent sections.
 * These are the highest priority in the prompt hierarchy:
 * 
 * 1. SupersetSection (database) - Base universal prompts
 * 2. CountrySectionPrompt (database) - Country-specific top-up prompts
 * 3. UserInstruction (database) - Per-session user instructions (HIGHEST PRIORITY)
 * 
 * Users can customize:
 * - Custom instruction text for any section
 * - What to emphasize/focus on
 * - What to avoid/exclude
 * - Writing style preferences
 * - Target word count overrides
 */

import { prisma } from './prisma'

// ============================================================================
// Types
// ============================================================================

export interface UserSectionInstruction {
  id: string
  sessionId: string
  jurisdiction: string // "*" = all jurisdictions, or specific like "IN", "US"
  sectionKey: string
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateUserInstructionInput {
  sessionId: string
  jurisdiction?: string // Default "*" (all jurisdictions)
  sectionKey: string
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
}

export interface UpdateUserInstructionInput {
  instruction?: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isActive?: boolean
}

export interface UserInstructionContext {
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
}

// ============================================================================
// Cache
// ============================================================================

// Session-level cache for user instructions
const sessionInstructionCache = new Map<string, Map<string, UserSectionInstruction>>()
const cacheTTL = 60 * 1000 // 1 minute
const cacheTimestamps = new Map<string, number>()

function getCachedInstructions(sessionId: string): Map<string, UserSectionInstruction> | null {
  const timestamp = cacheTimestamps.get(sessionId)
  if (timestamp && Date.now() - timestamp < cacheTTL) {
    return sessionInstructionCache.get(sessionId) || null
  }
  return null
}

function setCachedInstructions(sessionId: string, instructions: Map<string, UserSectionInstruction>): void {
  sessionInstructionCache.set(sessionId, instructions)
  cacheTimestamps.set(sessionId, Date.now())
}

export function invalidateSessionInstructionCache(sessionId: string): void {
  sessionInstructionCache.delete(sessionId)
  cacheTimestamps.delete(sessionId)
}

/**
 * Clone instructions from one session to another (e.g., when a session is reset/newly created).
 * Skips any sectionKey/jurisdiction pairs that already exist on the target session.
 * Returns number of instructions copied.
 */
export async function cloneInstructionsBetweenSessions(
  sourceSessionId: string,
  targetSessionId: string
): Promise<number> {
  if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) return 0

  const [source, targetExisting] = await Promise.all([
    prisma.userSectionInstruction.findMany({ where: { sessionId: sourceSessionId } }),
    prisma.userSectionInstruction.findMany({ where: { sessionId: targetSessionId } })
  ])

  if (!source.length) return 0

  const existingKeys = new Set(targetExisting.map(i => `${i.sectionKey}:${i.jurisdiction}`))
  const payload = source
    .filter(i => !existingKeys.has(`${i.sectionKey}:${i.jurisdiction}`))
    .map(i => ({
      sessionId: targetSessionId,
      jurisdiction: i.jurisdiction,
      sectionKey: i.sectionKey,
      instruction: i.instruction,
      emphasis: i.emphasis,
      avoid: i.avoid,
      style: i.style,
      wordCount: i.wordCount,
      isActive: i.isActive
    }))

  if (payload.length === 0) return 0

  await prisma.userSectionInstruction.createMany({ data: payload })
  invalidateSessionInstructionCache(targetSessionId)
  return payload.length
}

// ============================================================================
// Core CRUD Operations
// ============================================================================

/**
 * Get user instruction for a specific section in a session
 * Looks for jurisdiction-specific first, then falls back to wildcard "*"
 * 
 * @param sessionId - The drafting session ID
 * @param sectionKey - The section key (canonical)
 * @param jurisdiction - Optional jurisdiction code (e.g., "IN", "US"). If provided, looks for jurisdiction-specific instruction first.
 */
export async function getUserInstruction(
  sessionId: string,
  sectionKey: string,
  jurisdiction?: string
): Promise<UserInstructionContext | null> {
  const jurisdictionCode = jurisdiction?.toUpperCase() || '*'
  const cacheKey = `${sectionKey}:${jurisdictionCode}`
  
  // Check cache first
  const cached = getCachedInstructions(sessionId)
  if (cached) {
    // Try jurisdiction-specific first
    let instruction = cached.get(cacheKey)
    // Fall back to wildcard if no jurisdiction-specific found
    if (!instruction && jurisdictionCode !== '*') {
      instruction = cached.get(`${sectionKey}:*`)
    }
    if (instruction && instruction.isActive) {
      return {
        instruction: instruction.instruction,
        emphasis: instruction.emphasis || undefined,
        avoid: instruction.avoid || undefined,
        style: instruction.style || undefined,
        wordCount: instruction.wordCount || undefined
      }
    }
    return null
  }

  // Load from database - try jurisdiction-specific first, then wildcard
  try {
    let instruction = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId,
        sectionKey,
        jurisdiction: jurisdictionCode,
        isActive: true
      }
    })

    // Fall back to wildcard if no jurisdiction-specific found
    if (!instruction && jurisdictionCode !== '*') {
      instruction = await prisma.userSectionInstruction.findFirst({
        where: {
          sessionId,
          sectionKey,
          jurisdiction: '*',
          isActive: true
        }
      })
    }

    if (instruction) {
      return {
        instruction: instruction.instruction,
        emphasis: instruction.emphasis || undefined,
        avoid: instruction.avoid || undefined,
        style: instruction.style || undefined,
        wordCount: instruction.wordCount || undefined
      }
    }
  } catch (error) {
    console.warn(`[UserInstructionService] Failed to get instruction for ${sessionId}/${jurisdictionCode}/${sectionKey}:`, error)
  }

  return null
}

/**
 * Get all user instructions for a session
 * 
 * @param sessionId - The drafting session ID
 * @param jurisdiction - Optional jurisdiction filter. If provided, returns only that jurisdiction + wildcard "*"
 * @param includeInactive - Include deactivated instructions
 */
export async function getAllUserInstructions(
  sessionId: string,
  jurisdiction?: string,
  includeInactive: boolean = false
): Promise<UserSectionInstruction[]> {
  try {
    const jurisdictionFilter = jurisdiction 
      ? { jurisdiction: { in: [jurisdiction.toUpperCase(), '*'] } }
      : {}
    
    const instructions = await prisma.userSectionInstruction.findMany({
      where: {
        sessionId,
        ...jurisdictionFilter,
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: [{ jurisdiction: 'asc' }, { sectionKey: 'asc' }]
    })

    // Update cache with jurisdiction-aware keys
    const instructionMap = new Map<string, UserSectionInstruction>()
    const result = instructions.map(i => {
      const mapped: UserSectionInstruction = {
        id: i.id,
        sessionId: i.sessionId,
        jurisdiction: i.jurisdiction,
        sectionKey: i.sectionKey,
        instruction: i.instruction,
        emphasis: i.emphasis || undefined,
        avoid: i.avoid || undefined,
        style: i.style || undefined,
        wordCount: i.wordCount || undefined,
        isActive: i.isActive,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt
      }
      // Cache key includes jurisdiction
      instructionMap.set(`${i.sectionKey}:${i.jurisdiction}`, mapped)
      return mapped
    })

    setCachedInstructions(sessionId, instructionMap)
    return result
  } catch (error) {
    console.error(`[UserInstructionService] Failed to get all instructions for ${sessionId}:`, error)
    return []
  }
}

/**
 * Create or update user instruction for a section
 * Supports jurisdiction-specific instructions
 */
export async function upsertUserInstruction(
  input: CreateUserInstructionInput
): Promise<UserSectionInstruction> {
  const jurisdiction = input.jurisdiction?.toUpperCase() || '*'
  
  try {
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId: input.sessionId,
        jurisdiction,
        sectionKey: input.sectionKey
      }
    })

    let result
    if (existing) {
      result = await prisma.userSectionInstruction.update({
        where: { id: existing.id },
        data: {
          instruction: input.instruction,
          emphasis: input.emphasis,
          avoid: input.avoid,
          style: input.style,
          wordCount: input.wordCount,
          isActive: true
        }
      })
    } else {
      result = await prisma.userSectionInstruction.create({
        data: {
          sessionId: input.sessionId,
          jurisdiction,
          sectionKey: input.sectionKey,
          instruction: input.instruction,
          emphasis: input.emphasis,
          avoid: input.avoid,
          style: input.style,
          wordCount: input.wordCount,
          isActive: true
        }
      })
    }

    // Invalidate cache
    invalidateSessionInstructionCache(input.sessionId)

    return {
      id: result.id,
      sessionId: result.sessionId,
      jurisdiction: result.jurisdiction,
      sectionKey: result.sectionKey,
      instruction: result.instruction,
      emphasis: result.emphasis || undefined,
      avoid: result.avoid || undefined,
      style: result.style || undefined,
      wordCount: result.wordCount || undefined,
      isActive: result.isActive,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to upsert instruction:`, error)
    throw error
  }
}

/**
 * Update an existing user instruction
 */
export async function updateUserInstruction(
  id: string,
  input: UpdateUserInstructionInput
): Promise<UserSectionInstruction> {
  try {
    const result = await prisma.userSectionInstruction.update({
      where: { id },
      data: {
        instruction: input.instruction,
        emphasis: input.emphasis,
        avoid: input.avoid,
        style: input.style,
        wordCount: input.wordCount,
        isActive: input.isActive
      }
    })

    // Invalidate cache
    invalidateSessionInstructionCache(result.sessionId)

    return {
      id: result.id,
      sessionId: result.sessionId,
      jurisdiction: result.jurisdiction,
      sectionKey: result.sectionKey,
      instruction: result.instruction,
      emphasis: result.emphasis || undefined,
      avoid: result.avoid || undefined,
      style: result.style || undefined,
      wordCount: result.wordCount || undefined,
      isActive: result.isActive,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to update instruction:`, error)
    throw error
  }
}

/**
 * Delete user instruction
 */
export async function deleteUserInstruction(id: string): Promise<void> {
  try {
    const instruction = await prisma.userSectionInstruction.findUnique({
      where: { id }
    })

    if (instruction) {
      await prisma.userSectionInstruction.delete({
        where: { id }
      })
      invalidateSessionInstructionCache(instruction.sessionId)
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to delete instruction:`, error)
    throw error
  }
}

/**
 * Deactivate all user instructions for a section (soft delete)
 */
export async function deactivateUserInstruction(
  sessionId: string,
  sectionKey: string
): Promise<void> {
  try {
    await prisma.userSectionInstruction.updateMany({
      where: {
        sessionId,
        sectionKey
      },
      data: {
        isActive: false
      }
    })
    invalidateSessionInstructionCache(sessionId)
  } catch (error) {
    console.error(`[UserInstructionService] Failed to deactivate instruction:`, error)
    throw error
  }
}

/**
 * Bulk save user instructions for multiple sections
 */
export async function bulkSaveUserInstructions(
  sessionId: string,
  instructions: Record<string, {
    instruction: string
    emphasis?: string
    avoid?: string
    style?: string
    wordCount?: number
  }>
): Promise<UserSectionInstruction[]> {
  const results: UserSectionInstruction[] = []

  for (const [sectionKey, data] of Object.entries(instructions)) {
    if (data.instruction && data.instruction.trim()) {
      const result = await upsertUserInstruction({
        sessionId,
        sectionKey,
        instruction: data.instruction,
        emphasis: data.emphasis,
        avoid: data.avoid,
        style: data.style,
        wordCount: data.wordCount
      })
      results.push(result)
    }
  }

  return results
}

// ============================================================================
// Prompt Building Helpers
// ============================================================================

/**
 * Build user instruction block for inclusion in LLM prompt
 * 
 * CRITICAL: User instructions have ABSOLUTE HIGHEST PRIORITY.
 * They MUST override any conflicting base prompts or top-up prompts.
 */
export function buildUserInstructionBlock(
  userInstruction: UserInstructionContext | null
): string {
  if (!userInstruction) return ''

  const lines: string[] = []
  
  // Strong emphasis on priority
  lines.push('\n\n╔════════════════════════════════════════════════════════════╗')
  lines.push('║  USER CUSTOM INSTRUCTIONS - HIGHEST PRIORITY                ║')
  lines.push('║  These instructions OVERRIDE all other guidance.            ║')
  lines.push('║  If any conflict exists with base or jurisdiction prompts,  ║')
  lines.push('║  ALWAYS follow the user instructions below.                 ║')
  lines.push('╚════════════════════════════════════════════════════════════╝')
  lines.push('')
  lines.push(`**Primary Instruction:** ${userInstruction.instruction}`)

  if (userInstruction.emphasis) {
    lines.push(`\n**MUST Focus On:** ${userInstruction.emphasis}`)
  }

  if (userInstruction.avoid) {
    lines.push(`\n**MUST Avoid:** ${userInstruction.avoid}`)
  }

  if (userInstruction.style) {
    lines.push(`\n**Required Style:** ${userInstruction.style}`)
  }

  if (userInstruction.wordCount) {
    lines.push(`\n**Target Word Count:** ~${userInstruction.wordCount} words`)
  }

  lines.push('\n⚠️ REMINDER: The above user instructions take precedence over ALL other prompts.')
  
  return lines.join('\n')
}

/**
 * Get all user instructions for a session as a map (for prompt building)
 */
export async function getUserInstructionsMap(
  sessionId: string
): Promise<Record<string, UserInstructionContext>> {
  const instructions = await getAllUserInstructions(sessionId)
  const result: Record<string, UserInstructionContext> = {}

  for (const instruction of instructions) {
    if (instruction.isActive) {
      result[instruction.sectionKey] = {
        instruction: instruction.instruction,
        emphasis: instruction.emphasis,
        avoid: instruction.avoid,
        style: instruction.style,
        wordCount: instruction.wordCount
      }
    }
  }

  return result
}

