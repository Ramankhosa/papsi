'use client';

import React from 'react';

interface Stage4ResultsProps {
  stage4Results: any;
  searchId: string;
  title: string;
  onDownloadReport?: () => void;
}

export default function Stage4ResultsDisplay({
  stage4Results,
  searchId,
  title,
  onDownloadReport
}: Stage4ResultsProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      <p>Novelty search report will be built here from scratch.</p>
    </div>
  );
}