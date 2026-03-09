import path from 'path';

export function resolvePaperFigureImageUrl(
  sessionId: string,
  figureId: string,
  imagePath?: string | null
): string | null {
  if (!imagePath) {
    return null;
  }

  const trimmed = imagePath.trim();
  if (!trimmed) {
    return null;
  }

  if (/^(?:https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('/api/papers/')) {
    return trimmed;
  }

  return `/api/papers/${encodeURIComponent(sessionId)}/figures/${encodeURIComponent(figureId)}/image`;
}

export function getPaperFigureImageCandidates(imagePath?: string | null): string[] {
  if (!imagePath) {
    return [];
  }

  const trimmed = imagePath.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/^[/\\]+/, '');
  const candidates = new Set<string>();

  if (path.isAbsolute(trimmed)) {
    candidates.add(trimmed);
  }

  if (trimmed.startsWith('/uploads/') || normalized.startsWith('uploads/')) {
    candidates.add(path.join(process.cwd(), 'public', normalized));
  }

  if (normalized.startsWith('public/')) {
    candidates.add(path.join(process.cwd(), normalized));
  }

  if (!path.isAbsolute(trimmed)) {
    candidates.add(path.join(process.cwd(), normalized));
  }

  return Array.from(candidates);
}

export function getImageContentType(imagePath: string): string {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}
