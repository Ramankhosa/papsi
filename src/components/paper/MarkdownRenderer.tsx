'use client';

import { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Lightweight Markdown Renderer for Paper Sections
 * 
 * Supports:
 * - ### Subsection headings
 * - - Bullet points (unordered lists)
 * - 1. Numbered lists (ordered lists)
 * - **bold** and *italic* text
 * - Paragraphs with proper spacing
 */
export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const rendered = useMemo(() => {
    if (!content) return null;

    // Split content into blocks (separated by double newlines or before headings)
    const blocks = content.split(/\n\n+/);
    const elements: React.ReactNode[] = [];

    blocks.forEach((block, blockIndex) => {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) return;

      // Check if block is a heading (### or ##)
      // Elsevier-style: bold headings, slightly larger, numbered look
      if (trimmedBlock.startsWith('### ')) {
        const headingText = trimmedBlock.slice(4).trim();
        elements.push(
          <h4 
            key={blockIndex} 
            className="text-gray-900 mt-6 mb-2 first:mt-0"
            style={{ 
              fontSize: '12pt', 
              fontWeight: 600,
              fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif'
            }}
          >
            {formatInlineText(headingText)}
          </h4>
        );
        return;
      }

      if (trimmedBlock.startsWith('## ')) {
        const headingText = trimmedBlock.slice(3).trim();
        elements.push(
          <h3 
            key={blockIndex} 
            className="text-gray-900 mt-8 mb-3 first:mt-0"
            style={{ 
              fontSize: '13pt', 
              fontWeight: 700,
              fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif'
            }}
          >
            {formatInlineText(headingText)}
          </h3>
        );
        return;
      }

      // Check if block is a list
      const lines = trimmedBlock.split('\n');
      const firstLine = lines[0].trim();

      // Unordered list (starts with - or *)
      if (/^[-*]\s/.test(firstLine)) {
        const listItems: string[] = [];
        lines.forEach(line => {
          const match = line.match(/^[-*]\s+(.+)/);
          if (match) {
            listItems.push(match[1]);
          } else if (line.trim() && listItems.length > 0) {
            // Continuation of previous item
            listItems[listItems.length - 1] += ' ' + line.trim();
          }
        });

        elements.push(
          <ul 
            key={blockIndex} 
            className="list-disc list-outside ml-6 my-3 space-y-1"
            style={{ fontSize: '11pt' }}
          >
            {listItems.map((item, i) => (
              <li key={i} className="text-gray-800 pl-1">
                {formatInlineText(item)}
              </li>
            ))}
          </ul>
        );
        return;
      }

      // Ordered list (starts with number.)
      if (/^\d+\.\s/.test(firstLine)) {
        const listItems: string[] = [];
        lines.forEach(line => {
          const match = line.match(/^\d+\.\s+(.+)/);
          if (match) {
            listItems.push(match[1]);
          } else if (line.trim() && listItems.length > 0) {
            // Continuation of previous item
            listItems[listItems.length - 1] += ' ' + line.trim();
          }
        });

        elements.push(
          <ol 
            key={blockIndex} 
            className="list-decimal list-outside ml-6 my-3 space-y-1"
            style={{ fontSize: '11pt' }}
          >
            {listItems.map((item, i) => (
              <li key={i} className="text-gray-800 pl-1">
                {formatInlineText(item)}
              </li>
            ))}
          </ol>
        );
        return;
      }

      // Regular paragraph - Elsevier style: justified, proper spacing
      elements.push(
        <p 
          key={blockIndex} 
          className="text-gray-800 my-3 text-justify first:mt-0"
          style={{ 
            textIndent: blockIndex > 0 ? '1.5em' : '0', // First-line indent except first paragraph
            marginBottom: '0.8em'
          }}
        >
          {formatInlineText(trimmedBlock.replace(/\n/g, ' '))}
        </p>
      );
    });

    return elements;
  }, [content]);

  return (
    <div 
      className={`prose prose-slate max-w-none ${className}`}
      style={{ 
        fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Times, Georgia, serif',
        fontSize: '11pt',
        lineHeight: '1.6'
      }}
    >
      {rendered}
    </div>
  );
}

/**
 * Format inline text (bold, italic, citations)
 */
function formatInlineText(text: string): React.ReactNode {
  if (!text) return text;

  // Pattern to match bold, italic, and citations
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // Combined regex for **bold**, *italic*, and [CITE:key]
  const inlinePattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\[CITE:([^\]]+)\])|(\[Figure\s+(\d+)\])/g;
  let match;

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold **text**
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-900">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Italic *text*
      parts.push(
        <em key={match.index} className="italic">
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      // Citation [CITE:key]
      parts.push(
        <span key={match.index} className="text-blue-600 bg-blue-50 px-1 rounded text-sm font-mono">
          [{match[6]}]
        </span>
      );
    } else if (match[7]) {
      // Figure reference [Figure N]
      parts.push(
        <span key={match.index} className="text-purple-600 bg-purple-50 px-1 rounded text-sm font-medium">
          [Figure {match[8]}]
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

