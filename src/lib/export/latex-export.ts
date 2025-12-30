import type { CitationData } from '@/lib/services/citation-style-service';
import { exportCitationsToBibtex } from '@/lib/export/bibtex-export';

export interface LatexSection {
  key: string;
  title: string;
  content: string;
}

export interface LatexFigure {
  figureNo: number;
  caption: string;
}

export interface LatexFormatting {
  marginInches?: number;
  lineSpacing?: number;
  fontSizePt?: number;
}

export interface LatexExportInput {
  title: string;
  sections: LatexSection[];
  figures?: LatexFigure[];
  citations?: CitationData[];
  bibliographyStyle?: string;
  formatting?: LatexFormatting;
}

export interface LatexExportResult {
  latex: string;
  bibtex: string;
}

export function buildLatexExport(input: LatexExportInput): LatexExportResult {
  const lines: string[] = [];
  const margin = input.formatting?.marginInches ?? 1.0;
  const lineSpacing = input.formatting?.lineSpacing ?? 1.5;
  const fontSize = input.formatting?.fontSizePt ?? 12;
  const bibliographyStyle = input.bibliographyStyle || 'plain';
  const bibtex = exportCitationsToBibtex(input.citations || []);

  lines.push(`\\documentclass[${fontSize}pt]{article}`);
  lines.push(`\\usepackage[margin=${margin}in]{geometry}`);
  lines.push(`\\usepackage{setspace}`);
  lines.push(`\\usepackage{graphicx}`);
  lines.push(`\\usepackage{hyperref}`);
  lines.push(`\\usepackage{cite}`);
  lines.push(`\\setstretch{${lineSpacing}}`);
  lines.push('');
  lines.push(`\\title{${escapeLatex(input.title || 'Untitled Paper')}}`);
  lines.push(`\\date{}`);
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');
  lines.push('');

  for (const section of input.sections) {
    const content = normalizeLatexContent(section.content);
    if (section.key.toLowerCase() === 'abstract') {
      lines.push('\\begin{abstract}');
      lines.push(content);
      lines.push('\\end{abstract}');
      lines.push('');
      continue;
    }

    lines.push(`\\section{${escapeLatex(section.title)}}`);
    lines.push(content);
    lines.push('');
  }

  if (input.figures && input.figures.length > 0) {
    lines.push('\\section{Figures}');
    for (const figure of input.figures) {
      lines.push('\\begin{figure}[h]');
      lines.push('\\centering');
      lines.push(`\\caption{${escapeLatex(figure.caption)}}`);
      lines.push('\\end{figure}');
      lines.push('');
    }
  }

  if ((input.citations || []).length > 0) {
    lines.push('\\bibliographystyle{' + bibliographyStyle + '}');
    lines.push('\\bibliography{references}');
  }

  lines.push('\\end{document}');

  return {
    latex: lines.join('\n'),
    bibtex
  };
}

function normalizeLatexContent(content: string): string {
  const citations: Array<{ token: string; key: string }> = [];
  let counter = 0;
  const withPlaceholders = content.replace(/\[CITE:([^\]]+)\]/g, (_, key) => {
    const token = `CITETOKEN${counter++}`;
    citations.push({ token, key });
    return token;
  }).replace(/\r\n/g, '\n');

  let escaped = withPlaceholders
    .split('\n')
    .map(line => escapeLatex(line))
    .join('\n');

  citations.forEach(({ token, key }) => {
    escaped = escaped.replaceAll(token, `\\cite{${key}}`);
  });

  return escaped;
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}
