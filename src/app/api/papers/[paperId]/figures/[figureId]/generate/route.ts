import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { 
  generateChart, 
  generateFromMermaidCode,
  generateFromPlantUMLCode,
  FigureGenerationResult
} from '@/lib/figure-generation';
import {
  generateChartConfig,
  generateDiagramCode
} from '@/lib/figure-generation/llm-figure-service';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';

const generateSchema = z.object({
  figureType: z.string(),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATION', 'CUSTOM']),
  title: z.string(),
  caption: z.string().optional().nullable(),
  // User's natural language description for LLM generation
  description: z.string().optional().nullable(),
  data: z.object({
    labels: z.array(z.string()).optional(),
    datasets: z.array(z.object({
      label: z.string(),
      data: z.array(z.number())
    })).optional()
  }).optional().nullable(), // Allow null for diagrams that don't need data
  code: z.string().optional().nullable(),
  theme: z.string().optional().nullable(),
  // Whether to use LLM for code generation
  useLLM: z.boolean().optional().default(true)
});

// Use absolute path for reliable file operations
const FIGURE_UPLOAD_DIR = path.join(process.cwd(), 'public/uploads/figures');

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where
  });
}

export async function POST(
  request: NextRequest, 
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId, figureId } = await context.params;
    
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Get the figure plan
    const figurePlan = await prisma.figurePlan.findFirst({
      where: { id: figureId, sessionId }
    });
    
    if (!figurePlan) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = generateSchema.parse(body);

    // Get request headers for LLM calls
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    let result: FigureGenerationResult;
    let llmMetadata: { tokensUsed?: number; model?: string } = {};

    // Generate based on category
    switch (data.category) {
      case 'DATA_CHART':
        // Check if we should use LLM to generate chart config
        if (data.useLLM && data.description && !data.data?.datasets) {
          console.log('[PaperFigures] Using LLM to generate chart config...');
          
          // Use LLM to generate chart configuration from description
          const llmResult = await generateChartConfig(
            {
              description: data.description,
              chartType: data.figureType as any,
              title: data.title,
              data: data.data?.labels && data.code ? {
                labels: data.data.labels,
                values: data.code.split(',').map(v => parseFloat(v.trim())).filter(n => !isNaN(n)),
                datasetLabel: data.title
              } : undefined,
              style: (data.theme as any) || 'academic'
            },
            requestHeaders
          );

          if (llmResult.success && llmResult.config) {
            llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
            
            // Use the LLM-generated config to create the chart
            result = await generateChart(
              llmResult.config.type as any,
              llmResult.config.data,
              {
                title: data.title,
                theme: { preset: (data.theme || 'academic') as any },
                format: 'png'
              }
            );
          } else {
            result = {
              success: false,
              error: llmResult.error || 'Failed to generate chart configuration',
              errorCode: 'LLM_ERROR'
            };
          }
        } else if (data.data?.labels && data.data?.datasets) {
          // Direct data provided - use it directly
          result = await generateChart(
            data.figureType as any,
            data.data,
            {
              title: data.title,
              theme: { preset: (data.theme || 'academic') as any },
              format: 'png'
            }
          );
        } else {
          // No LLM and no data - use sample
          const sampleData = {
            labels: ['A', 'B', 'C', 'D', 'E'],
            datasets: [{
              label: data.title,
              data: [25, 40, 30, 45, 35]
            }]
          };
          result = await generateChart(
            data.figureType as any,
            sampleData,
            {
              title: data.title,
              theme: { preset: (data.theme || 'academic') as any },
              format: 'png'
            }
          );
        }
        break;

      case 'DIAGRAM':
        // Check if we should use LLM to generate diagram code
        if (data.useLLM && data.description && !data.code) {
          console.log('[PaperFigures] Using LLM to generate diagram code...');
          
          // Use LLM to generate Mermaid code from description (Mermaid is more reliable)
          const llmResult = await generateDiagramCode(
            {
              description: data.description,
              diagramType: data.figureType as any,
              title: data.title
            },
            requestHeaders,
            false // Prefer Mermaid over PlantUML for better reliability
          );

          if (llmResult.success && llmResult.code) {
            llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
            
            console.log('[PaperFigures] LLM generated code:', llmResult.code.slice(0, 200));
            
            // Always try Mermaid first (more reliable), fall back to PlantUML if explicitly generated
            const isPlantUML = llmResult.code.includes('@startuml') || llmResult.diagramType === 'plantuml';
            
            if (isPlantUML) {
              // Try PlantUML
              result = await generateFromPlantUMLCode(llmResult.code, { format: 'png' });
              
              // If PlantUML fails, try converting to Mermaid sample
              if (!result.success) {
                console.log('[PaperFigures] PlantUML failed, using Mermaid sample fallback');
                const sampleCode = getSampleDiagramCode(data.figureType, data.title);
                result = await generateFromMermaidCode(sampleCode, {
                  theme: { preset: (data.theme || 'academic') as any },
                  format: 'png'
                });
              }
            } else {
              // Mermaid code
              result = await generateFromMermaidCode(llmResult.code, {
                theme: { preset: (data.theme || 'academic') as any },
                format: 'png'
              });
              
              // If Mermaid fails, try with sample code
              if (!result.success) {
                console.log('[PaperFigures] Mermaid failed, using sample fallback');
                const sampleCode = getSampleDiagramCode(data.figureType, data.title);
                result = await generateFromMermaidCode(sampleCode, {
                  theme: { preset: (data.theme || 'academic') as any },
                  format: 'png'
                });
              }
            }
            
            // Add the generated code to result
            if (result.success) {
              result.generatedCode = llmResult.code;
            }
          } else {
            // LLM failed - use sample diagram
            console.log('[PaperFigures] LLM failed, using sample diagram');
            const sampleCode = getSampleDiagramCode(data.figureType, data.title);
            result = await generateFromMermaidCode(sampleCode, {
              theme: { preset: (data.theme || 'academic') as any },
              format: 'png'
            });
          }
        } else if (data.code) {
          // Direct code provided - use it
          if (data.code.includes('@startuml') || data.figureType === 'plantuml') {
            result = await generateFromPlantUMLCode(data.code, { format: 'png' });
          } else {
            result = await generateFromMermaidCode(data.code, {
              theme: { preset: (data.theme || 'academic') as any },
              format: 'png'
            });
          }
          
          // If direct code fails, try sample
          if (!result.success) {
            console.log('[PaperFigures] Direct code failed, using sample fallback');
            const sampleCode = getSampleDiagramCode(data.figureType, data.title);
            result = await generateFromMermaidCode(sampleCode, {
              theme: { preset: (data.theme || 'academic') as any },
              format: 'png'
            });
          }
        } else {
          // No LLM and no code - generate sample
          const sampleCode = getSampleDiagramCode(data.figureType, data.title);
          result = await generateFromMermaidCode(sampleCode, {
            theme: { preset: (data.theme || 'academic') as any },
            format: 'png'
          });
        }
        break;

      case 'STATISTICAL_PLOT':
        // Statistical plots can also use LLM for configuration
        if (data.useLLM && data.description) {
          const llmResult = await generateChartConfig(
            {
              description: data.description + ' (statistical visualization)',
              chartType: data.figureType as any || 'bar',
              title: data.title,
              style: (data.theme as any) || 'academic'
            },
            requestHeaders
          );

          if (llmResult.success && llmResult.config) {
            llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
            result = await generateChart(
              llmResult.config.type as any,
              llmResult.config.data,
              {
                title: data.title,
                theme: { preset: (data.theme || 'academic') as any },
                format: 'png'
              }
            );
          } else {
            result = {
              success: false,
              error: llmResult.error || 'Failed to generate statistical plot',
              errorCode: 'LLM_ERROR'
            };
          }
        } else if (data.data) {
          result = await generateChart(
            'bar',
            data.data,
            {
              title: data.title,
              theme: { preset: (data.theme || 'academic') as any }
            }
          );
        } else {
          result = {
            success: false,
            error: 'Statistical plots require data or a description',
            errorCode: 'INVALID_DATA'
          };
        }
        break;

      case 'ILLUSTRATION':
      case 'CUSTOM':
      default:
        result = {
          success: false,
          error: `${data.category} figures require manual upload`,
          errorCode: 'UNSUPPORTED_TYPE'
        };
    }

    // If generation failed, return error
    if (!result.success || !result.imageBase64) {
      return NextResponse.json(
        { error: result.error || 'Figure generation failed' },
        { status: 400 }
      );
    }

    // Save the generated image
    await fs.mkdir(FIGURE_UPLOAD_DIR, { recursive: true });
    
    const format = result.format || 'png';
    const timestamp = Date.now();
    const filename = `figure_${figureId}_${timestamp}.${format}`;
    const filePath = path.join(FIGURE_UPLOAD_DIR, filename);
    
    const buffer = Buffer.from(result.imageBase64, 'base64');
    await fs.writeFile(filePath, buffer);
    
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const imagePath = `/uploads/figures/${filename}`;

    // Update the figure plan with the generated image
    // NOTE: imagePath is stored in nodes JSON since the schema doesn't have a dedicated field
    const meta = (figurePlan.nodes as any) || {};
    await prisma.figurePlan.update({
      where: { id: figureId },
      data: {
        nodes: {
          ...meta,
          status: 'GENERATED',
          imagePath, // Store in nodes JSON
          source: result.provider || 'quickchart',
          generatedAt: new Date().toISOString(),
          checksum,
          generatedCode: result.generatedCode,
          fileSize: buffer.length
        }
      }
    });

    console.log(`[PaperFigures] Generated figure: ${filename} (${buffer.length} bytes)`);

    return NextResponse.json({
      success: true,
      imagePath,
      generatedCode: result.generatedCode,
      format,
      fileSize: buffer.length
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Generate error:', error);
    return NextResponse.json(
      { error: 'Failed to generate figure' },
      { status: 500 }
    );
  }
}

/**
 * Generates sample Mermaid code based on diagram type.
 */
function getSampleDiagramCode(figureType: string, title: string): string {
  switch (figureType) {
    case 'flowchart':
    case 'architecture':
      return `flowchart TD
    A[Start] --> B{${title}}
    B -->|Option 1| C[Process A]
    B -->|Option 2| D[Process B]
    C --> E[End]
    D --> E`;

    case 'sequence':
      return `sequenceDiagram
    participant User
    participant System
    participant Database
    User->>System: Request
    System->>Database: Query
    Database-->>System: Response
    System-->>User: Result`;

    case 'class':
      return `classDiagram
    class MainClass {
        +String attribute
        +method()
    }
    class RelatedClass {
        +data
        +process()
    }
    MainClass --> RelatedClass`;

    case 'er':
      return `erDiagram
    ENTITY1 ||--o{ ENTITY2 : has
    ENTITY1 {
        string id PK
        string name
    }
    ENTITY2 {
        string id PK
        string attribute
    }`;

    case 'gantt':
      return `gantt
    title ${title}
    dateFormat YYYY-MM-DD
    section Phase 1
        Task 1 :a1, 2024-01-01, 30d
        Task 2 :a2, after a1, 20d
    section Phase 2
        Task 3 :a3, after a2, 25d`;

    case 'state':
      return `stateDiagram-v2
    [*] --> Initial
    Initial --> Processing : start
    Processing --> Complete : success
    Processing --> Error : failure
    Complete --> [*]
    Error --> Initial : retry`;

    default:
      return `flowchart TD
    A[${title}] --> B[Step 1]
    B --> C[Step 2]
    C --> D[Result]`;
  }
}

