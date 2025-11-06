import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PDFReportService } from '@/lib/pdf-report-service';
import { verifyJWT } from '@/lib/auth';

/**
 * GET /api/novelty-search/[searchId]/report
 * Get or generate PDF report for novelty search
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Verify JWT token
    const payload = verifyJWT(jwtToken);
    if (!payload || !payload.sub) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const userId = payload.sub;

    // Get novelty search
    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: {
        id: searchId,
        userId: userId
      }
    });

    if (!searchRun) {
      return NextResponse.json(
        { error: 'Novelty search not found' },
        { status: 404 }
      );
    }

    // Check if search is completed
    if (searchRun.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Novelty search is not completed yet' },
        { status: 400 }
      );
    }

    // Generate or get existing PDF report
    let reportUrl: string;
    try {
      reportUrl = await PDFReportService.generateComprehensiveNoveltyReport(searchId);

      // Update the search run with the report URL if not already set
      if (!searchRun.reportUrl) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { reportUrl }
        });
      }

      return NextResponse.json({
        success: true,
        reportUrl,
        message: 'PDF report generated successfully'
      });

    } catch (pdfError) {
      console.error('PDF report generation failed:', pdfError);
      return NextResponse.json(
        { error: 'Failed to generate PDF report' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

