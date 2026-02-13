-- Add extended bibliographic fields needed by style-specific bibliography generation

ALTER TABLE "citations"
  ADD COLUMN "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "publicationPlace" TEXT,
  ADD COLUMN "publicationDate" TEXT,
  ADD COLUMN "accessedDate" TEXT,
  ADD COLUMN "articleNumber" TEXT,
  ADD COLUMN "issn" TEXT,
  ADD COLUMN "journalAbbreviation" TEXT,
  ADD COLUMN "pmid" TEXT,
  ADD COLUMN "pmcid" TEXT,
  ADD COLUMN "arxivId" TEXT;

ALTER TABLE "reference_library"
  ADD COLUMN "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "publicationPlace" TEXT,
  ADD COLUMN "publicationDate" TEXT,
  ADD COLUMN "accessedDate" TEXT,
  ADD COLUMN "articleNumber" TEXT,
  ADD COLUMN "issn" TEXT,
  ADD COLUMN "journalAbbreviation" TEXT,
  ADD COLUMN "pmid" TEXT,
  ADD COLUMN "pmcid" TEXT,
  ADD COLUMN "arxivId" TEXT;