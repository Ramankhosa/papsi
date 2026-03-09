import { NextResponse } from 'next/server';
import fs from 'fs/promises';

import { prisma } from '@/lib/prisma';
import {
  getImageContentType,
  getPaperFigureImageCandidates
} from '@/lib/figure-generation/paper-figure-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  const { paperId: sessionId, figureId } = await context.params;

  const figure = await prisma.figurePlan.findFirst({
    where: { id: figureId, sessionId },
    select: { nodes: true }
  });

  if (!figure) {
    return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
  }

  const nodes = typeof figure.nodes === 'object' && figure.nodes !== null && !Array.isArray(figure.nodes)
    ? figure.nodes as Record<string, unknown>
    : {};
  const rawImagePath = typeof nodes.imagePath === 'string' ? nodes.imagePath : null;

  if (!rawImagePath) {
    return NextResponse.json({ error: 'Figure image not found' }, { status: 404 });
  }

  const candidates = getPaperFigureImageCandidates(rawImagePath);

  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': getImageContentType(candidate),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Disposition': 'inline'
        }
      });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[PaperFigureImage] Failed to read ${candidate}:`, error?.message || error);
      }
    }
  }

  console.warn('[PaperFigureImage] No readable file found for image path:', rawImagePath);
  return NextResponse.json({ error: 'Figure image file not found' }, { status: 404 });
}
