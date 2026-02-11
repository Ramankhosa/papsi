import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  figureType: z.string().min(1).optional(),
  notes: z.string().optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where
  });
}

function toResponse(plan: any) {
  const meta = typeof plan.nodes === 'object' && plan.nodes !== null ? plan.nodes : {};
  
  // Image path is stored in nodes JSON (not a separate field)
  const imagePath = meta.imagePath || null;
  
  // Determine status based on whether image exists or explicit status
  let status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED' = 'PLANNED';
  if (meta.status) {
    status = meta.status;
  } else if (imagePath) {
    status = 'GENERATED';
  }
  
  const figureType = meta.figureType || 'flowchart';
  const category = meta.category || 'DIAGRAM';
  
  return {
    id: plan.id,
    figureNo: plan.figureNo,
    title: plan.title,
    caption: meta.caption || plan.description || '',
    figureType,
    category,
    notes: meta.notes || '',
    status,
    imagePath,
    generatedCode: meta.generatedCode || null,
    suggestionMeta: meta.suggestionMeta || null
  };
}

export async function PUT(request: NextRequest, context: { params: Promise<{ paperId: string; figureId: string }> }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId, figureId } = await context.params;
    
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }
    if (!figureId) {
      return NextResponse.json({ error: 'Figure ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    const existing = await prisma.figurePlan.findFirst({
      where: { id: figureId, sessionId }
    });
    if (!existing) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
    }

    const meta = typeof existing.nodes === 'object' && existing.nodes !== null && !Array.isArray(existing.nodes) ? existing.nodes as Record<string, unknown> : {};
    const nextMeta = {
      ...meta,
      figureType: data.figureType ?? meta.figureType,
      caption: data.caption ?? meta.caption,
      notes: data.notes ?? meta.notes
    };

    const updated = await prisma.figurePlan.update({
      where: { id: figureId },
      data: {
        title: data.title ?? existing.title,
        description: data.caption ?? existing.description,
        nodes: nextMeta as any
      }
    });

    return NextResponse.json({ figure: toResponse(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[PaperFigures] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update figure' }, { status: 500 });
  }
}

/**
 * Helper to delete an image file from disk given its public path
 */
async function deleteImageFile(imagePath: string | null | undefined): Promise<void> {
  if (!imagePath) return;
  try {
    // imagePath is like /uploads/figures/figure_xxx_123.png or /uploads/paper-sketches/session/file.png
    const filePath = path.join(process.cwd(), 'public', imagePath);
    await fs.unlink(filePath);
    console.log(`[PaperFigures] Deleted image file: ${filePath}`);
  } catch (err: any) {
    // File may not exist - that's ok
    if (err?.code !== 'ENOENT') {
      console.warn(`[PaperFigures] Failed to delete image file ${imagePath}:`, err?.message);
    }
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ paperId: string; figureId: string }> }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId, figureId } = await context.params;
    
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!figureId) {
      return NextResponse.json({ error: 'Figure ID is required' }, { status: 400 });
    }

    // Check for query param: ?imageOnly=true to only clear the generated image
    const imageOnly = request.nextUrl.searchParams.get('imageOnly') === 'true';

    const figure = await prisma.figurePlan.findFirst({
      where: { id: figureId, sessionId }
    });

    if (!figure) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
    }

    const meta = (figure.nodes as any) || {};
    const imagePath = meta.imagePath || null;

    if (imageOnly) {
      // Only clear the generated image, reset figure to PLANNED state
      await deleteImageFile(imagePath);

      // Remove generation-related fields while keeping plan metadata
      const keysToRemove = ['imagePath', 'generatedCode', 'status', 'checksum', 'fileSize', 'generatedAt', 'source', 'lastModificationRequest'];
      const cleanMeta: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(meta)) {
        if (!keysToRemove.includes(key)) {
          cleanMeta[key] = value;
        }
      }

      const updatedNodes = { ...cleanMeta, status: 'PLANNED' };

      await prisma.figurePlan.update({
        where: { id: figureId },
        data: {
          nodes: updatedNodes as any
        }
      });

      return NextResponse.json({ cleared: true, figure: toResponse({ ...figure, nodes: updatedNodes }) });
    }

    // Full delete: remove image file + database record
    await deleteImageFile(imagePath);

    await prisma.figurePlan.delete({
      where: { id: figureId }
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[PaperFigures] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete figure' }, { status: 500 });
  }
}
