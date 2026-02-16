/**
 * FigureNode - Custom TipTap inline node for [Figure N] placeholders.
 *
 * It preserves `data-figure-no`/`data-figure-image-path` attributes across
 * the HTML parse/serialize cycle, so figure placeholders can render as
 * inline chips (with thumbnail when available) while markdown still stores
 * canonical `[Figure N]` markers.
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const FigureNode = Node.create({
  name: 'figureRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      figureNo: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-figure-no') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.figureNo) return {};
          return { 'data-figure-no': String(attributes.figureNo) };
        },
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-figure-title') || '',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.title) return {};
          return { 'data-figure-title': String(attributes.title) };
        },
      },
      imagePath: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-figure-image-path') || '',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.imagePath) return {};
          return { 'data-figure-image-path': String(attributes.imagePath) };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-figure-no]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const rawNo = String(HTMLAttributes['data-figure-no'] || '').trim();
    const figureNo = Number.parseInt(rawNo, 10);
    const safeNo = Number.isFinite(figureNo) && figureNo > 0 ? Math.trunc(figureNo) : null;
    const figureLabel = safeNo ? `Figure ${safeNo}` : 'Figure';

    const rawTitle = String(HTMLAttributes['data-figure-title'] || '').trim();
    const rawImagePath = String(HTMLAttributes['data-figure-image-path'] || '').trim();
    const displayLabel = rawTitle ? `${figureLabel}: ${rawTitle}` : figureLabel;

    const children: any[] = [];
    if (rawImagePath) {
      children.push([
        'img',
        {
          src: rawImagePath,
          alt: displayLabel,
          class: 'paper-figure-chip-thumb',
          loading: 'lazy',
        },
      ]);
    }
    children.push(['span', { class: 'paper-figure-chip-label' }, displayLabel]);

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'paper-figure-chip',
        contenteditable: 'false',
      }),
      ...children,
    ];
  },
});

