export interface PaperDocxSection {
  key: string;
  title: string;
  content: string;
}

export interface PaperDocxFigure {
  figureNo: number;
  title?: string;
  description?: string | null;
}

export interface PaperDocxFormatting {
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: number;
  marginsCm: { top: number; bottom: number; left: number; right: number };
  pageSize?: 'A4' | 'LETTER';
}

export interface PaperDocxExportInput {
  title: string;
  sections: PaperDocxSection[];
  bibliography?: string;
  figures?: PaperDocxFigure[];
  formatting: PaperDocxFormatting;
}

export async function buildPaperDocxBuffer(input: PaperDocxExportInput): Promise<Buffer> {
  const docx = loadDocx();
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    AlignmentType,
    SectionType
  } = docx as any;

  const fontFamily = input.formatting.fontFamily;
  const fontSizePt = input.formatting.fontSizePt;
  const fontSizeHalfPt = fontSizePt * 2;
  const lineSpacingTwips = Math.round(240 * input.formatting.lineSpacing);
  const margins = input.formatting.marginsCm;
  const pageSize = resolvePageSize(input.formatting.pageSize);

  const doc = new Document({
    sections: [],
    styles: {
      default: {
        document: {
          run: {
            size: fontSizeHalfPt,
            font: fontFamily
          }
        }
      },
      paragraphStyles: [
        {
          id: 'bodyStyle',
          name: 'Body',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            size: fontSizeHalfPt,
            color: '000000',
            font: fontFamily
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: {
              line: lineSpacingTwips,
              before: 0,
              after: 120
            }
          }
        },
        {
          id: 'headingStyle',
          name: 'Heading',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            size: fontSizeHalfPt + 4,
            color: '000000',
            bold: true,
            font: fontFamily
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: 240,
              after: 120
            }
          }
        }
      ]
    }
  });

  const children: any[] = [];
  const titleText = input.title || 'Untitled Paper';
  children.push(
    new Paragraph({
      text: titleText,
      heading: HeadingLevel.HEADING_1,
      style: 'headingStyle'
    })
  );

  input.sections.forEach(section => {
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    splitIntoParagraphs(section.content).forEach(text => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text, font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
    });
  });

  if (input.figures && input.figures.length > 0) {
    children.push(
      new Paragraph({
        text: 'Figures',
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    input.figures.forEach(figure => {
      const captionParts = [`Figure ${figure.figureNo}.`];
      if (figure.title) captionParts.push(figure.title);
      if (figure.description) captionParts.push(figure.description);
      children.push(
        new Paragraph({
          children: [new TextRun({ text: captionParts.join(' '), font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
    });
  }

  if (input.bibliography && input.bibliography.trim().length > 0) {
    children.push(
      new Paragraph({
        text: 'References',
        heading: HeadingLevel.HEADING_2,
        style: 'headingStyle'
      })
    );

    splitBibliography(input.bibliography).forEach(entry => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: entry, font: fontFamily, size: fontSizeHalfPt })],
          style: 'bodyStyle'
        })
      );
    });
  }

  const pageMargin = {
    top: cmToTwips(margins.top),
    bottom: cmToTwips(margins.bottom),
    left: cmToTwips(margins.left),
    right: cmToTwips(margins.right)
  };

  doc.addSection({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        margin: pageMargin,
        size: {
          width: Math.round(pageSize.width * 20),
          height: Math.round(pageSize.height * 20)
        }
      }
    },
    children
  });

  return Packer.toBuffer(doc);
}

function loadDocx(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = eval('require') as (m: string) => any;
    return req('docx');
  } catch (error) {
    throw new Error('DOCX_NOT_AVAILABLE');
  }
}

function cmToTwips(cm: number): number {
  return Math.round(cm * 1440 / 2.54);
}

function resolvePageSize(size?: 'A4' | 'LETTER'): { width: number; height: number } {
  if (size === 'LETTER') {
    return { width: 612, height: 792 };
  }
  return { width: 595.28, height: 841.89 };
}

function splitIntoParagraphs(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];
  return normalized.split(/\n{2,}/).map(block => block.replace(/\n+/g, ' ').trim()).filter(Boolean);
}

function splitBibliography(bibliography: string): string[] {
  return bibliography
    .split(/\n{2,}/)
    .map(entry => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
