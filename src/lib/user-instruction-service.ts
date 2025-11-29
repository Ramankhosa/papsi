/**
 * User Instruction Service
 * 
 * Manages user-provided custom instructions for patent sections.
 * These are the highest priority in the prompt hierarchy:
 * 
 * 1. SUPERSET_PROMPTS (base, universal)
 * 2. Country top-up prompts (database/JSON)
 * 3. User instructions (per session - HIGHEST PRIORITY)
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

// ============================================================================
// Core CRUD Operations
// ============================================================================

/**
 * Get user instruction for a specific section in a session
 */
export async function getUserInstruction(
  sessionId: string,
  sectionKey: string
): Promise<UserInstructionContext | null> {
  // Check cache first
  const cached = getCachedInstructions(sessionId)
  if (cached) {
    const instruction = cached.get(sectionKey)
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

  // Load from database
  try {
    const instruction = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId,
        sectionKey,
        isActive: true
      }
    })

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
    console.warn(`[UserInstructionService] Failed to get instruction for ${sessionId}/${sectionKey}:`, error)
  }

  return null
}

/**
 * Get all user instructions for a session
 */
export async function getAllUserInstructions(
  sessionId: string,
  includeInactive: boolean = false
): Promise<UserSectionInstruction[]> {
  try {
    const instructions = await prisma.userSectionInstruction.findMany({
      where: {
        sessionId,
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: { sectionKey: 'asc' }
    })

    // Update cache
    const instructionMap = new Map<string, UserSectionInstruction>()
    const result = instructions.map(i => {
      const mapped: UserSectionInstruction = {
        id: i.id,
        sessionId: i.sessionId,
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
      instructionMap.set(i.sectionKey, mapped)
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
 */
export async function upsertUserInstruction(
  input: CreateUserInstructionInput
): Promise<UserSectionInstruction> {
  try {
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId: input.sessionId,
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
 */
export function buildUserInstructionBlock(
  userInstruction: UserInstructionContext | null
): string {
  if (!userInstruction) return ''

  const lines: string[] = []
  
  lines.push('\n**User-Provided Instructions (HIGHEST PRIORITY):**')
  lines.push(userInstruction.instruction)

  if (userInstruction.emphasis) {
    lines.push(`\n**Focus/Emphasize:** ${userInstruction.emphasis}`)
  }

  if (userInstruction.avoid) {
    lines.push(`\n**Avoid/Exclude:** ${userInstruction.avoid}`)
  }

  if (userInstruction.style) {
    lines.push(`\n**Preferred Style:** ${userInstruction.style}`)
  }

  if (userInstruction.wordCount) {
    lines.push(`\n**Target Word Count:** ~${userInstruction.wordCount} words`)
  }

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

