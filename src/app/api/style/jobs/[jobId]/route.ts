import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';
import { StyleTrainingJobStatus } from '@/types/persona-sync';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    // Authenticate
    const authResult = await authenticateUser(request);
    if (authResult.error) {
      return NextResponse.json(
        { error: authResult.error.message },
        { status: authResult.error.status }
      );
    }

    const { jobId } = params;

    // Get the job
    const job = await prisma.styleTrainingJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Verify tenant access
    if (authResult.user.tenantId !== job.tenantId &&
        !authResult.user.roles.includes('OWNER') &&
        !authResult.user.roles.includes('ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized: Access denied' },
        { status: 403 }
      );
    }

    const response: StyleTrainingJobStatus = {
      jobId: job.id,
      status: job.status.toLowerCase() as any,
      progress: job.status === 'COMPLETED' ? 100 :
               job.status === 'PROCESSING' ? 50 :
               job.status === 'PENDING' ? 0 : undefined,
      metrics: job.metrics as any,
      error: job.error || undefined,
      completedAt: job.completedAt?.toISOString()
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Get job status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
