DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferenceDocumentSource') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumlabel = 'TEXT_PASTE'
        AND enumtypid = 'ReferenceDocumentSource'::regtype
    ) THEN
      ALTER TYPE "ReferenceDocumentSource" ADD VALUE 'TEXT_PASTE';
    END IF;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;