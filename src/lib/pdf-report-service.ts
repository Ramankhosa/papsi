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

      const doc = new jsPDF();
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
        doc.rect(20, currentY, pageWidth - 40, 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.text(title, 25, currentY + 7);
        doc.setTextColor(0, 0, 0);
        currentY += 15;
      };

      // Helper function to check page space and add new page if needed
      const checkPageSpace = (neededSpace: number) => {
        if (currentY + neededSpace > pageHeight - 30) {
          doc.addPage();
          currentY = 20;
        }
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
      doc.text('Powered by AI Patent Assistant', pageWidth / 2, pageHeight - 20, { align: 'center' });

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

      // Executive Summary Page
      doc.addPage();
      tocEntries.push({ label: 'Executive Summary', page: doc.getNumberOfPages() });
      currentY = 20;

      // Header
      doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(colors.white[0], colors.white[1], colors.white[2]);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('EXECUTIVE SUMMARY', 20, 17);

      currentY = 40;

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

      // Modern Dashboard Cards - Executive Summary
      if (stage4Results?.executive_summary) {
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
          execSummary.key_findings.slice(0, 3).forEach((finding, index) => {
            doc.text(`• ${finding}`, 25, currentY);
            currentY += 8;
          });
          currentY += 10;
        }
      }

      // Fallback: map Stage 4 V2 concluding_remarks to this section if legacy recommendations are missing
      if ((!stage4Results?.recommendations) && stage4Results?.concluding_remarks) {
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

      // Risk Factors
      if (stage4Results?.risk_factors && Array.isArray(stage4Results.risk_factors)) {
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

      // Integration Check
      if (stage4Results?.integration_check) {
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

      // Novelty Assessment Summary
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
            const fLines = doc.splitTextToSize(text, pageWidth - 40);
            doc.text(fLines, 20, currentY);
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
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
      doc.setFontSize(10);
      doc.text(`Total PQAI results: ${pqai.length}`, 20, currentY);
      currentY += 10;

      if (pqai.length > 0) {
        // Compact table header
        doc.setFillColor(colors.lightGray[0], colors.lightGray[1], colors.lightGray[2]);
        doc.rect(20, currentY - 2, pageWidth - 40, 12, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.text('PN', 25, currentY + 3);
        doc.text('RELEVANCE', 80, currentY + 3);
        doc.text('TITLE', 120, currentY + 3);
        currentY += 15;

        // Sort and list top 10
        const sorted = [...pqai].sort((a: any, b: any) => ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0))).slice(0, 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        sorted.forEach((r: any, idx: number) => {
          if (currentY > pageHeight - 30) { doc.addPage(); currentY = 20; }
          const pn = String(r.publicationNumber || r.pn || r.publication_number || '').slice(0, 16);
          const rel = String(r.relevanceScore || r.score || r.relevance || '0');
          const title = String(r.title || '').slice(0, 48);
          // row background (zebra)
          if (idx % 2 === 1) { doc.setFillColor(248,249,250); doc.rect(20, currentY - 2, pageWidth - 40, 10, 'F'); }
          // row border
          doc.setDrawColor(220, 220, 220);
          doc.rect(20, currentY - 2, pageWidth - 40, 10);
          doc.setDrawColor(0,0,0);
          // text
          doc.text(pn || '—', 25, currentY + 3);
          doc.text(rel, 80, currentY + 3);
          doc.text(title || '—', 120, currentY + 3);
          currentY += 10;
        });
      }

      // Stage 1 — Prior Art Details (title + abstract)
      if (pqai.length > 0) {
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

        const detailed = [...pqai]
          .sort((a: any, b: any) => ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0)))
          .slice(0, 10);

        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);

        detailed.forEach((r: any, idx: number) => {
          if (currentY > pageHeight - 50) { doc.addPage(); currentY = 20; }
          const pnFull = String(r.publicationNumber || r.pn || r.publication_number || r.id || 'Unknown');
          const title = String(r.title || 'Untitled Patent');
          const abstract = String(r.snippet || r.abstract || r.description || '').trim();
          const url = `https://patents.google.com/patent/${pnFull}`;

          doc.setFont('helvetica', 'bold');
          doc.textWithLink(`${pnFull} — ${title}`, 20, currentY, { url });
          currentY += 7;
          doc.setFont('helvetica', 'normal');
          // Metadata line (if available)
          const metaParts: string[] = [];
          if (r.publication_date) metaParts.push(`Pub Date: ${r.publication_date}`);
          if (r.filing_date) metaParts.push(`Filing: ${r.filing_date}`);
          if (Array.isArray(r.applicants) && r.applicants.length) metaParts.push(`Applicants: ${r.applicants.slice(0,2).join('; ')}`);
          if (Array.isArray(r.inventors) && r.inventors.length) metaParts.push(`Inventors: ${r.inventors.slice(0,3).join('; ')}`);
          if (Array.isArray(r.cpc) && r.cpc.length) metaParts.push(`CPC: ${r.cpc.slice(0,3).join(', ')}`);
          if (metaParts.length) {
            const metaLine = doc.splitTextToSize(metaParts.join('  |  '), pageWidth - 40);
            doc.setTextColor(80,80,80);
            doc.setFontSize(9);
            doc.text(metaLine, 20, currentY);
            currentY += metaLine.length * 4 + 2;
            doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
            doc.setFontSize(10);
          }
          const absLines = doc.splitTextToSize(abstract || 'No abstract available.', pageWidth - 40);
          doc.text(absLines.slice(0, 8), 20, currentY);
          currentY += Math.min(absLines.length, 8) * 5 + 6;
        });
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
        doc.rect(20, currentY - 2, pageWidth - 40, 12, 'F');
        doc.setFont('helvetica', 'bold');
        doc.text('FEATURE', 25, currentY + 3);
        doc.text('UNIQUENESS %', 120, currentY + 3);
        doc.text('NOVELTY CLASS', 160, currentY + 3);
        currentY += 15;

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
        doc.rect(20, currentY - 2, pageWidth - 40, 12, 'F');
        doc.setTextColor(colors.dark[0], colors.dark[1], colors.dark[2]);
        doc.setFont('helvetica', 'bold');
        doc.text('PATENT ID', 25, currentY + 3);
        doc.text('COVERAGE', 70, currentY + 3);
        doc.text('PRESENT', 110, currentY + 3);
        doc.text('PARTIAL', 140, currentY + 3);
        doc.text('ABSENT', 170, currentY + 3);
        doc.text('RATIO', 195, currentY + 3);
        currentY += 15;

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
          recommendations.filing_strategy.forEach((strategy, index) => {
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
          recommendations.search_expansion.forEach((expansion) => {
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
