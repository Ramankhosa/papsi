import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'

const prisma = new PrismaClient()

export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string; userId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
    }

    const { tenantId, userId } = params

    // Allow owner/admin of tenant (or same tenant scope)
    if (!auth.user.roles.includes('OWNER') && !auth.user.roles.includes('ADMIN') && auth.user.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete all style profiles for this user in this tenant
    const deleted = await prisma.styleProfile.deleteMany({
      where: { tenantId, userId }
    })

    // Optionally also clear training jobs (keep history? For now, leave jobs)

    return NextResponse.json({ success: true, deleted: deleted.count })
  } catch (error) {
    console.error('Unlearn error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

