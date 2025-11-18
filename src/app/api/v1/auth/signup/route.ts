import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, validateATIToken, incrementATITokenUsage, createAuditLog } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail } from '@/lib/mailer'
import { verificationTemplate } from '@/lib/email-templates'

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  atiToken: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100)
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, atiToken, firstName, lastName } = signupSchema.parse(body)

    // Validate ATI token by finding the tenant it belongs to
    const tokenValidation = await validateATIToken(atiToken)

    // Get full token with tenant info for scope checking
    let fullToken = null
    if (tokenValidation.valid && tokenValidation.atiToken) {
      fullToken = await prisma.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken.id },
        include: { tenant: true }
      })
    }

    if (!tokenValidation.valid) {
      return NextResponse.json(
        { code: tokenValidation.error, message: `ATI token validation failed: ${tokenValidation.error}` },
        { status: 400 }
      )
    }

    // Determine scope of the token
    const isPlatformToken = fullToken?.tenant?.atiId === 'PLATFORM'

    // Platform tokens can only be used for super admin creation (not regular signup)
    if (isPlatformToken) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Platform ATI tokens cannot be used for regular user signup' },
        { status: 400 }
      )
    }

    // Get the tenant that owns this token
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenValidation.atiToken!.tenantId! } // All tokens now have tenantId
    })

    if (!tenant) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Tenant not found for ATI token' },
        { status: 400 }
      )
    }

    if (tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // Check if email is already in use globally
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered' },
        { status: 400 }
      )
    }

    // Check if this is the first user for this tenant
    const existingUsersCount = await prisma.user.count({
      where: { tenantId: tenant.id }
    })

    // Validate tenant user limit based on original tenant creation token
    if (existingUsersCount > 0) {
      // Find the original tenant admin user (first user) and their signup token
      const tenantAdmin = await prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          roles: { hasSome: ['OWNER', 'ADMIN'] } // Find tenant admin
        },
        select: {
          id: true,
          signupAtiTokenId: true
        },
        orderBy: { createdAt: 'asc' } // Get the first admin user
      })

      console.log('Tenant user limit validation:', {
        tenantId: tenant.id,
        existingUsersCount,
        tenantAdminFound: !!tenantAdmin,
        tenantAdminSignupTokenId: tenantAdmin?.signupAtiTokenId
      })

      if (tenantAdmin?.signupAtiTokenId) {
        // Get the original token used to create the tenant admin
        const originalToken = await prisma.aTIToken.findUnique({
          where: { id: tenantAdmin.signupAtiTokenId }
        })

        console.log('Original token check:', {
          tokenId: tenantAdmin.signupAtiTokenId,
          tokenFound: !!originalToken,
          tokenMaxUses: originalToken?.maxUses,
          wouldExceedLimit: originalToken?.maxUses ? existingUsersCount >= originalToken.maxUses : false
        })

        // Check if adding this user would exceed the tenant's user limit
        // existingUsersCount is the current count before adding this user
        // So we reject if current count >= maxUses (meaning tenant is already at limit)
        // Note: if maxUses is null/undefined, it means unlimited users allowed
        if (originalToken?.maxUses && existingUsersCount >= originalToken.maxUses) {
          return NextResponse.json(
            {
              code: 'TENANT_USER_LIMIT_EXCEEDED',
              message: `Tenant has reached its maximum user limit of ${originalToken.maxUses} users.`,
              current_users: existingUsersCount,
              max_users: originalToken.maxUses
            },
            { status: 400 }
          )
        }
      } else {
        console.log('No tenant admin with signup token found - allowing signup (unlimited)')
      }
    }

    // Determine role based on context
    let userRole = 'ANALYST' // Default role
    let tokenCreator = null

    if (existingUsersCount === 0) {
      // First user for this tenant - make them OWNER
      userRole = 'OWNER'
    } else {
      // Subsequent users - check if this token was created by super admin (platform scope)
      // or by tenant admin
      tokenCreator = await prisma.auditLog.findFirst({
        where: {
          resource: `ati_token:${tokenValidation.atiToken!.id}`,
          action: 'ATI_ISSUE'
        },
        orderBy: { createdAt: 'desc' }
      })

      // If token was created by super admin (platform scope), assign ADMIN role
      // Otherwise, use the default ANALYST role (can be changed later by tenant admin)
      if (tokenCreator && tokenCreator.actorUserId) {
        const creatorUser = await prisma.user.findUnique({
          where: { id: tokenCreator.actorUserId },
          select: {
            roles: true,
            tenantId: true,
            tenant: {
              select: { atiId: true }
            }
          }
        })

        console.log('Token creator details:', {
          creatorId: tokenCreator.actorUserId,
          creatorRoles: creatorUser?.roles,
          creatorTenantId: creatorUser?.tenantId,
          creatorTenantAtiId: creatorUser?.tenant?.atiId
        })

        // If creator is super admin or belongs to platform tenant, assign ADMIN
        if (creatorUser?.roles?.includes('SUPER_ADMIN') || creatorUser?.tenant?.atiId === 'PLATFORM') {
          userRole = 'ADMIN'
          console.log('Assigned ADMIN role due to super admin token creator')
        } else {
          console.log('Keeping ANALYST role for tenant-admin-created token')
        }
      } else {
        console.log('No token creator found, keeping ANALYST role')
      }
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Use a transaction to ensure atomicity - either everything succeeds or nothing does
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id, // Track which ATI token was used
          roles: [userRole as any],
          status: 'ACTIVE',
          emailVerified: true,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`
        }
      })

      // Create default project for the user
      const defaultProjectName = 'Default Project'
      const defaultProject = await tx.project.create({
        data: {
          name: defaultProjectName,
          userId: user.id
        }
      })

      // Get current token state for status update logic
      const currentToken = await tx.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken!.id }
      })

      // Increment ATI token usage atomically
      await tx.aTIToken.update({
        where: { id: tokenValidation.atiToken!.id },
        data: {
          usageCount: { increment: 1 },
          // Update status if usage limit reached
          ...(currentToken && currentToken.maxUses && currentToken.usageCount + 1 >= currentToken.maxUses
            ? { status: 'USED_UP' }
            : {})
        }
      })

      // Audit log within transaction
      const ip = request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 'unknown'

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: tenant.id,
          action: 'USER_SIGNUP',
          resource: `user:${user.id}`,
          ip,
          meta: {
            email: user.email,
            roles: user.roles,
            assigned_role_reason: existingUsersCount === 0 ? 'first_tenant_user' : 'ati_token_creator_check',
            signup_method: 'ati_token',
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            ati_token_creator: tokenCreator?.actorUserId || null,
            is_first_tenant_user: existingUsersCount === 0
          }
        }
      })

      return user
    })

    const user = result

    // Email verification disabled by default; enable with ENFORCE_EMAIL_VERIFICATION=true
    if (process.env.ENFORCE_EMAIL_VERIFICATION === 'true') {
      try {
        const raw = generateToken()
        const tokenHash = hashToken(raw)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
        const tpl = verificationTemplate(user.email, user.name, raw)
        await sendEmail({ to: user.email, toName: user.name || undefined, subject: tpl.subject, html: tpl.html, text: tpl.text })
      } catch (e) {
        console.warn('Failed to send verification email:', e)
      }
    }

    return NextResponse.json({
      user_id: user.id,
      tenant_id: tenant.id,
      roles: user.roles
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Signup error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

