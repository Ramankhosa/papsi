'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useCallback } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Underline from '@tiptap/extension-underline';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  Bold,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  Undo2
} from 'lucide-react';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';

// ============================================================================
// Public Ref API
// ============================================================================

export interface PaperMarkdownEditorRef {
  focus: () => void;
  insertTextAtCursor: (text: string) => void;
  replaceSelection: (text: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  getSelectedText: () => string;
  getMarkdown: () => string;
  /** Store the current selection so it survives blur events */
  saveSelection: () => { from: number; to: number } | null;
  /** Restore a previously saved selection */
  restoreSelection: (range: { from: number; to: number }) => void;
}

// ============================================================================
// Props
// ============================================================================

interface PaperMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (selection: { text: string; start: number; end: number } | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// ============================================================================
// Markdown ↔ HTML Conversion Helpers
// ============================================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdownToHtml(text: string): string {
  let html = escapeHtml(text);
  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (but not inside bold markers)
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Superscript ^text^
  html = html.replace(/\^([^^]+)\^/g, '<sup>$1</sup>');
  // Subscript ~text~ (single tilde, not double)
  html = html.replace(/(?<![~])~([^~]+)~(?!~)/g, '<sub>$1</sub>');
  return html;
}

function inlineHtmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(inlineHtmlToMarkdown).join('');

  if (tag === 'strong' || tag === 'b') return `**${children}**`;
  if (tag === 'em' || tag === 'i') return `*${children}*`;
  if (tag === 'u') return children; // Underline doesn't have markdown equivalent
  if (tag === 'sup') return `^${children}^`;
  if (tag === 'sub') return `~${children}~`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${children}~~`;
  if (tag === 'br') return '\n';

  return children;
}

/**
 * Convert markdown to HTML for TipTap consumption.
 * Handles: headings (##-####), bullet/ordered lists (nested), blockquotes, paragraphs
 */
function markdownToHtml(markdown: string): string {
  const normalized = polishDraftMarkdown(markdown || '');
  if (!normalized) return '<p></p>';

  const lines = normalized.split('\n');
  const html: string[] = [];
  // Stack tracks open list tags to allow proper nesting
  const listStack: Array<'ul' | 'ol'> = [];
  let inParagraph = false;
  let inBlockquote = false;

  const closeParagraph = () => {
    if (inParagraph) {
      html.push('</p>');
      inParagraph = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push('</blockquote>');
      inBlockquote = false;
    }
  };

  const closeListsToLevel = (targetLevel: number) => {
    while (listStack.length > targetLevel) {
      html.push(`</${listStack.pop()!}>`);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) {
      closeParagraph();
      closeBlockquote();
      closeListsToLevel(0);
      continue;
    }

    // Headings: ## through ####
    const headingMatch = line.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      closeParagraph();
      closeBlockquote();
      closeListsToLevel(0);
      const level = Math.min(4, Math.max(2, headingMatch[1].length));
      html.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    // Blockquote: > text
    const blockquoteMatch = line.match(/^>\s*(.*)$/);
    if (blockquoteMatch) {
      closeParagraph();
      closeListsToLevel(0);
      if (!inBlockquote) {
        html.push('<blockquote>');
        inBlockquote = true;
      }
      const quoteContent = blockquoteMatch[1].trim();
      if (quoteContent) {
        html.push(`<p>${inlineMarkdownToHtml(quoteContent)}</p>`);
      }
      continue;
    }

    // List items: - bullet or 1. ordered (with nesting via indent)
    const listMatch = line.match(/^(\s*)(-|\d+\.)\s+(.+)$/);
    if (listMatch) {
      closeParagraph();
      closeBlockquote();
      const indentSpaces = (listMatch[1] || '').length;
      const level = Math.max(0, Math.floor(indentSpaces / 2));
      const listType: 'ul' | 'ol' = listMatch[2] === '-' ? 'ul' : 'ol';

      // Close lists deeper than current level
      closeListsToLevel(level);

      // Open new list if needed at this level
      if (listStack.length <= level) {
        html.push(`<${listType}>`);
        listStack.push(listType);
      } else if (listStack[level] !== listType) {
        // Different list type at same level - close and reopen
        closeListsToLevel(level);
        html.push(`<${listType}>`);
        listStack.push(listType);
      }

      html.push(`<li>${inlineMarkdownToHtml(listMatch[3].trim())}</li>`);
      continue;
    }

    // Plain text → paragraph
    closeListsToLevel(0);
    closeBlockquote();
    if (!inParagraph) {
      html.push('<p>');
      inParagraph = true;
    } else {
      html.push('<br/>');
    }
    html.push(inlineMarkdownToHtml(line));
  }

  closeParagraph();
  closeBlockquote();
  closeListsToLevel(0);
  return html.join('');
}

/**
 * Serialize a list element (ul/ol) back to markdown
 */
function serializeList(el: HTMLElement, level: number): string {
  const isOrdered = el.tagName.toLowerCase() === 'ol';
  const lines: string[] = [];
  let counter = 1;

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== 'li') continue;

    const nestedLists = Array.from(child.children).filter(
      c => c instanceof HTMLElement && (c.tagName.toLowerCase() === 'ul' || c.tagName.toLowerCase() === 'ol')
    ) as HTMLElement[];

    const inlineParts: string[] = [];
    for (const node of Array.from(child.childNodes)) {
      if (node instanceof HTMLElement && (node.tagName.toLowerCase() === 'ul' || node.tagName.toLowerCase() === 'ol')) {
        continue;
      }
      inlineParts.push(inlineHtmlToMarkdown(node));
    }

    const inlineText = inlineParts.join('').replace(/\s+/g, ' ').trim();
    if (inlineText) {
      const marker = isOrdered ? `${counter}.` : '-';
      lines.push(`${'  '.repeat(level)}${marker} ${inlineText}`);
      counter++;
    }

    for (const nested of nestedLists) {
      const nestedText = serializeList(nested, level + 1);
      if (nestedText.trim()) {
        lines.push(nestedText);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert TipTap HTML back to clean markdown
 */
function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const blocks: string[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) blocks.push(text);
      continue;
    }

    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const rawLevel = Number(tag.slice(1));
      // Clamp to ##..#### range for academic papers
      const level = rawLevel <= 2 ? 2 : rawLevel <= 4 ? rawLevel : 4;
      const text = Array.from(node.childNodes).map(inlineHtmlToMarkdown).join('').trim();
      blocks.push(`${'#'.repeat(level)} ${text}`);
      continue;
    }

    if (tag === 'p') {
      const inline = Array.from(node.childNodes).map(inlineHtmlToMarkdown).join('').replace(/\s+\n/g, '\n').trim();
      if (inline) blocks.push(inline);
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const list = serializeList(node, 0).trim();
      if (list) blocks.push(list);
      continue;
    }

    if (tag === 'blockquote') {
      // Recursively extract paragraphs inside blockquote
      const quoteLines: string[] = [];
      for (const child of Array.from(node.childNodes)) {
        if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'p') {
          const text = Array.from(child.childNodes).map(inlineHtmlToMarkdown).join('').trim();
          if (text) quoteLines.push(`> ${text}`);
        } else {
          const text = (child.textContent || '').trim();
          if (text) quoteLines.push(`> ${text}`);
        }
      }
      if (quoteLines.length > 0) blocks.push(quoteLines.join('\n'));
      continue;
    }

    const fallback = node.textContent?.trim();
    if (fallback) blocks.push(fallback);
  }

  // Join blocks with double newline, then normalize via polishDraftMarkdown
  // but only for structural normalization, not heading promotion
  return polishDraftMarkdown(blocks.join('\n\n'));
}

// ============================================================================
// Toolbar Button
// ============================================================================

function MicroButton({
  onClick,
  active,
  disabled,
  title,
  children
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent focus theft so editor selection is preserved
        e.preventDefault();
      }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? 'bg-indigo-100 text-indigo-700'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

/** Thin divider between toolbar button groups */
function ToolbarSep() {
  return <div className="w-px h-4 bg-slate-200 mx-0.5" />;
}

// ============================================================================
// Custom CSS for academic paper styling inside TipTap
// ============================================================================

const EDITOR_STYLES = `
.paper-editor .ProseMirror {
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", serif;
  font-size: 11pt;
  line-height: 1.8;
  color: #1a1a2e;
  padding: 1.5rem;
  min-height: 180px;
  outline: none;
}

.paper-editor .ProseMirror p {
  margin-bottom: 0.6em;
  text-align: justify;
  text-indent: 0;
}

.paper-editor .ProseMirror p + p {
  text-indent: 1.5em;
}

.paper-editor .ProseMirror h2 {
  font-size: 13pt;
  font-weight: 700;
  margin-top: 1.8em;
  margin-bottom: 0.5em;
  color: #111827;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
  text-transform: none;
}

.paper-editor .ProseMirror h2:first-child {
  margin-top: 0;
}

.paper-editor .ProseMirror h3 {
  font-size: 12pt;
  font-weight: 600;
  margin-top: 1.4em;
  margin-bottom: 0.4em;
  color: #1f2937;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
  font-style: italic;
}

.paper-editor .ProseMirror h4 {
  font-size: 11pt;
  font-weight: 600;
  margin-top: 1.2em;
  margin-bottom: 0.3em;
  color: #374151;
  font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
}

.paper-editor .ProseMirror ul {
  list-style-type: disc;
  padding-left: 1.8em;
  margin: 0.5em 0;
}

.paper-editor .ProseMirror ol {
  list-style-type: decimal;
  padding-left: 1.8em;
  margin: 0.5em 0;
}

.paper-editor .ProseMirror li {
  margin-bottom: 0.2em;
}

.paper-editor .ProseMirror li p {
  text-indent: 0;
  margin-bottom: 0.15em;
}

.paper-editor .ProseMirror blockquote {
  border-left: 3px solid #6366f1;
  padding-left: 1em;
  margin: 1em 0;
  color: #4b5563;
  font-style: italic;
}

.paper-editor .ProseMirror blockquote p {
  text-indent: 0;
}

.paper-editor .ProseMirror strong {
  font-weight: 700;
  color: #111827;
}

.paper-editor .ProseMirror em {
  font-style: italic;
}

.paper-editor .ProseMirror sup {
  font-size: 0.75em;
  vertical-align: super;
}

.paper-editor .ProseMirror sub {
  font-size: 0.75em;
  vertical-align: sub;
}
`;

// ============================================================================
// Main Component
// ============================================================================

const PaperMarkdownEditor = forwardRef<PaperMarkdownEditorRef, PaperMarkdownEditorProps>(function PaperMarkdownEditor(
  {
    value,
    onChange,
    onFocus,
    onBlur,
    onSelectionChange,
    placeholder = 'Write section content...',
    disabled = false,
    className = ''
  },
  ref
) {
  const [hasFocus, setHasFocus] = useState(false);
  const lastMarkdownRef = useRef(polishDraftMarkdown(value || ''));
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialHtml = useMemo(() => markdownToHtml(value || ''), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        blockquote: {},
        strike: {}
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Superscript,
      Subscript,
      Underline
    ],
    content: initialHtml,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none'
      }
    },
    onFocus: () => {
      setHasFocus(true);
      onFocus?.();
    },
    onBlur: () => {
      // Save selection on blur so external tools can restore it
      if (editor) {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          savedSelectionRef.current = { from, to };
        }
      }
      setHasFocus(false);
      onBlur?.();
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from === to) {
        onSelectionChange?.(null);
        return;
      }
      const text = ed.state.doc.textBetween(from, to, ' ').trim();
      onSelectionChange?.(text ? { text, start: from, end: to } : null);
    },
    onUpdate: ({ editor: ed }) => {
      const markdown = htmlToMarkdown(ed.getHTML());
      lastMarkdownRef.current = markdown;
      onChange(markdown);
    }
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync external value changes into the editor
  useEffect(() => {
    if (!editor) return;
    const normalized = polishDraftMarkdown(value || '');
    if (normalized === lastMarkdownRef.current) return;
    lastMarkdownRef.current = normalized;
    editor.commands.setContent(markdownToHtml(normalized), { emitUpdate: false });
  }, [value, editor]);

  // Save/restore selection helpers for external consumers (e.g., FloatingWritingPanel)
  const saveSelection = useCallback((): { from: number; to: number } | null => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from === to) return savedSelectionRef.current;
    const range = { from, to };
    savedSelectionRef.current = range;
    return range;
  }, [editor]);

  const restoreSelection = useCallback((range: { from: number; to: number }) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(range).run();
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.chain().focus().run(),

      insertTextAtCursor: (text: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(text).run();
      },

      replaceSelection: (text: string) => {
        if (!editor) return;
        const { from, to } = editor.state.selection;

        if (from !== to) {
          // Active selection exists - delete it and insert replacement
          editor.chain().focus().deleteSelection().insertContent(text).run();
        } else if (savedSelectionRef.current) {
          // No active selection, but we have a saved one from before blur
          const saved = savedSelectionRef.current;
          editor.chain()
            .focus()
            .setTextSelection(saved)
            .deleteSelection()
            .insertContent(text)
            .run();
          savedSelectionRef.current = null;
        } else {
          // Fallback: just insert at cursor
          editor.chain().focus().insertContent(text).run();
        }
      },

      replaceRange: (from: number, to: number, text: string) => {
        if (!editor) return;
        editor.chain()
          .focus()
          .setTextSelection({ from, to })
          .deleteSelection()
          .insertContent(text)
          .run();
      },

      getSelectedText: () => {
        if (!editor) return '';
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, ' ').trim();
      },

      getMarkdown: () => {
        if (!editor) return lastMarkdownRef.current || '';
        return htmlToMarkdown(editor.getHTML());
      },

      saveSelection,
      restoreSelection
    }),
    [editor, saveSelection, restoreSelection]
  );

  return (
    <div className={`paper-editor relative rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow ${hasFocus ? 'ring-2 ring-indigo-200 border-indigo-300 shadow-md' : ''} ${className}`}>
      {/* Inject editor styles */}
      <style>{EDITOR_STYLES}</style>

      {/* Sticky toolbar - visible when editor has focus */}
      {editor && hasFocus && (
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-100 px-2 py-1.5 rounded-t-xl flex items-center gap-0.5 flex-wrap">
          {/* Text formatting */}
          <MicroButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
            <Bold className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
            <Italic className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
            <SuperscriptIcon className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
            <SubscriptIcon className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Block formatting */}
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
            title="Section Heading (H2)"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
            title="Subsection Heading (H3)"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            active={editor.isActive('heading', { level: 4 })}
            title="Sub-subsection (H4)"
          >
            <Heading4 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive('paragraph')} title="Paragraph">
            <Pilcrow className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Lists & blocks */}
          <MicroButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
            <List className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
            <ListOrdered className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Block Quote">
            <Quote className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Alignment */}
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            active={editor.isActive({ textAlign: 'left' })}
            title="Align Left"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            active={editor.isActive({ textAlign: 'center' })}
            title="Align Center"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            active={editor.isActive({ textAlign: 'justify' })}
            title="Justify"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </MicroButton>

          <ToolbarSep />

          {/* Undo/Redo */}
          <MicroButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
            <Redo2 className="w-3.5 h-3.5" />
          </MicroButton>
        </div>
      )}

      {/* Bubble menu - appears on text selection for quick formatting */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 150, placement: 'top' }}
          className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 px-1 py-0.5 shadow-xl backdrop-blur"
        >
          <MicroButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <Bold className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <Italic className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
            <UnderlineIcon className="w-3 h-3" />
          </MicroButton>
          <ToolbarSep />
          <MicroButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
            <SuperscriptIcon className="w-3 h-3" />
          </MicroButton>
          <MicroButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
            <SubscriptIcon className="w-3 h-3" />
          </MicroButton>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
      {editor?.isEmpty && (
        <div className="pointer-events-none absolute left-6 top-14 text-slate-400 text-sm italic">
          {placeholder}
        </div>
      )}
    </div>
  );
});

export default PaperMarkdownEditor;
