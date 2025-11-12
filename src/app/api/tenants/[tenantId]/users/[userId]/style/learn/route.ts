import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';
import { StyleLearner } from '@/lib/persona-sync';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();

export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string; userId: string } }
) {
  try {
    // Authenticate and authorize
    const authResult = await authenticateUser(request);
    if (authResult.error) {
      return NextResponse.json(
        { error: authResult.error.message },
        { status: authResult.error.status }
      );
    }

    const { tenantId, userId } = params;

    // Verify tenant access (tenant admin or owner)
    if (!authResult.user.roles.includes('OWNER') &&
        !authResult.user.roles.includes('ADMIN') &&
        authResult.user.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized: Tenant admin access required' },
        { status: 403 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const jurisdictionHints = formData.get('jurisdictionHints')?.toString().split(',') || [];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'At least 1 document required' },
        { status: 400 }
      );
    }

    if (files.length > 3) {
      return NextResponse.json(
        { error: 'Maximum 3 documents allowed' },
        { status: 400 }
      );
    }

    // Validate file types
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'];
    console.log('Validating files:', files.map(f => ({ name: f.name, type: f.type, size: f.size })));
    for (const file of files) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isValidType = allowedTypes.includes(file.type) ||
                         ['pdf', 'docx', 'txt', 'md'].includes(fileExtension || '');

      if (!isValidType) {
        console.error(`Unsupported file type: ${file.name}, type: ${file.type}, extension: ${fileExtension}`);
        return NextResponse.json(
          { error: `Unsupported file type: ${file.name}. Supported: PDF, DOCX, TXT, MD` },
          { status: 400 }
        );
      }

      if (file.size === 0) {
        console.error(`Empty file: ${file.name}`);
        return NextResponse.json(
          { error: `Empty file: ${file.name}` },
          { status: 400 }
        );
      }
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'uploads', 'persona-sync', tenantId);
    await mkdir(uploadsDir, { recursive: true });

    // Save files and create document records
    const documents: any[] = [];
    let totalTokens = 0;

    for (const file of files) {
      try {
        console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
        const fileName = `${hash}.${fileExtension}`;
        const filePath = path.join(uploadsDir, fileName);

        console.log(`Saving file to: ${filePath}`);

        // Save file to disk
        await writeFile(filePath, fileBuffer);

        // Verify file was written
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
          throw new Error(`File was not saved to disk: ${filePath}`);
        }

        console.log(`File saved successfully. Extracting text...`);

        // Extract text and count tokens
        const text = await StyleLearner.extractText(fileBuffer, file.name);
        if (!text || text.trim().length === 0) {
          console.error(`Failed to extract text from ${file.name}`);
          return NextResponse.json(
            { error: `Could not extract text from ${file.name}. Please ensure the file contains readable text.` },
            { status: 400 }
          );
        }

        const tokens = StyleLearner.estimateTokens(text);
        totalTokens += tokens;

        console.log(`Creating document record for ${file.name}, tokens: ${tokens}`);

        const document = await prisma.document.create({
          data: {
            tenantId,
            userId,
            type: 'SAMPLE',
            filename: file.name,
            contentPtr: filePath,
            tokens,
            hash,
            mimeType: file.type,
            sizeBytes: file.size
          }
        });

        console.log(`Document created successfully with ID: ${document.id}`);
        documents.push(document);

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);

        // Clean up any partially created files
        try {
          const fs = require('fs');
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
          const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
          const fileName = `${hash}.${fileExtension}`;
          const filePath = path.join(uploadsDir, fileName);

          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up file: ${filePath}`);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }

        return NextResponse.json(
          { error: `Failed to process file ${file.name}: ${error instanceof Error ? error.message : String(error)}` },
          { status: 500 }
        );
      }
    }

    // Validate total token count (reasonable range for training)
    if (totalTokens < 500) {
      return NextResponse.json(
        { error: 'Document too short for training (minimum 500 tokens)' },
        { status: 400 }
      );
    }

    if (totalTokens > 50000) {
      return NextResponse.json(
        { error: 'Document too large for training (maximum 50k tokens)' },
        { status: 400 }
      );
    }

    // Create training job and start processing in a transaction
    const result = await prisma.$transaction(async (tx) => {
      console.log(`Creating training job for tenant ${tenantId}, user ${userId}`);

      const job = await tx.styleTrainingJob.create({
        data: {
          tenantId,
          userId,
          status: 'PENDING',
          inputsMetadata: {
            documentCount: documents.length,
            documentIds: documents.map(d => d.id),
            jurisdictionHints,
            totalTokens
          }
        }
      });

      console.log(`Training job created with ID: ${job.id}`);

      // Start background processing
      // Pass tenant context directly to avoid JWT resolution issues in background
      const tenantContext = {
        tenantId,
        userId,
        planId: 'cmhrnisgm000sz151aawpn792' // PRO_PLAN database ID
      }

      // Start background processing (outside transaction since it can take time)
      processStyleLearning(job.id, documents, jurisdictionHints, tenantContext).catch((error) => {
        console.error('Background processing failed:', error);
        // Update job status to failed if background processing fails immediately
        tx.styleTrainingJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', error: error.message }
        }).catch(console.error);
      });

      return job;
    });

    return NextResponse.json({
      jobId: result.id,
      status: 'accepted',
      message: 'Style learning job started successfully',
      estimatedDuration: 180 // 3 minutes
    });

  } catch (error) {
    console.error('Style learning error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function processStyleLearning(
  jobId: string,
  documents: any[],
  jurisdictionHints: string[],
  tenantContext: { tenantId: string; userId: string; planId: string }
) {
  try {
    // Update job status to processing
    await prisma.styleTrainingJob.update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        startedAt: new Date()
      }
    });

    // Use ALL current sample documents for this user (existing + newly uploaded)
    const allDocs = await prisma.document.findMany({
      where: { tenantId: tenantContext.tenantId, userId: tenantContext.userId, type: 'SAMPLE' },
      orderBy: { createdAt: 'asc' }
    })

    // Read/generate per-document profiles and cache them alongside uploaded files
    const perDocProfiles: any[] = []
    for (const doc of allDocs) {
      const fsmod = await import('fs')
      const jsonPath = path.join(process.cwd(), 'uploads', 'persona-sync', tenantContext.tenantId, `${doc.hash}.style.json`)
      let singleProfile: any | null = null
      if (fsmod.existsSync(jsonPath)) {
        try {
          singleProfile = JSON.parse(fsmod.readFileSync(jsonPath, 'utf-8'))
        } catch { singleProfile = null }
      }
      if (!singleProfile) {
        const fileBuffer = fsmod.readFileSync(doc.contentPtr as string)
        singleProfile = await StyleLearner.generateProfileFromBuffersWithImages(
          [{ buffer: fileBuffer, filename: doc.filename }],
          jurisdictionHints,
          tenantContext
        )
        await writeFile(jsonPath, JSON.stringify(singleProfile, null, 2))
      }
      perDocProfiles.push(singleProfile)
    }

    // Merge individual profiles statistically into a single master profile
    const profile = await (StyleLearner as any).mergeProfiles(perDocProfiles, tenantContext)
    if (process.env.PERSONA_SYNC_DEBUG === '1') {
      console.log('[PersonaSync][MergedProfile.beforeSave]', JSON.stringify({
        global: profile.global,
        sections: Object.fromEntries(Object.entries(profile.sections || {}).map(([k, v]: any)=> [k, { word_count_range: v.word_count_range, sentence_count_range: v.sentence_count_range, micro_rules: v.micro_rules }]))
      }, null, 2))
    }

    // Validate profile quality
    const validation = StyleLearner.validateProfile(profile);

    // Determine final status
    const finalStatus = validation.isValid ? 'LEARNED' : 'NEEDS_MORE_DATA';

    // Get or create style profile
    const existingProfile = await prisma.styleProfile.findFirst({
      where: {
        tenantId: documents[0].tenantId,
        userId: documents[0].userId
      },
      orderBy: { version: 'desc' }
    });

    const newVersion = (existingProfile?.version || 0) + 1;

    const styleProfile = await prisma.styleProfile.create({
      data: {
        tenantId: documents[0].tenantId,
        userId: documents[0].userId,
        version: newVersion,
        json: profile as any, // Cast to Json type for Prisma
        status: finalStatus,
        createdBy: documents[0].userId // Assuming the user who uploaded is the creator
      }
    });

    // Update job as completed and record the full doc set used
    await prisma.styleTrainingJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        inputsMetadata: {
          documentCount: allDocs.length,
          documentIds: allDocs.map(d => d.id),
          jurisdictionHints,
          totalTokens: profile.metadata.total_tokens
        },
        metrics: {
          totalTokens: profile.metadata.total_tokens,
          entropy: profile.metadata.entropy_score,
          coverage: profile.metadata.coverage_score,
          ngrams: [] // Could be populated with actual n-grams
        }
      }
    });

  } catch (error) {
    console.error('Style learning processing error:', error);

    // Update job as failed
    await prisma.styleTrainingJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date()
      }
    });
  }
}
