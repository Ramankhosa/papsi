import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';
import { StyleProfileResponse, StyleProfile } from '@/types/persona-sync';

const prisma = new PrismaClient();

export async function GET(
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

    // Verify tenant access (tenant admin, owner, or the user themselves)
    if (!authResult.user.roles.includes('OWNER') &&
        !authResult.user.roles.includes('ADMIN') &&
        authResult.user.tenantId !== tenantId &&
        authResult.user.id !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized: Access denied' },
        { status: 403 }
      );
    }

    // Get the latest style profile
    const profile = await prisma.styleProfile.findFirst({
      where: {
        tenantId,
        userId
      },
      orderBy: {
        version: 'desc'
      }
    });

    const response: StyleProfileResponse = {
      profile: profile ? profile.json as any : null,
      status: profile ? profile.status.toLowerCase() as any : 'not_learned',
      lastUpdated: profile ? profile.updatedAt.toISOString() : new Date().toISOString(),
      version: profile?.version || 0,
      locked: !!profile?.lockedAt,
      lockedBy: profile?.lockedBy || undefined,
      lockedAt: profile?.lockedAt?.toISOString() || undefined
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Get style profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    // Only tenant admins can edit profiles
    if (!authResult.user.roles.includes('OWNER') &&
        !authResult.user.roles.includes('ADMIN') &&
        authResult.user.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized: Tenant admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { preferredTerms, tabooTerms } = body;

    // Get the latest profile
    const profile = await prisma.styleProfile.findFirst({
      where: { tenantId, userId },
      orderBy: { version: 'desc' }
    });

    if (!profile || profile.lockedAt) {
      return NextResponse.json(
        { error: 'Profile not found or locked' },
        { status: 404 }
      );
    }

    // Update the profile JSON
    const profileData = profile.json as unknown as StyleProfile;
    const updatedJson = {
      ...profileData,
      global: {
        ...profileData.global,
        terminology: {
          ...profileData.global.terminology,
          preferred: preferredTerms || profileData.global.terminology.preferred,
          taboo: tabooTerms || profileData.global.terminology.taboo
        }
      }
    };

    // Create new version
    const newProfile = await prisma.styleProfile.create({
      data: {
        tenantId,
        userId,
        version: profile.version + 1,
        json: updatedJson as any,
        status: profile.status,
        createdBy: authResult.user.user_id
      }
    });

    return NextResponse.json({
      message: 'Profile updated successfully',
      version: newProfile.version
    });

  } catch (error) {
    console.error('Update style profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
