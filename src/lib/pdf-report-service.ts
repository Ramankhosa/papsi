import jsPDF from 'jspdf';
import { NoveltyAssessmentRun, NoveltyDetermination } from '@prisma/client';
import { prisma } from './prisma';
import fs from 'fs';
import path from 'path';

interface NoveltyReportData {
  assessment: NoveltyAssessmentRun & {
    patent: { title: string };
    user: { name: string; email: string };
    llmCalls?: any[];
    intersectingPatents?: any[];
  };
  priorArtRun?: {
    bundle: {
      bundleData: {
        source_summary?: {
          title?: string;
          problem_statement?: string;
          solution_summary?: string;
        };
        core_concepts?: string[];
        technical_features?: string[];
        query_variants?: Array<{
          label: 'BROAD' | 'BASELINE' | 'NARROW';
          q: string;
        }>;
      };
    };
  };
  companyName?: string;
  companyLogo?: string; // Base64 encoded logo
}

export class PDFReportService {

  /**
   * Generate comprehensive PDF report for novelty search (4-stage process)
   */
  static async generateComprehensiveNoveltyReport(searchId: string): Promise<string> {
    try {
      // Fetch novelty search data with all stages
      const searchRun = await prisma.noveltySearchRun.findUnique({
        where: { id: searchId },
        include: {
          user: { select: { name: true, email: true } },
          llmCalls: {
            orderBy: { calledAt: 'asc' },
          }
        }
      });

      if (!searchRun) {
        throw new Error('Novelty search not found');
      }

      const doc = new jsPDF('landscape');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let currentY = 20;

      // Modern color scheme
      const colors = {
        primary: [41, 128, 185],     // Blue
        success: [46, 204, 113],     // Green
        danger: [231, 76, 60],       // Red
        warning: [241, 196, 15],     // Yellow
        gray: [149, 165, 166],       // Gray
        white: [255, 255, 255],      // White
        dark: [44, 62, 80],          // Dark blue
        lightGray: [236, 240, 241],  // Light gray
        accent: [52, 152, 219]       // Light blue
      };

      // Helper function to add colored section headers
      const addSectionHeader = (title: string, color: number[] = colors.primary) => {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.rect(15, currentY, pageWidth - 30, 12, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.text(title, 20, currentY + 8);
        doc.setTextColor(0, 0, 0);
        currentY += 18;
      };

      // Helper function to check page space and add new page if needed
      const checkPageSpace = (neededSpace: number) => {
        if (currentY + neededSpace > pageHeight - 25) {
          doc.addPage();
          currentY = 20;
        }
      };

      // Helper: canonicalize a publication number for matching across stages
      const canonicalizePn = (pn?: string | null) => {
        if (!pn) return '';
        const s = String(pn).toUpperCase().replace(/[^A-Z0-9]/g, '');
        return s.replace(/[A-Z]\d*$/, ''); // strip kind code suffix
      };

      // Helper: draw a dynamic cell (label + value) with auto width/height
      const drawLabeledCell = (
        label: string,
        value: string,
        x: number,
        y: number,
        maxWidth: number
      ): { width: number; height: number } => {
        const paddingX = 4;
        const paddingY = 3;
        const labelFontSize = 8;
        const valueFontSize = 10;

        // Measure value width to decide cell width (cap to maxWidth)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(labelFontSize);
        const labelWidth = doc.getTextWidth(label.toUpperCase()) + 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(valueFontSize);
        const rawValueWidth = doc.getTextWidth(String(value));
        const targetWidth = Math.min(Math.max(60, rawValueWidth + labelWidth + paddingX * 2 + 6), maxWidth);

        // Wrap value within targetWidth
        const innerWidth = targetWidth - paddingX * 2;
        doc.setFontSize(valueFontSize);
        const valueLines = doc.splitTextToSize(String(value || '-'), innerWidth);

        // Compute height: label line + small gap + value lines
        const labelHeight = labelFontSize + 2;
        const valueHeight = valueLines.length * (valueFontSize + 2) * 0.5; // approx line height
        const cellHeight = Math.max(16, paddingY * 2 + labelHeight + valueHeight);

        // Draw box
        doc.setDrawColor(200, 205, 210);
        doc.setFillColor(colors.white[0], colors.white[1], colors.white[2]);
        doc.rect(x, y, targetWidth, cellHeight, 'S');

        // Render label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(labelFontSize);
        doc.setTextColor(90, 90, 90);
        doc.text(label.toUpperCase(), x + paddingX, y + paddingY + 5);

        // Render value
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(valueFontSize);
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.text(valueLines, x + paddingX, y + paddingY + 5 + 6);

        return { width: targetWidth, height: cellHeight };
      };

      // Modern Title Page
      doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');

      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.text('NOVELTY SEARCH REPORT', pageWidth / 2, 80, { align: 'center' });

      doc.setFontSize(16);
      doc.setFont('helvetica', 'normal');
      const titleLines = doc.splitTextToSize(searchRun.title, pageWidth - 80);
      doc.text(titleLines, pageWidth / 2, 110, { align: 'center' });

      doc.setFontSize(12);
      doc.setTextColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
      doc.text(`Search ID: ${searchRun.id}`, pageWidth / 2, 140, { align: 'center' });
      doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 150, { align: 'center' });
      doc.text(`Jurisdiction: ${searchRun.jurisdiction}`, pageWidth / 2, 160, { align: 'center' });

      // Add AI logo/watermark
      doc.setFontSize(10);
      doc.setTextColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
      doc.text('Powered by AI Patent Assistant', pageWidth / 2, pageHeight - 15, { align: 'center' });

      // Table of Contents (placeholder page, will be populated after sections are built)
      doc.addPage();
      const tocPage = doc.getNumberOfPages();
      currentY = 20;
      doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('TABLE OF CONTENTS', 20, 17);
      currentY = 40;

      // Will fill later
      const tocEntries: Array<{ label: string; page: number }> = [];

      // (Executive Summary removed)

      const stage0 = (searchRun as any).stage0Results || {};
      const stage1 = (searchRun as any).stage1Results || {};
      const stage35 = (searchRun as any).stage35Results || [];
      const stage4Raw = (searchRun as any).stage4Results || {};

      // Helper builders (fallbacks from Stage 3.5 results)
      const featuresS0: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];
      const fmArray: any[] = Array.isArray(stage35) ? stage35 : [];

      const computePerPatentCoverage = (featureMaps: any[], features: string[]) => {
        try {
          return featureMaps.map((pm: any) => {
            const cells = Array.isArray(pm?.feature_analysis) ? pm.feature_analysis : [];
            const presentCount = cells.filter((c: any) => c.status === 'Present').length;
            const partialCount = cells.filter((c: any) => c.status === 'Partial').length;
            const absentCount = cells.filter((c: any) => c.status === 'Absent' || c.status === 'Unknown').length;
            const coverageRatio = features.length > 0 ? presentCount / features.length : 0;
            return {
              pn: pm.pn || pm.publicationNumber || pm.patent_number || pm.publication_number,
              present_count: presentCount,
              partial_count: partialCount,
              absent_count: absentCount,
              coverage_ratio: Math.round(coverageRatio * 100) / 100
            };
          });
        } catch {
          return [];
        }
      };

      const computePerFeatureUniqueness = (featureMaps: any[], features: string[]) => {
        try {
          return features.map((f: string) => {
            const total = featureMaps.length;
            const presentIn = featureMaps.filter(p => (p.feature_analysis || []).find((c: any) => c.feature === f)?.status === 'Present').length;
            const partialIn = featureMaps.filter(p => (p.feature_analysis || []).find((c: any) => c.feature === f)?.status === 'Partial').length;
            const absentIn = total - presentIn - partialIn;
            const uniqueness = total > 0 ? 1 - (presentIn / total) : 1;
            return {
              feature: f,
              present_in: presentIn,
              partial_in: partialIn,
              absent_in: absentIn,
              uniqueness: Math.round(uniqueness * 100) / 100
            };
          });
        } catch {
          return [];
        }
      };

      // Resolve Stage 4 data with fallbacks
      const resolvedStage4: any = { ...(stage4Raw || {}) };
      if (!Array.isArray(resolvedStage4.per_patent_coverage) || resolvedStage4.per_patent_coverage.length === 0) {
        resolvedStage4.per_patent_coverage = computePerPatentCoverage(fmArray, featuresS0);
      }
      if (!Array.isArray(resolvedStage4.per_feature_uniqueness) || resolvedStage4.per_feature_uniqueness.length === 0) {
        resolvedStage4.per_feature_uniqueness = computePerFeatureUniqueness(fmArray, featuresS0);
      }
      if (!Array.isArray(resolvedStage4.feature_uniqueness_table) && Array.isArray(resolvedStage4.per_feature_uniqueness)) {
        resolvedStage4.feature_uniqueness_table = resolvedStage4.per_feature_uniqueness.map((u: any) => ({
          feature: u.feature,
          uniqueness: (Math.round((u.uniqueness || 0) * 1000) / 10).toFixed(1) + '%',
          color: (u.uniqueness || 0) > 0.8 ? '#4CAF50' : (u.uniqueness || 0) > 0.6 ? '#FFC107' : '#E53935'
        }));
      }
      if (!resolvedStage4.executive_summary) {
        const noveltyScore = typeof resolvedStage4.novelty_score === 'number' ? (resolvedStage4.novelty_score * 100).toFixed(1) + '%' : '—';
        const cards = {
          'Novelty Score': noveltyScore,
          'Patents Analyzed': String(resolvedStage4.per_patent_coverage?.length || 0),
          'Unique Features': String(resolvedStage4.per_feature_uniqueness?.filter((u: any) => (u.uniqueness || 0) > 0.8).length || 0),
          'Confidence': resolvedStage4.confidence || '—'
        };
        resolvedStage4.executive_summary = {
          headline: 'Novelty Assessment',
          summary: 'Executive overview generated from deterministic Stage 3.5 analysis.',
          novelty_score: noveltyScore,
          confidence: resolvedStage4.confidence || '—',
          visual_cards: cards
        };
      }

      const stage4Results = resolvedStage4;
      console.log('Stage 4 Results for PDF (resolved):', JSON.stringify(stage4Results, null, 2));

      // (Executive Summary content removed)
      if (false && stage4Results?.executive_summary) {
        const execSummary = stage4Results.executive_summary;
        const headline = execSummary.headline || 'Novelty Assessment';
        const noveltyScore = execSummary.novelty_score || '0.0';
        const confidence = execSummary.confidence || 'Unknown';

        // Headline
        doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
        doc.rect(20, currentY, pageWidth - 40, 20, 'F');
        doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`🟢 ${headline.toUpperCase()}`, pageWidth / 2, currentY + 12, { align: 'center' });
        currentY += 30;

        // Dashboard Cards Row
        if (execSummary.visual_cards) {
          const cards = execSummary.visual_cards;
          const cardWidth = (pageWidth - 60) / 4;
          const cardData = [
            { label: 'Novelty Score', value: cards['Novelty Score'] || noveltyScore, color: colors.success },
            { label: 'Patents Analyzed', value: cards['Patents Analyzed'] || '0', color: colors.accent },
            { label: 'Unique Features', value: cards['Unique Features'] || '0', color: colors.primary },
            { label: 'Confidence', value: confidence, color: colors.warning }
          ];

          cardData.forEach((card, index) => {
            const x = 20 + (cardWidth * index);
            doc.setFillColor(card.color[0], card.color[1], card.color[2]);
            doc.rect(x, currentY, cardWidth - 5, 25, 'F');
            doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(card.label, x + 5, currentY + 8);
            doc.setFontSize(12);
            doc.text(card.value, x + 5, currentY + 18);
          });
          currentY += 35;
        }

        // Key Findings
        if (execSummary.key_findings && Array.isArray(execSummary.key_findings)) {
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('KEY FINDINGS:', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          execSummary.key_findings.slice(0, 3).forEach((finding: string, index: number) => {
            doc.text(`• ${finding}`, 25, currentY);
            currentY += 8;
          });
          currentY += 10;
        }
      }

      // Fallback: map Stage 4 V2 concluding_remarks to this section if legacy recommendations are missing (removed)
      if (false && (!stage4Results?.recommendations) && stage4Results?.concluding_remarks) {
        const concl = stage4Results.concluding_remarks as any;
        if (Array.isArray(concl.strategic_recommendations)) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('STRATEGIC RECOMMENDATIONS:', 20, currentY);
          currentY += 12;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          concl.strategic_recommendations.forEach((s: string) => {
            const line = doc.splitTextToSize(`- ${s}`, pageWidth - 40);
            doc.text(line, 20, currentY);
            currentY += line.length * 5 + 2;
          });
          currentY += 8;
        }
        if (concl.filing_advice) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('FILING ADVICE:', 20, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const adviceLines = doc.splitTextToSize(String(concl.filing_advice), pageWidth - 40);
          doc.text(adviceLines, 20, currentY);
          currentY += adviceLines.length * 5 + 8;
        }
      }

      doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');

      // Risk Factors (removed)
      if (false && stage4Results?.risk_factors && Array.isArray(stage4Results.risk_factors)) {
        doc.setFont('helvetica', 'bold');
        doc.text('RISK FACTORS IDENTIFIED:', 20, currentY);
        currentY += 10;

        doc.setFont('helvetica', 'normal');
        stage4Results.risk_factors.slice(0, 5).forEach((factor: string, index: number) => {
          doc.text(`• ${factor}`, 25, currentY);
          currentY += 8;
        });
        currentY += 10;
      }

      // Integration Check (removed)
      if (false && stage4Results?.integration_check) {
        doc.setFont('helvetica', 'bold');
        doc.text('INTEGRATION ANALYSIS:', 20, currentY);
        currentY += 10;

        doc.setFont('helvetica', 'normal');
        const integration = stage4Results.integration_check;
        if (integration.any_single_patent_covers_majority === false) {
          doc.text('✓ No single patent covers majority of features', 25, currentY);
          currentY += 8;
        }
        if (integration.explanation) {
          const explanationLines = doc.splitTextToSize(integration.explanation, pageWidth - 50);
          doc.text(explanationLines, 25, currentY);
          currentY += explanationLines.length * 5 + 5;
        }
        currentY += 10;
      }

      // Novelty Assessment Summary (removed)
      if (false) {
      doc.setFont('helvetica', 'bold');
      doc.text('NOVELTY ASSESSMENT SUMMARY:', 20, currentY);
      currentY += 10;

      doc.setFont('helvetica', 'normal');
      doc.text(`• Total patents analyzed: ${stage4Results?.per_patent_coverage?.length || 0}`, 25, currentY);
      currentY += 8;
      doc.text(`• Invention features assessed: ${stage4Results?.per_feature_uniqueness?.length || 0}`, 25, currentY);
      currentY += 8;
      doc.text(`• Assessment confidence: ${stage4Results?.confidence || 'Unknown'}`, 25, currentY);
      currentY += 15;
      }

      // Stage 0 — Idea & Key Features
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Stage 0 — Idea & Key Features', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('STAGE 0 — IDEA & KEY FEATURES', 20, 17);

      currentY = 40;
      if (stage0 && (stage0.searchQuery || (stage0.inventionFeatures && Array.isArray(stage0.inventionFeatures)))) {
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Search Query', 20, currentY);
        currentY += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const s0Lines = doc.splitTextToSize(String(stage0.searchQuery || ''), pageWidth - 40);
        doc.text(s0Lines, 20, currentY);
        currentY += s0Lines.length * 5 + 8;

        // Features list
        const features = Array.isArray(stage0.inventionFeatures) ? stage0.inventionFeatures : [];
        if (features.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('Key Features', 20, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          features.slice(0, 18).forEach((f: string, idx: number) => {
            const text = `${idx + 1}. ${f}`;
            const fLines = doc.splitTextToSize(text, pageWidth - 30);
            doc.text(fLines, 15, currentY);
            currentY += fLines.length * 5 + 4;
            if (currentY > pageHeight - 30) { doc.addPage(); currentY = 20; }
          });
        }
      }

      // Stage 1 — Prior Art Search Overview
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Stage 1 — Prior Art Search Overview', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('STAGE 1 — PRIOR ART SEARCH OVERVIEW', 20, 17);

      currentY = 40;
      const pqai = Array.isArray(stage1?.pqaiResults) ? stage1.pqaiResults : [];
      
      // Get patents that were shortlisted for detailed analysis (from Stage 3.5)
      const stage35Raw: any = (searchRun as any).stage35Results || [];
      const featureMaps: any[] = Array.isArray(stage35Raw?.feature_map)
        ? stage35Raw.feature_map
        : (Array.isArray(stage35Raw) ? stage35Raw : []);
      
      // Create a set of publication numbers from Stage 3.5 (shortlisted patents)
      const shortlistedPns = new Set<string>();
      featureMaps.forEach((pm: any) => {
        const pn = canonicalizePn(pm.pn || pm.publicationNumber || pm.publication_number);
        if (pn) shortlistedPns.add(pn);
      });
      
      // Filter pqai to show only shortlisted patents, or all if none shortlisted
      const patentsToShow = shortlistedPns.size > 0
        ? pqai.filter((r: any) => {
            const pn = canonicalizePn(r.publicationNumber || r.pn || r.publication_number);
            return pn && shortlistedPns.has(pn);
          })
        : pqai; // Show all if no shortlisted patents identified
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
      doc.setFontSize(10);
      doc.text(`Total patent database results: ${pqai.length}`, 20, currentY);
      currentY += 6;
      doc.text(`Patents shortlisted for detailed analysis: ${patentsToShow.length}`, 20, currentY);
      currentY += 10;

      if (patentsToShow.length > 0) {
        // Table header with better column widths
        doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
        doc.rect(20, currentY - 2, pageWidth - 40, 12, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFontSize(9);
        doc.text('PATENT NUMBER', 25, currentY + 3);
        doc.text('RELEVANCE', 100, currentY + 3);
        doc.text('TITLE', 140, currentY + 3);
        currentY += 15;

        // Sort and list ALL shortlisted patents (no limit)
        const sorted = [...patentsToShow].sort((a: any, b: any) => 
          ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0))
        );
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        
        sorted.forEach((r: any, idx: number) => {
          // Check if we need a new page (leave more space for wrapped text)
          if (currentY > pageHeight - 40) { 
            doc.addPage(); 
            currentY = 20;
            // Redraw header on new page
            doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
            doc.rect(20, currentY - 2, pageWidth - 40, 12, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
            doc.setFontSize(9);
            doc.text('PATENT NUMBER', 25, currentY + 3);
            doc.text('RELEVANCE', 100, currentY + 3);
            doc.text('TITLE', 140, currentY + 3);
            currentY += 15;
          }
          
          const pn = String(r.publicationNumber || r.pn || r.publication_number || '—');
          const title = String(r.title || '—');
          
          // Format relevance score as percentage (2 decimal places, max 100%)
          const relValue = parseFloat(String(r.relevanceScore || r.score || r.relevance || '0'));
          let relPercent = relValue;
          // If value is less than 1, assume it's a decimal (0.85 = 85%), otherwise assume it's already a percentage
          if (relPercent < 1 && relPercent > 0) {
            relPercent = relPercent * 100;
          }
          // Cap at 100%
          relPercent = Math.min(100, Math.max(0, relPercent));
          const rel = relPercent.toFixed(2) + '%';
          
          // Wrap text for both patent number and title
          const pnWidth = 70; // Max width for PN column
          const titleWidth = pageWidth - 160; // Available width for title column (from 140 to pageWidth - 20)
          const pnLines = doc.splitTextToSize(pn, pnWidth);
          const titleLines = doc.splitTextToSize(title, titleWidth);
          
          // Calculate row height based on maximum lines needed (line height ~5 for font size 8)
          const lineHeight = 5;
          const maxLines = Math.max(pnLines.length, titleLines.length, 1);
          const rowHeight = Math.max(10, maxLines * lineHeight + 4);
          
          // Row background (zebra)
          if (idx % 2 === 1) { 
            doc.setFillColor(248, 249, 250); 
            doc.rect(20, currentY - 2, pageWidth - 40, rowHeight, 'F'); 
          }
          
          // Row border
          doc.setDrawColor(220, 220, 220);
          doc.rect(20, currentY - 2, pageWidth - 40, rowHeight);
          doc.setDrawColor(0, 0, 0);
          
          // Text rendering - align to top of cell
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          
          // Patent number (wrapped, left-aligned)
          doc.text(pnLines, 25, currentY + 4);
          
          // Relevance score (single line, vertically centered if row is tall)
          const relY = currentY + 4 + (rowHeight > 10 ? (rowHeight - 10) / 2 : 0);
          doc.text(rel, 100, relY);
          
          // Title (wrapped, left-aligned)
          doc.text(titleLines, 140, currentY + 4);
          
          currentY += rowHeight + 2;
        });
      }

      // Stage 1 — Prior Art Details (two-column format matching sample image)
      if (patentsToShow.length > 0) {
        checkPageSpace(60);
        doc.addPage();
        tocEntries.push({ label: 'Stage 1 — Prior Art Details', page: doc.getNumberOfPages() });
        currentY = 20;

        doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('STAGE 1 — PRIOR ART DETAILS', 20, 17);
        currentY = 40;

        // Sort all shortlisted patents by relevance
        const detailed = [...patentsToShow]
          .sort((a: any, b: any) => ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0)));

        // Table configuration - two-column format optimized for landscape
        const marginX = 15;
        const marginRight = 15;
        const tableWidth = pageWidth - marginX - marginRight;
        const labelColWidth = 60; // Wider label column for better readability in landscape
        const valueColWidth = tableWidth - labelColWidth; // Remaining width for value column
        const fontSize = 9; // Slightly larger font for landscape
        const lineHeight = 4.5;
        const cellPadding = 4;
        const rowSpacing = 1; // Spacing between rows

        // Helper function to draw a two-column row
        const drawTwoColumnRow = (label: string, value: string, isLastRow: boolean = false): number => {
          // Wrap text for both columns
          const labelLines = doc.splitTextToSize(label, labelColWidth - cellPadding * 2);
          const valueLines = doc.splitTextToSize(value, valueColWidth - cellPadding * 2);
          
          // Calculate row height based on maximum lines
          const rowHeight = Math.max(
            labelLines.length * lineHeight + cellPadding * 2,
            valueLines.length * lineHeight + cellPadding * 2,
            8 // Minimum row height
          );

          // Draw cell borders
          doc.setDrawColor(200, 200, 200);
          // Left column (label)
          doc.rect(marginX, currentY, labelColWidth, rowHeight);
          // Right column (value)
          doc.rect(marginX + labelColWidth, currentY, valueColWidth, rowHeight);
          // Bottom border (if last row)
          if (isLastRow) {
            doc.setLineWidth(0.5);
            doc.line(marginX, currentY + rowHeight, marginX + tableWidth, currentY + rowHeight);
            doc.setLineWidth(0.1);
          }

          // Draw label (left column, left-aligned)
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(fontSize);
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          labelLines.forEach((line: string, lineIdx: number) => {
            doc.text(line, marginX + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
          });

          // Draw value (right column, left-aligned)
          valueLines.forEach((line: string, lineIdx: number) => {
            doc.text(line, marginX + labelColWidth + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
          });

          return rowHeight;
        };

        // Helper function to draw justified abstract text
        const drawJustifiedAbstract = (text: string, x: number, y: number, width: number): number => {
          const words = text.trim().split(/\s+/);
          if (words.length === 0) return lineHeight + cellPadding * 2;
          
          const lines: string[] = [];
          let currentLine: string[] = [];
          let currentLineWidth = 0;
          
          words.forEach((word: string) => {
            const spaceWidth = currentLine.length > 0 ? doc.getTextWidth(' ') : 0;
            const wordWidth = doc.getTextWidth(word);
            const testWidth = currentLineWidth + spaceWidth + wordWidth;
            
            if (testWidth <= width && currentLine.length > 0) {
              currentLine.push(word);
              currentLineWidth = testWidth;
            } else if (currentLine.length === 0) {
              currentLine.push(word);
              currentLineWidth = wordWidth;
            } else {
              // Justify the line
              if (currentLine.length > 1) {
                const lineText = currentLine.join(' ');
                const lineTextWidth = doc.getTextWidth(lineText);
                const totalSpaces = currentLine.length - 1;
                const extraSpace = (width - lineTextWidth) / totalSpaces;
                const spaceCharWidth = doc.getTextWidth(' ');
                const extraSpaces = Math.floor(extraSpace / spaceCharWidth);
                
                let justifiedLine = currentLine[0];
                for (let j = 1; j < currentLine.length; j++) {
                  justifiedLine += ' '.repeat(1 + extraSpaces) + currentLine[j];
                }
                lines.push(justifiedLine);
              } else {
                lines.push(currentLine[0]);
              }
              
              currentLine = [word];
              currentLineWidth = wordWidth;
            }
          });
          
          // Add last line (left-aligned, not justified)
          if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
          }
          
          // Draw lines
          lines.forEach((line: string, lineIdx: number) => {
            doc.text(line, x, y + cellPadding + (lineIdx + 1) * lineHeight);
          });
          
          return Math.max(8, lines.length * lineHeight + cellPadding * 2);
        };

        // Draw each patent in two-column format
        detailed.forEach((r: any, idx: number) => {
          // Check if we need a new page (leave space for header and at least 3 rows)
          if (currentY > pageHeight - 80) {
            doc.addPage();
            currentY = 20;
          }

          const pnFull = String(r.publicationNumber || r.pn || r.publication_number || r.id || 'Unknown');
          const title = String(r.title || 'Untitled Patent');
          const abstract = String(r.snippet || r.abstract || r.description || '').trim();
          const pubDate = String(r.publication_date || r.pub_date || r.date || '—');
          const appNo = String(r.application_number || r.applicationNumber || '—');
          const appDate = String(r.application_date || r.filing_date || r.filingDate || '—');
          const priorityNo = String(r.priority_number || r.priorityNumber || 'null');
          const priorityDate = String(r.priority_date || r.priorityDate || pubDate || '—');
          const inventors = Array.isArray(r.inventors) ? r.inventors.join(' | ') : 
                           (r.inventor ? String(r.inventor) : '—');
          const familyMembers = String(r.family_members || r.familyMembers || pnFull);
          
          // Format relevance score as percentage
          const relValue = parseFloat(String(r.relevanceScore || r.score || r.relevance || '0'));
          let relPercent = relValue;
          if (relPercent < 1 && relPercent > 0) {
            relPercent = relPercent * 100;
          }
          relPercent = Math.min(100, Math.max(0, relPercent));
          const relevance = relPercent.toFixed(2) + '%';

          // Draw red header for each patent reference
          const headerText = `Reference ${idx + 1}: ${pnFull}`;
          const headerHeight = 10;
          doc.setFillColor(colors.danger[0], colors.danger[1], colors.danger[2]); // Red header
          doc.rect(marginX, currentY, tableWidth, headerHeight, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text(headerText, marginX + cellPadding, currentY + 7);
          currentY += headerHeight + 2;

          // Draw table rows
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(fontSize);
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);

          // Helper function to draw a four-column row (label1, value1, label2, value2)
          const drawFourColumnRow = (label1: string, value1: string, label2: string, value2: string): number => {
            const colWidth = (tableWidth - 8) / 4; // Divide into 4 columns with spacing
            const labelWidth = colWidth * 0.4; // Label takes 40% of column
            const valueWidth = colWidth * 0.6; // Value takes 60% of column
            
            // Wrap text for all columns
            const label1Lines = doc.splitTextToSize(label1, labelWidth - cellPadding * 2);
            const value1Lines = doc.splitTextToSize(value1, valueWidth - cellPadding * 2);
            const label2Lines = doc.splitTextToSize(label2, labelWidth - cellPadding * 2);
            const value2Lines = doc.splitTextToSize(value2, valueWidth - cellPadding * 2);
            
            // Calculate row height based on maximum lines
            const maxLines = Math.max(
              label1Lines.length,
              value1Lines.length,
              label2Lines.length,
              value2Lines.length
            );
            const rowHeight = Math.max(
              maxLines * lineHeight + cellPadding * 2,
              8 // Minimum row height
            );

            // Draw cell borders
            doc.setDrawColor(200, 200, 200);
            // Column 1 (label1)
            doc.rect(marginX, currentY, colWidth, rowHeight);
            // Column 2 (value1)
            doc.rect(marginX + colWidth, currentY, colWidth, rowHeight);
            // Column 3 (label2)
            doc.rect(marginX + colWidth * 2, currentY, colWidth, rowHeight);
            // Column 4 (value2)
            doc.rect(marginX + colWidth * 3, currentY, colWidth, rowHeight);

            // Draw label1 (left column, left-aligned)
            doc.setFont('helvetica', 'bold');
            label1Lines.forEach((line: string, lineIdx: number) => {
              doc.text(line, marginX + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
            });

            // Draw value1
            doc.setFont('helvetica', 'normal');
            value1Lines.forEach((line: string, lineIdx: number) => {
              doc.text(line, marginX + colWidth + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
            });

            // Draw label2
            doc.setFont('helvetica', 'bold');
            label2Lines.forEach((line: string, lineIdx: number) => {
              doc.text(line, marginX + colWidth * 2 + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
            });

            // Draw value2
            doc.setFont('helvetica', 'normal');
            value2Lines.forEach((line: string, lineIdx: number) => {
              doc.text(line, marginX + colWidth * 3 + cellPadding, currentY + cellPadding + (lineIdx + 1) * lineHeight);
            });

            return rowHeight;
          };

          // Row 1: Publication No and Publication Date
          const row1Height = drawFourColumnRow('Publication No:', pnFull, 'Publication Date:', pubDate);
          currentY += row1Height + rowSpacing;
          
          // Row 2: Application No and Application Date
          const row2Height = drawFourColumnRow('Application No:', appNo, 'Application Date:', appDate);
          currentY += row2Height + rowSpacing;
          
          // Row 3: Priority No and Priority Date
          const row3Height = drawFourColumnRow('Priority No:', priorityNo, 'Priority Date:', priorityDate);
          currentY += row3Height + rowSpacing;
          
          // Inventor(s) - may wrap to multiple lines
          const row7Height = drawTwoColumnRow('Inventor(s):', inventors);
          currentY += row7Height + rowSpacing;
          
          // Family Member(s)
          const row8Height = drawTwoColumnRow('Family Member(s):', familyMembers);
          currentY += row8Height + rowSpacing;
          
          // Title - may wrap to multiple lines
          const row9Height = drawTwoColumnRow('Title:', title);
          currentY += row9Height + rowSpacing;
          
          // Abstract - justified text
          const abstractText = abstract || 'No abstract available.';
          const abstractWidth = valueColWidth - cellPadding * 2;
          const abstractX = marginX + labelColWidth + cellPadding;
          
          // Calculate abstract height
          const abstractWords = abstractText.trim().split(/\s+/);
          let abstractLineCount = 1;
          let currentAbstractWidth = 0;
          abstractWords.forEach((word: string) => {
            const wordWidth = doc.getTextWidth((currentAbstractWidth > 0 ? ' ' : '') + word);
            if (currentAbstractWidth + wordWidth > abstractWidth && currentAbstractWidth > 0) {
              abstractLineCount++;
              currentAbstractWidth = doc.getTextWidth(word);
            } else {
              currentAbstractWidth += wordWidth;
            }
          });
          
          const abstractRowHeight = Math.max(
            abstractLineCount * lineHeight + cellPadding * 2,
            8
          );
          
          // Draw abstract row
          doc.setDrawColor(200, 200, 200);
          doc.rect(marginX, currentY, labelColWidth, abstractRowHeight);
          doc.rect(marginX + labelColWidth, currentY, valueColWidth, abstractRowHeight);
          doc.setLineWidth(0.5);
          doc.line(marginX, currentY + abstractRowHeight, marginX + tableWidth, currentY + abstractRowHeight);
          doc.setLineWidth(0.1);
          
          // Draw label
          doc.text('Abstract:', marginX + cellPadding, currentY + cellPadding + lineHeight);
          
          // Draw justified abstract
          drawJustifiedAbstract(abstractText, abstractX, currentY, abstractWidth);
          
          currentY += abstractRowHeight + 8; // Extra spacing after each patent
        });
      }

      // Stage 3.5a — Patent-wise Feature Comparison Matrix (showing ALL patents and features)
      try {
        const stage35Raw: any = (searchRun as any).stage35Results || [];
        const featureMaps: any[] = Array.isArray(stage35Raw?.feature_map)
          ? stage35Raw.feature_map
          : (Array.isArray(stage35Raw) ? stage35Raw : []);

        const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];

        if (featureMaps.length > 0 && features.length > 0) {
          // New page for matrix
          checkPageSpace(60);
          doc.addPage();
          tocEntries.push({ label: 'Stage 3.5a — Feature Map Matrix', page: doc.getNumberOfPages() });
          currentY = 20;

          // Header bar
          doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
          doc.rect(0, 0, pageWidth, 25, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text('PATENT-WISE FEATURE COMPARISON MATRIX', 20, 17);
          currentY = 40;

          // Show ALL patents (up to 20) and ALL features (up to 8)
          const allPatents = featureMaps.slice(0, 20); // Limit to 20 as per requirement
          const allFeatures = features.slice(0, 8); // Limit to 8 as per requirement

          // Grid layout - optimized for landscape
          const marginX = 15;
          const marginRight = 15;
          const featureColWidth = 80; // Wider feature column for better readability in landscape
          const availableWidth = pageWidth - marginX - marginRight - featureColWidth;

          // Calculate how many patents can fit per page based on minimum column width
          // In landscape, we can fit more patents with slightly wider columns
          const minColWidth = 25; // Slightly wider minimum for better readability
          const maxPatentsPerPage = Math.floor(availableWidth / minColWidth);

          // For landscape, aim for 12-15 patents per page to utilize the wider space
          const targetPatentsPerPage = Math.min(15, Math.max(12, maxPatentsPerPage));
          const patentsPerPage = Math.min(targetPatentsPerPage, allPatents.length);
          const totalPages = Math.ceil(allPatents.length / patentsPerPage);
          
          const rowHeight = 7; // Compact row height
          const cellPadding = 2;

          // Helper to get status for a feature in a patent map
          const getStatus = (pm: any, feature: string): 'P' | 'Pt' | 'A' | '-' => {
            const fa = Array.isArray(pm?.feature_analysis) ? pm.feature_analysis : [];
            const cell = fa.find((c: any) => c.feature === feature);
            if (!cell) return '-';
            if (cell.status === 'Present') return 'P';
            if (cell.status === 'Partial') return 'Pt';
            if (cell.status === 'Absent') return 'A';
            return '-';
          };

          // Draw legend (only on first page)
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.text('Legend:', marginX, currentY);
          const legendY = currentY - 4;
          let lx = marginX + 20;
          const drawLegend = (label: string, fill: number[], text: string) => {
            doc.setFillColor(fill[0], fill[1], fill[2]);
            doc.rect(lx, legendY, 8, 5, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(6);
            doc.text(label, lx + 1, legendY + 3.5);
            doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
            doc.setFontSize(7);
            doc.text(text, lx + 10, legendY + 3.5);
            lx += 55;
          };
          drawLegend('P', colors.success, 'Present');
          drawLegend('Pt', colors.warning, 'Partial');
          drawLegend('A', colors.danger, 'Absent');
          currentY += 10;

          // Process patents in chunks (pages)
          for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
            if (pageIdx > 0) {
              // New page for next chunk of patents
              doc.addPage();
              currentY = 20;
            }

            const startIdx = pageIdx * patentsPerPage;
            const endIdx = Math.min(startIdx + patentsPerPage, allPatents.length);
            const patentsOnThisPage = allPatents.slice(startIdx, endIdx);
            const colWidth = Math.floor(availableWidth / patentsOnThisPage.length);

            // Function to draw column headers
            const drawHeader = () => {
              // Feature header cell
              doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
              doc.rect(marginX, currentY - 2, featureColWidth, rowHeight + 3, 'F');
              doc.setDrawColor(200, 200, 200);
              doc.rect(marginX, currentY - 2, featureColWidth, rowHeight + 3);
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(7);
              doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
              doc.text('FEATURE', marginX + 2, currentY + 3);

              // Patent columns
              for (let c = 0; c < patentsOnThisPage.length; c++) {
                const pm = patentsOnThisPage[c];
                const pnRaw = String(pm.pn || pm.publicationNumber || pm.publication_number || 'PN');
                const x = marginX + featureColWidth + c * colWidth;
                doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
                doc.rect(x, currentY - 2, colWidth, rowHeight + 3, 'F');
                doc.setDrawColor(200, 200, 200);
                doc.rect(x, currentY - 2, colWidth, rowHeight + 3);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(5.5); // Smaller font for patent numbers
                doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
                
                // Try to fit full patent number, wrap if needed, or truncate intelligently
                const maxWidth = colWidth - 4;
                const pnWidth = doc.getTextWidth(pnRaw);
                if (pnWidth <= maxWidth) {
                  // Full patent number fits
                  doc.text(pnRaw, x + colWidth / 2, currentY + 3, { align: 'center' });
                } else {
                  // Try wrapping first
                  const pnLines = doc.splitTextToSize(pnRaw, maxWidth);
                  if (pnLines.length === 1) {
                    // Single line but still too long - truncate with ellipsis
                    let truncated = pnRaw;
                    while (doc.getTextWidth(truncated + '..') > maxWidth && truncated.length > 0) {
                      truncated = truncated.substring(0, truncated.length - 1);
                    }
                    doc.text(truncated + '..', x + colWidth / 2, currentY + 3, { align: 'center' });
                  } else {
                    // Multi-line - show first line only
                    doc.text(pnLines[0], x + colWidth / 2, currentY + 2, { align: 'center' });
                  }
                }
              }
              currentY += rowHeight + 4;
            };

            // Draw header
            drawHeader();

            // Draw rows for ALL features
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6);
            for (let r = 0; r < allFeatures.length; r++) {
              // Check if we need a new page (but keep same patent columns)
              if (currentY > pageHeight - 25) {
                doc.addPage();
                currentY = 20;
                drawHeader();
              }

              const featureName = allFeatures[r];
              
              // Feature name cell - allow wrapping for long names
              const featureLines = doc.splitTextToSize(featureName, featureColWidth - 4);
              const featureRowHeight = Math.max(rowHeight + 2, featureLines.length * 4 + 2);
              
              // Feature name cell background (zebra)
              if (r % 2 === 0) {
                doc.setFillColor(248, 249, 250);
                doc.rect(marginX, currentY - 1, featureColWidth, featureRowHeight, 'F');
              }
              doc.setDrawColor(200, 200, 200);
              doc.rect(marginX, currentY - 1, featureColWidth, featureRowHeight);
              
              // Draw feature name (wrapped if needed)
              doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
              featureLines.forEach((line: string, lineIdx: number) => {
                doc.text(line, marginX + 2, currentY + 2 + (lineIdx * 4));
              });

              // Cells per patent
              for (let c = 0; c < patentsOnThisPage.length; c++) {
                const pm = patentsOnThisPage[c];
                const status = getStatus(pm, featureName);
                const x = marginX + featureColWidth + c * colWidth;
                
                // Determine fill color
                let fill = colors.lightGray as number[];
                if (status === 'P') fill = colors.success;
                else if (status === 'Pt') fill = colors.warning;
                else if (status === 'A') fill = colors.danger;
                
                doc.setFillColor(fill[0], fill[1], fill[2]);
                doc.rect(x, currentY - 1, colWidth, featureRowHeight, 'F');
                doc.setDrawColor(200, 200, 200);
                doc.rect(x, currentY - 1, colWidth, featureRowHeight);
                
                // Cell label (centered)
                const tx = x + Math.floor(colWidth / 2);
                const ty = currentY + Math.floor(featureRowHeight / 2) + 1;
                
                // Choose contrasting color
                const useWhite = (status === 'A' || status === 'P');
                doc.setTextColor(useWhite ? 255 : 0, useWhite ? 255 : 0, useWhite ? 255 : 0);
                doc.setFontSize(7);
                doc.text(status, tx, ty, { align: 'center' });
              }
              currentY += featureRowHeight + 1;
            }

            // Footer showing page info
            if (totalPages > 1) {
              doc.setFontSize(6);
              doc.setTextColor(120, 120, 120);
              doc.text(
                `Page ${pageIdx + 1} of ${totalPages} - Showing patents ${startIdx + 1}-${endIdx} of ${allPatents.length}`,
                marginX,
                currentY + 4
              );
            }
          }
        }
      } catch (e) {
        console.error('Error rendering feature comparison matrix:', e);
        // Non-fatal: if 3.5a results missing, skip matrix
      }

      // Feature Uniqueness Table Section (Stage 3.5 summary)
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Stage 3.5 — Feature Uniqueness Analysis', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('FEATURE UNIQUENESS ANALYSIS', 20, 17);

      currentY = 40;

      // Feature Uniqueness Table
      if (stage4Results?.feature_uniqueness_table && Array.isArray(stage4Results.feature_uniqueness_table)) {
        doc.setFontSize(10);
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);

        // Table header
        doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
        doc.rect(15, currentY - 2, pageWidth - 30, 14, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('FEATURE', 20, currentY + 5);
        doc.text('UNIQUENESS %', 140, currentY + 5);
        doc.text('NOVELTY CLASS', 200, currentY + 5);
        currentY += 18;

        // Feature rows
        doc.setFont('helvetica', 'normal');
        stage4Results.feature_uniqueness_table.forEach((feature: any, index: number) => {
          if (currentY > pageHeight - 40) {
            doc.addPage();
            currentY = 20;
          }

          // Alternate row colors
          if (index % 2 === 0) {
            doc.setFillColor(248, 249, 250);
            doc.rect(20, currentY - 2, pageWidth - 40, 10, 'F');
          }

          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);

          // Feature name
          const featureName = feature.feature.length > 18 ?
            feature.feature.substring(0, 15) + '...' : feature.feature;
          doc.text(featureName, 25, currentY + 4);

          // Uniqueness percentage with color bar
          const uniquenessValue = parseFloat(feature.uniqueness.replace('%', ''));
          const uniquenessColor = uniquenessValue > 80 ? colors.success :
                                 uniquenessValue > 60 ? colors.warning : colors.danger;

          // Draw color indicator
          doc.setFillColor(uniquenessColor[0], uniquenessColor[1], uniquenessColor[2]);
          doc.rect(118, currentY, 15, 6, 'F');

          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.text(feature.uniqueness, 140, currentY + 4);

          // Novelty class
          const noveltyClass = uniquenessValue > 80 ? 'High Novelty' :
                             uniquenessValue > 60 ? 'Moderate' : 'Common';
          doc.text(noveltyClass, 160, currentY + 4);

          currentY += 12;
        });
        currentY += 15;
      }

      // Stage 3.5 — Patent Details (tabular per-patent cells)
      try {
        const stage35Raw: any = (searchRun as any).stage35Results || [];
        const stage35List: any[] = Array.isArray(stage35Raw?.feature_map)
          ? stage35Raw.feature_map
          : (Array.isArray(stage35Raw) ? stage35Raw : []);

        if (stage35List.length > 0) {
          checkPageSpace(60);
          doc.addPage();
          tocEntries.push({ label: 'Stage 3.5 - Patent Details', page: doc.getNumberOfPages() });
          currentY = 20;

          doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
          doc.rect(0, 0, pageWidth, 25, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text('STAGE 3.5 — PATENT DETAILS', 20, 17);
          currentY = 40;

          // Build quick index for Stage 1 PQAI results by canonical PN to fetch meta/abstract
          const pqaiArr: any[] = Array.isArray((stage1 as any)?.pqaiResults) ? (stage1 as any).pqaiResults : [];
          const pqaiIndex: Record<string, any> = {};
          for (const r of pqaiArr) {
            const cpn = canonicalizePn(r.publicationNumber || r.publication_number || r.id);
            if (cpn) pqaiIndex[cpn] = r;
          }

          // Render each Stage 3.5 patent as a small table: meta row (PN + date), title full row, abstract full row
          for (const pm of stage35List) {
            if (currentY > pageHeight - 60) { doc.addPage(); currentY = 20; }

            const pn = String(pm.pn || pm.publicationNumber || pm.publication_number || pm.id || '-');
            const cpn = canonicalizePn(pn);
            const s1 = pqaiIndex[cpn] || {};
            const title = String(pm.title || s1.title || 'Untitled Patent');
            const pubDate = String(s1.publication_date || s1.pub_date || s1.date || '-');
            const abstract = String(s1.snippet || s1.abstract || s1.description || '').trim();

            // Row 1: Dynamic cells (PN, Publication Date)
            let rowX = 20;
            const maxCellWidth = Math.floor((pageWidth - 48) / 2);
            const metaCells: Array<{ label: string; value: string }> = [
              { label: 'Patent Number', value: pn },
              { label: 'Publication Date', value: pubDate }
            ];
            for (const cell of metaCells) {
              if (rowX > pageWidth - 40) { rowX = 20; currentY += 6; }
              const cellBox = drawLabeledCell(cell.label, cell.value, rowX, currentY, maxCellWidth);
              rowX += cellBox.width + 8;
            }
            currentY += 26; // spacing after meta row

            // Row 2: Title (full-width cell)
            const titleBox = drawLabeledCell('Title', title, 20, currentY, pageWidth - 40);
            currentY += titleBox.height + 6;

            // Row 3: Abstract (full-width cell)
            const abstractText = abstract || 'No abstract available.';
            const abstractBox = drawLabeledCell('Abstract', abstractText, 20, currentY, pageWidth - 40);
            currentY += abstractBox.height + 12;
          }
        }
      } catch (e) {
        // Non-fatal: skip Stage 3.5 patent details if data is unavailable
      }

      // Stage 3.5c — Patent-by-Patent Remarks (from Stage 4 snapshot)
      try {
        const stage4: any = (searchRun as any).stage4Results || {};
        const remarks: any[] = Array.isArray(stage4?.per_patent_remarks) ? stage4.per_patent_remarks : [];
        if (remarks.length > 0) {
          checkPageSpace(60);
          doc.addPage();
          tocEntries.push({ label: 'Stage 3.5c - Patent Remarks', page: doc.getNumberOfPages() });
          currentY = 20;

          doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
          doc.rect(0, 0, pageWidth, 25, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text('STAGE 3.5c — PATENT-BY-PATENT REMARKS', 20, 17);
          currentY = 40;

          for (let i = 0; i < remarks.length; i++) {
            const it = remarks[i] || {};
            const pn = String(it.pn || '-');
            const title = String(it.title || '');
            const rem = String(it.remarks || '');

            if (currentY > pageHeight - 60) { doc.addPage(); currentY = 20; }
            const cell1 = drawLabeledCell('Patent Number', pn, 20, currentY, pageWidth - 40);
            currentY += cell1.height + 4;
            if (title) {
              const cell2 = drawLabeledCell('Title', title, 20, currentY, pageWidth - 40);
              currentY += cell2.height + 4;
            }
            if (rem) {
              const cell3 = drawLabeledCell('Remarks', rem, 20, currentY, pageWidth - 40);
              currentY += cell3.height + 8;
            } else {
              currentY += 6;
            }
          }
        }
      } catch (e) {
        // Non-fatal: skip remarks section if not available
      }

      // Structured Narrative Section
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Analytical Narrative', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.warning[0], colors.warning[1], colors.warning[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('ANALYTICAL NARRATIVE', 20, 17);

      currentY = 40;

      // Structured Narrative
      if (stage4Results?.structured_narrative) {
        const narrative = stage4Results.structured_narrative;

        // Integration Analysis
        if (narrative.integration) {
          doc.setFontSize(12);
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'bold');
          doc.text('🧩 Integration Analysis', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const integrationLines = doc.splitTextToSize(narrative.integration, pageWidth - 40);
          doc.text(integrationLines, 25, currentY);
          currentY += integrationLines.length * 5 + 8;
        }

        // Feature Insights
        if (narrative.feature_insights) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('🔍 Feature Insights', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const insightsLines = doc.splitTextToSize(narrative.feature_insights, pageWidth - 40);
          doc.text(insightsLines, 25, currentY);
          currentY += insightsLines.length * 5 + 8;
        }

        // Verdict Explanation
        if (narrative.verdict) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('⚖️ Verdict Explanation', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const verdictLines = doc.splitTextToSize(narrative.verdict, pageWidth - 40);
          doc.text(verdictLines, 25, currentY);
          currentY += verdictLines.length * 5 + 8;
        }
      }

      // Patent-by-Patent Coverage Analysis
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Patent-by-Patent Analysis', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('PATENT-BY-PATENT ANALYSIS', 20, 17);

      currentY = 40;

      // Table for patent coverage analysis
      if (stage4Results?.per_patent_coverage && Array.isArray(stage4Results.per_patent_coverage)) {
        doc.setFontSize(8);
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);

        // Table header
        doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
        doc.rect(15, currentY - 2, pageWidth - 30, 14, 'F');
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('PATENT ID', 20, currentY + 5);
        doc.text('COVERAGE', 85, currentY + 5);
        doc.text('PRESENT', 130, currentY + 5);
        doc.text('PARTIAL', 170, currentY + 5);
        doc.text('ABSENT', 210, currentY + 5);
        doc.text('RATIO', 240, currentY + 5);
        currentY += 18;

        // Sort by coverage ratio (most relevant first) and show top 15
        const sortedPatents = stage4Results.per_patent_coverage
          .sort((a: any, b: any) => b.coverage_ratio - a.coverage_ratio)
          .slice(0, 15);

        doc.setFont('helvetica', 'normal');
        sortedPatents.forEach((patent: any, index: number) => {
          if (currentY > pageHeight - 40) {
            doc.addPage();
            currentY = 20;
          }

          // Alternate row colors
          if (index % 2 === 0) { doc.setFillColor(248, 249, 250); doc.rect(20, currentY - 2, pageWidth - 40, 10, 'F'); }
          // Row border
          doc.setDrawColor(220, 220, 220);
          doc.rect(20, currentY - 2, pageWidth - 40, 10);
          doc.setDrawColor(0, 0, 0);

          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);

          // Patent number (truncated)
          const patentId = patent.pn.length > 12 ? patent.pn.substring(0, 9) + '...' : patent.pn;
          doc.text(patentId, 25, currentY + 4);

          // Coverage ratio with color
          const ratioPercent = (patent.coverage_ratio * 100).toFixed(1);
          const ratioColor = patent.coverage_ratio > 0.3 ? colors.danger :
                            patent.coverage_ratio > 0.1 ? colors.warning : colors.success;
          doc.setTextColor(ratioColor[0], ratioColor[1], ratioColor[2]);
          doc.text(`${ratioPercent}%`, 70, currentY + 4);

          // Statistics
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.text(`${patent.present_count}`, 115, currentY + 4);
          doc.text(`${patent.partial_count}`, 145, currentY + 4);
          doc.text(`${patent.absent_count}`, 175, currentY + 4);

          // Raw ratio
          doc.setTextColor(colors.gray[0], colors.gray[1], colors.gray[2]);
          doc.setFontSize(7);
          doc.text(`${patent.coverage_ratio.toFixed(2)}`, 200, currentY + 4);
          doc.setFontSize(8);

          currentY += 12;
        });
        currentY += 10;
      }

      // Recommendations Section
      checkPageSpace(50);
      doc.addPage();
      tocEntries.push({ label: 'Strategic Recommendations', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('STRATEGIC RECOMMENDATIONS', 20, 17);

      currentY = 40;

      // Recommendations from the report
      if (stage4Results?.recommendations) {
        const recommendations = stage4Results.recommendations;

        // Filing Strategy
        if (recommendations.filing_strategy && Array.isArray(recommendations.filing_strategy)) {
          doc.setFontSize(12);
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'bold');
          doc.text('📋 Filing Strategy:', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          recommendations.filing_strategy.forEach((strategy: string, index: number) => {
            doc.text(`• ${strategy}`, 25, currentY);
            currentY += 8;
          });
          currentY += 8;
        }

        // Search Expansion
        if (recommendations.search_expansion && Array.isArray(recommendations.search_expansion)) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('🔍 Search Expansion:', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          recommendations.search_expansion.forEach((expansion: string) => {
            doc.text(`• ${expansion}`, 25, currentY);
            currentY += 8;
          });
          currentY += 8;
        }

        // Action Summary
        if (recommendations.action_summary) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('⚡ Action Summary:', 20, currentY);
          currentY += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const actionLines = doc.splitTextToSize(recommendations.action_summary, pageWidth - 45);
          doc.text(actionLines, 25, currentY);
          currentY += actionLines.length * 5 + 8;
        }
      }

      // Final Remarks Section
      checkPageSpace(30);
      doc.addPage();
      tocEntries.push({ label: 'Final Verdict & Remarks', page: doc.getNumberOfPages() });
      currentY = 20;

      doc.setFillColor(colors.success[0], colors.success[1], colors.success[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('FINAL VERDICT & REMARKS', 20, 17);

      currentY = 40;

      // Final Remarks
      if (stage4Results?.final_remarks) {
        const remarks = stage4Results.final_remarks;

        // Headline
        if (remarks.headline) {
          doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
          doc.rect(20, currentY, pageWidth - 40, 15, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text(remarks.headline, pageWidth / 2, currentY + 10, { align: 'center' });
          currentY += 25;
        }

        // Explanation
        if (remarks.explanation) {
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          const explanationLines = doc.splitTextToSize(remarks.explanation, pageWidth - 40);
          doc.text(explanationLines, 20, currentY);
          currentY += explanationLines.length * 5 + 10;
        }

        // Advisory
        if (remarks.advisory) {
          doc.setFillColor(colors.warning[0], colors.warning[1], colors.warning[2]);
          doc.rect(20, currentY, pageWidth - 40, 20, 'F');
          doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text('IMPORTANT ADVISORY', pageWidth / 2, currentY + 8, { align: 'center' });
          currentY += 22;

          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          const advisoryLines = doc.splitTextToSize(remarks.advisory, pageWidth - 40);
          doc.text(advisoryLines, 20, currentY);
          currentY += advisoryLines.length * 4 + 10;
        }
      }

      // Fallback mapping from concluding_remarks (Stage 4 V2)
      if (!stage4Results?.final_remarks && stage4Results?.concluding_remarks) {
        const remarks = stage4Results.concluding_remarks as any;

        // Headline (overall assessment)
        const headline = remarks.overall_novelty_assessment || stage4Results.decision || 'Novelty Assessment';
        doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
        doc.rect(20, currentY, pageWidth - 40, 15, 'F');
        doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(String(headline).toUpperCase(), pageWidth / 2, currentY + 10, { align: 'center' });
        currentY += 25;

        // Why novelty exists
        if (remarks.why_novelty_exists || stage4Results?.executive_summary?.summary) {
          doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const explanationLines = doc.splitTextToSize(String(remarks.why_novelty_exists || stage4Results.executive_summary.summary), pageWidth - 40);
          doc.text(explanationLines, 20, currentY);
          currentY += explanationLines.length * 5 + 10;
        }

        // Key strengths / risks
        if (Array.isArray(remarks.key_strengths) || Array.isArray(remarks.key_risks)) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('KEY STRENGTHS:', 20, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          (remarks.key_strengths || []).forEach((s: string) => { const l = doc.splitTextToSize(`- ${s}`, pageWidth - 40); doc.text(l, 20, currentY); currentY += l.length * 5 + 2; });
          currentY += 6;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('KEY RISKS:', 20, currentY);
          currentY += 10;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          (remarks.key_risks || []).forEach((s: string) => { const l = doc.splitTextToSize(`- ${s}`, pageWidth - 40); doc.text(l, 20, currentY); currentY += l.length * 5 + 2; });
          currentY += 6;
        }

        // Advisory
        doc.setFillColor(colors.warning[0], colors.warning[1], colors.warning[2]);
        doc.rect(20, currentY, pageWidth - 40, 20, 'F');
        doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('IMPORTANT ADVISORY', pageWidth / 2, currentY + 8, { align: 'center' });
        currentY += 22;
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const advisoryLines = doc.splitTextToSize('This report is AI-assisted; verify cited prior art and consult a registered patent attorney for legal conclusions.', pageWidth - 40);
        doc.text(advisoryLines, 20, currentY);
        currentY += advisoryLines.length * 4 + 10;
      }

      // Populate the Table of Contents
      doc.setPage(tocPage);
      currentY = 40;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
      tocEntries.forEach((entry, idx) => {
        const y = currentY + idx * 10;
        if (y > pageHeight - 30) {
          doc.addPage();
          currentY = 20;
        }
        const label = `${(idx + 1).toString().padStart(2, '0')}  ${entry.label}`;
        // Clickable label linking to page
        doc.textWithLink(label, 25, y, { pageNumber: entry.page });
        // Page number on the right
        doc.text(String(entry.page), pageWidth - 25, y, { align: 'right' as any });
      });

      // Generate and save PDF
      const filename = `novelty_search_${searchId}_${Date.now()}.pdf`;
      const filepath = path.join(process.cwd(), 'public', 'reports', filename);

      // Ensure directory exists
      const reportsDir = path.dirname(filepath);
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      // Save the PDF
      const pdfBuffer = doc.output('arraybuffer');
      fs.writeFileSync(filepath, new Uint8Array(pdfBuffer));

      return `/reports/${filename}`;

    } catch (error) {
      console.error('Comprehensive novelty report generation error:', error);
      throw new Error('Failed to generate comprehensive novelty report');
    }
  }

  /**
   * Generate PDF report for individual patent novelty assessment
   */
  static async generateNoveltyReport(assessmentId: string, companyName?: string, companyLogo?: string): Promise<string> {
    try {
      // Fetch assessment data with relations
      const assessment = await prisma.noveltyAssessmentRun.findUnique({
        where: { id: assessmentId },
        include: {
          patent: { select: { title: true } },
          user: { select: { name: true, email: true } },
          llmCalls: {
            orderBy: { calledAt: 'asc' },
          },
        },
      });

      if (!assessment) {
        throw new Error('Assessment not found');
      }

      // Create PDF document
      const doc = new jsPDF();
      const filename = `novelty_assessment_${assessmentId}_${Date.now()}.pdf`;
      const filepath = path.join(process.cwd(), 'uploads', 'reports', filename);

      // Ensure directory exists
      const reportsDir = path.dirname(filepath);
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      // Simple assessment report
      doc.text('Novelty Assessment Report', 20, 20);
      doc.text(`Patent: ${assessment.patent.title}`, 20, 40);
      doc.text(`Status: ${assessment.status}`, 20, 60);
      doc.text(`Generated: ${new Date().toISOString()}`, 20, 80);

      // Save the PDF
      const pdfBuffer = doc.output('arraybuffer');
      fs.writeFileSync(filepath, new Uint8Array(pdfBuffer));

      return `/uploads/reports/${filename}`;

    } catch (error) {
      console.error('Novelty assessment report generation error:', error);
      throw new Error('Failed to generate novelty assessment report');
    }
  }
}
