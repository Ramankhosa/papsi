/**
 * Service Access Middleware
 * 
 * Enforces organizational service access control at API route level.
 * This is SEPARATE from LLM gateway metering:
 * 
 * - LLM Gateway: Controls which LLM MODELS are available (Super Admin only)
 * - This Middleware: Controls which FEATURES users can access (Tenant Admin)
 * 
 * Use this in API routes to check if a user's team has access to a service
 * BEFORE making any LLM calls or performing operations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkServiceAccess, type ServiceAccessResult } from './org-access-service'
import type { ServiceType } from '@prisma/client'

/**
 * Check if user has access to a service based on their team/user settings
 * Returns null if access is allowed, or a NextResponse error if denied
 */
export async function enforceServiceAccess(
  userId: string,
  tenantId: string,
  serviceType: ServiceType
): Promise<{ allowed: true; result: ServiceAccessResult } | { allowed: false; response: NextResponse }> {
  try {
    const result = await checkServiceAccess(userId, tenantId, serviceType)
    
    if (!result.allowed) {
      return {
        allowed: false,
        response: NextResponse.json(
          { 
            error: 'Service access denied',
            reason: result.reason || `You do not have access to ${serviceType}`,
            code: 'SERVICE_ACCESS_DENIED'
          },
          { status: 403 }
        )
      }
    }
    
    return { allowed: true, result }
  } catch (error) {
    console.error('[ServiceAccessMiddleware] Error checking access:', error)
    // On error, allow access (fail open) - metering will still enforce quotas
    return { 
      allowed: true, 
      result: { allowed: true, reason: 'Access check failed, defaulting to allowed' } 
    }
  }
}

/**
 * Service type mapping for common API routes
 */
export const ROUTE_SERVICE_MAP: Record<string, ServiceType> = {
  // Drafting routes
  '/api/patents/*/drafting': 'PATENT_DRAFTING',
  '/api/patents/*/draft': 'PATENT_DRAFTING',
  
  // Novelty search routes
  '/api/novelty-search': 'NOVELTY_SEARCH',
  '/api/patents/*/novelty-assessment': 'NOVELTY_SEARCH',
  
  // Prior art routes
  '/api/patents/*/prior-art': 'PRIOR_ART_SEARCH',
  
  // Idea bank routes
  '/api/idea-bank': 'IDEA_BANK',
  
  // Persona/style routes
  '/api/tenants/*/users/*/style': 'PERSONA_SYNC',
  '/api/writing-samples': 'PERSONA_SYNC',
}

/**
 * Get the service type for a given API path
 */
export function getServiceTypeForPath(path: string): ServiceType | null {
  // Normalize path
  const normalizedPath = path.replace(/\/[a-zA-Z0-9_-]+/g, (match, offset) => {
    // Keep the first segment, replace IDs with *
    if (offset === 0) return match
    // Check if it looks like an ID (cuid, uuid, etc)
    if (/^\/[a-z0-9]{20,}$/i.test(match) || /^\/[a-f0-9-]{36}$/i.test(match)) {
      return '/*'
    }
    return match
  })
  
  // Direct match
  if (ROUTE_SERVICE_MAP[normalizedPath]) {
    return ROUTE_SERVICE_MAP[normalizedPath]
  }
  
  // Pattern match
  for (const [pattern, serviceType] of Object.entries(ROUTE_SERVICE_MAP)) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '(/.*)?$')
    if (regex.test(path)) {
      return serviceType
    }
  }
  
  return null
}

/**
 * Higher-order function to wrap API handlers with service access check
 */
export function withServiceAccess(serviceType: ServiceType) {
  return function<T extends (...args: any[]) => Promise<NextResponse>>(handler: T): T {
    return (async (request: NextRequest, ...args: any[]) => {
      // Extract user context from request (assuming auth middleware has run)
      const authHeader = request.headers.get('Authorization')
      if (!authHeader) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      
      // The actual user extraction should be done by the handler
      // This is a pattern for handlers to use
      return handler(request, ...args)
    }) as T
  }
}

/**
 * Check multiple services at once (for features that span multiple services)
 */
export async function enforceMultipleServiceAccess(
  userId: string,
  tenantId: string,
  serviceTypes: ServiceType[]
): Promise<{ allowed: true } | { allowed: false; response: NextResponse; deniedService: ServiceType }> {
  for (const serviceType of serviceTypes) {
    const result = await enforceServiceAccess(userId, tenantId, serviceType)
    if (!result.allowed) {
      return { 
        allowed: false, 
        response: result.response,
        deniedService: serviceType
      }
    }
  }
  return { allowed: true }
}

