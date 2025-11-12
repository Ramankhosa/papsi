import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getGatedStyleInstructions } from '@/lib/style-instruction-builder'

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const { patentId } = params

    // Verify patent access (same as drafting route)
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: auth.user.id },
          {
            project: {
              OR: [
                { userId: auth.user.id },
                { collaborators: { some: { userId: auth.user.id } } }
              ]
            }
          }
        ]
      },
      select: { id: true }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 })
    }

    // Determine if style instructions are actively applied (plan + learned profile)
    const instr = await getGatedStyleInstructions(auth.user.tenantId, auth.user.id)

    // Also surface latest profile status for transparency
    const latestProfile = await prisma.styleProfile.findFirst({
      where: { tenantId: auth.user.tenantId, userId: auth.user.id },
      orderBy: { version: 'desc' }
    })

    return NextResponse.json({
      enabled: !!instr,
      sections: instr ? Object.keys(instr) : [],
      profile: latestProfile
        ? {
            version: latestProfile.version,
            status: latestProfile.status,
            updatedAt: latestProfile.updatedAt.toISOString()
          }
        : null
    })
  } catch (e) {
    console.error('style-status error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

