import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';

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

    // Only tenant admins can lock profiles
    if (!authResult.user.roles.includes('OWNER') &&
        !authResult.user.roles.includes('ADMIN') &&
        authResult.user.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized: Tenant admin access required' },
        { status: 403 }
      );
    }

    // Get the latest profile
    const profile = await prisma.styleProfile.findFirst({
      where: { tenantId, userId },
      orderBy: { version: 'desc' }
    });

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    if (profile.lockedAt) {
      return NextResponse.json(
        { error: 'Profile is already locked' },
        { status: 400 }
      );
    }

    // Lock the profile
    await prisma.styleProfile.update({
      where: { id: profile.id },
      data: {
        lockedAt: new Date(),
        lockedBy: authResult.user.id
      }
    });

    return NextResponse.json({
      message: 'Profile locked successfully',
      lockedBy: authResult.user.id,
      lockedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Lock style profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
