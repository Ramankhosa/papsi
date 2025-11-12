import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'

const prisma = new PrismaClient()

export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string; userId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
    }
    const { tenantId, userId } = params

    if (!auth.user.roles.includes('OWNER') && !auth.user.roles.includes('ADMIN') && auth.user.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get user's documents
    const docs = await prisma.document.findMany({
      where: { tenantId, userId, type: 'SAMPLE' },
      orderBy: { createdAt: 'desc' }
    })

    // Find most recent completed training job to mark which docs were used
    const lastJob = await prisma.styleTrainingJob.findFirst({
      where: { tenantId, userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' }
    })

    const trainedIds = new Set<string>(
      Array.isArray((lastJob?.inputsMetadata as any)?.documentIds)
        ? (lastJob?.inputsMetadata as any).documentIds
        : []
    )

    return NextResponse.json({
      documents: docs.map(d => ({
        id: d.id,
        filename: d.filename,
        sizeBytes: d.sizeBytes,
        tokens: d.tokens,
        createdAt: d.createdAt.toISOString(),
        trained: trainedIds.has(d.id)
      }))
    })
  } catch (error) {
    console.error('List documents error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

