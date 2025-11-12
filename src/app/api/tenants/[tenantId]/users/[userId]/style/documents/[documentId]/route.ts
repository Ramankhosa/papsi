import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'
import fs from 'fs'
import path from 'path'
import { StyleLearner } from '@/lib/persona-sync'

const prisma = new PrismaClient()

export async function DELETE(
  request: NextRequest,
  { params }: { params: { tenantId: string; userId: string; documentId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
    }
    const { tenantId, userId, documentId } = params as any

    if (!auth.user.roles.includes('OWNER') && !auth.user.roles.includes('ADMIN') && auth.user.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const doc = await prisma.document.findFirst({ where: { id: documentId, tenantId, userId } })
    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Delete DB row first
    await prisma.document.delete({ where: { id: documentId } })

    // Attempt to delete file from disk
    if (doc.contentPtr && fs.existsSync(doc.contentPtr)) {
      try { fs.unlinkSync(doc.contentPtr) } catch (e) { console.warn('Failed to unlink file', e) }
    }

    // Delete cached per-document style JSON if exists
    try {
      const jsonPath = path.join(process.cwd(), 'uploads', 'persona-sync', doc.tenantId, `${doc.hash}.style.json`)
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath)
      }
    } catch (e) { console.warn('Failed to unlink style json', e) }

    // Recompute merged style profile from remaining documents
    const remaining = await prisma.document.findMany({ where: { tenantId, userId, type: 'SAMPLE' }, orderBy: { createdAt: 'asc' } })

    if (remaining.length === 0) {
      // No documents left — clear style profiles
      await prisma.styleProfile.deleteMany({ where: { tenantId, userId } })
      return NextResponse.json({ success: true, profileCleared: true, message: 'No documents left. Style profile cleared.' })
    }

    // Load or regenerate per-doc profiles
    const perDocProfiles: any[] = []
    for (const d of remaining) {
      const jsonPath = path.join(process.cwd(), 'uploads', 'persona-sync', tenantId, `${d.hash}.style.json`)
      let single: any | null = null
      if (fs.existsSync(jsonPath)) {
        try { single = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) } catch { single = null }
      }
      if (!single) {
        const buffer = fs.readFileSync(d.contentPtr!)
        single = await StyleLearner.generateProfileFromBuffersWithImages([{ buffer, filename: d.filename }])
        fs.writeFileSync(jsonPath, JSON.stringify(single, null, 2))
      }
      perDocProfiles.push(single)
    }

    const merged = await (StyleLearner as any).mergeProfiles(perDocProfiles)
    if (process.env.PERSONA_SYNC_DEBUG === '1') {
      console.log('[PersonaSync][Recompute.afterDelete]', JSON.stringify({
        remainingDocIds: remaining.map(d=>d.id),
        sections: Object.fromEntries(Object.entries(merged.sections || {}).map(([k, v]: any)=> [k, { word_count_range: v.word_count_range, sentence_count_range: v.sentence_count_range, micro_rules: v.micro_rules }]))
      }, null, 2))
    }

    // Create a synthetic completed job to mark which docs trained last
    await prisma.styleTrainingJob.create({
      data: {
        tenantId,
        userId,
        status: 'COMPLETED',
        inputsMetadata: {
          documentCount: remaining.length,
          documentIds: remaining.map(d => d.id),
          totalTokens: merged.metadata.total_tokens
        },
        metrics: {
          totalTokens: merged.metadata.total_tokens,
          entropy: merged.metadata.entropy_score,
          coverage: merged.metadata.coverage_score
        },
        completedAt: new Date(),
        startedAt: new Date()
      }
    })

    // Version bump style profile
    const existing = await prisma.styleProfile.findFirst({ where: { tenantId, userId }, orderBy: { version: 'desc' } })
    const newVersion = (existing?.version || 0) + 1
    await prisma.styleProfile.create({
      data: {
        tenantId,
        userId,
        version: newVersion,
        json: merged as any,
        status: 'LEARNED',
        createdBy: userId
      }
    })

    return NextResponse.json({ success: true, message: 'Profile updated after source deletion' })
  } catch (error) {
    console.error('Delete document error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
