'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface PaperFigurePlannerStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
}

type FigurePlan = {
  id: string;
  figureNo: number;
  title: string;
  caption: string;
  figureType: string;
  notes?: string;
};

const FIGURE_TYPES = [
  { value: 'LINE_CHART', label: 'Line chart', description: 'Trends over time' },
  { value: 'BAR_CHART', label: 'Bar chart', description: 'Comparisons across groups' },
  { value: 'SCATTER_PLOT', label: 'Scatter plot', description: 'Correlations and clusters' },
  { value: 'BOX_PLOT', label: 'Box plot', description: 'Distributions and outliers' },
  { value: 'METHODOLOGY_FLOW', label: 'Methodology flowchart', description: 'Study workflow or procedure' },
  { value: 'SYSTEM_ARCH', label: 'System architecture diagram', description: 'Components and interactions' },
  { value: 'CONCEPT_FRAMEWORK', label: 'Conceptual framework', description: 'Variables and relationships' }
];

const EMPTY_FORM = {
  title: '',
  caption: '',
  figureType: 'LINE_CHART',
  notes: ''
};

export default function PaperFigurePlannerStage({ sessionId, authToken, onSessionUpdated }: PaperFigurePlannerStageProps) {
  const [figures, setFigures] = useState<FigurePlan[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<FigurePlan | null>(null);

  const nextFigureNo = useMemo(() => {
    if (figures.length === 0) return 1;
    return Math.max(...figures.map(fig => fig.figureNo)) + 1;
  }, [figures]);

  const loadFigures = async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/figures`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    setFigures(data.figures || []);
  };

  const refreshSession = async () => {
    if (!onSessionUpdated) return;
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    const data = await response.json();
    onSessionUpdated(data.session);
  };

  useEffect(() => {
    if (sessionId && authToken) {
      loadFigures().catch(() => undefined);
    }
  }, [sessionId, authToken]);

  const handleCreate = async () => {
    if (!authToken) return;
    if (!form.title.trim() || !form.caption.trim()) {
      setMessage('Title and caption are required.');
      return;
    }
    try {
      setCreating(true);
      setMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create figure');
      }
      setFigures(prev => [...prev, data.figure]);
      setForm(EMPTY_FORM);
      await refreshSession();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create figure');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (figureId: string) => {
    if (!authToken) return;
    const confirmed = window.confirm('Delete this figure plan?');
    if (!confirmed) return;
    const response = await fetch(`/api/papers/${sessionId}/figures/${figureId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return;
    setFigures(prev => prev.filter(fig => fig.id !== figureId));
    await refreshSession();
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!authToken) return;
    if (!editing.title.trim() || !editing.caption.trim()) {
      setMessage('Title and caption are required.');
      return;
    }
    const response = await fetch(`/api/papers/${sessionId}/figures/${editing.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: editing.title,
        caption: editing.caption,
        figureType: editing.figureType,
        notes: editing.notes
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Failed to update figure');
      return;
    }
    setFigures(prev => prev.map(fig => (fig.id === editing.id ? data.figure : fig)));
    setEditing(null);
    await refreshSession();
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Figure Planner</CardTitle>
          <CardDescription>Plan academic figures and captions for your paper.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Next figure: Figure {nextFigureNo}</Badge>
              <Badge variant="secondary">Total planned: {figures.length}</Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={form.title}
                onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                placeholder="Figure title"
              />
              <Select
                value={form.figureType}
                onValueChange={value => setForm(prev => ({ ...prev, figureType: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select figure type" />
                </SelectTrigger>
                <SelectContent>
                  {FIGURE_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Textarea
              value={form.caption}
              onChange={event => setForm(prev => ({ ...prev, caption: event.target.value }))}
              placeholder="Figure caption (required)"
              rows={3}
            />
            <Textarea
              value={form.notes}
              onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
              placeholder="Optional notes or PlantUML instructions"
              rows={2}
            />

            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Saving...' : 'Add figure plan'}
            </Button>
            {message && <div className="text-xs text-gray-600">{message}</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planned Figures</CardTitle>
          <CardDescription>Review and update planned figures.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {figures.length === 0 && (
              <div className="text-sm text-gray-500">No figures planned yet.</div>
            )}
            {figures.map(figure => {
              const typeLabel = FIGURE_TYPES.find(item => item.value === figure.figureType)?.label || figure.figureType;
              return (
                <div key={figure.id} className="rounded border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Figure {figure.figureNo}: {figure.title}
                      </div>
                      <div className="text-xs text-gray-500">{typeLabel}</div>
                      <div className="text-xs text-gray-600 mt-2">{figure.caption}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(figure)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleDelete(figure.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit figure</DialogTitle>
            <DialogDescription>Update title, caption, and figure type.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <Input
                value={editing.title}
                onChange={event => setEditing(prev => prev ? { ...prev, title: event.target.value } : prev)}
                placeholder="Figure title"
              />
              <Select
                value={editing.figureType}
                onValueChange={value => setEditing(prev => prev ? { ...prev, figureType: value } : prev)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select figure type" />
                </SelectTrigger>
                <SelectContent>
                  {FIGURE_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={editing.caption}
                onChange={event => setEditing(prev => prev ? { ...prev, caption: event.target.value } : prev)}
                placeholder="Figure caption"
                rows={3}
              />
              <Textarea
                value={editing.notes || ''}
                onChange={event => setEditing(prev => prev ? { ...prev, notes: event.target.value } : prev)}
                placeholder="Notes"
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdate}>
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
