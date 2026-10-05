-- Expand media-reference discovery for the accepted update baseline. The original insertion
-- remains immutable evidence; both snapshots need retention, export/delete, and tenant checks.
-- Existing forced-RLS Round draft/version/history tables and triggers remain authoritative.
CREATE OR REPLACE FUNCTION openround_quiz_media_ids(document jsonb)
RETURNS TABLE(media_id uuid) LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT candidate.media_id
  FROM (
    SELECT (question->>'mediaId')::uuid AS media_id
    FROM jsonb_array_elements(COALESCE(document->'questions', '[]'::jsonb)) AS question
    WHERE question->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    UNION ALL
    SELECT reference.media_id
    FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
    CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'originalContent') AS reference
    UNION ALL
    SELECT reference.media_id
    FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
    CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'updateBaseline'->'content') AS reference
  ) AS candidate
$$;

-- Backfill only added edges without editing immutable published JSON or removing existing edges.
-- The owner-only migration runs in one transaction; explicitly honor forced-RLS tables even
-- when the maintenance principal is a non-superuser. This setting resets at commit.
SELECT set_config('app.system_access', 'on', true);
INSERT INTO media_references (workspace_id, media_id, owner_type, owner_id)
SELECT documents.workspace_id, asset.id, documents.owner_type, documents.owner_id
FROM (
  SELECT workspace_id, id AS owner_id, 'quiz_draft'::text AS owner_type, draft AS document FROM quizzes
  UNION ALL
  SELECT workspace_id, id, 'quiz_version', content FROM quiz_versions
  UNION ALL
  SELECT workspace_id, id, 'quiz_history', draft FROM quiz_draft_history
) AS documents
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(documents.document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'updateBaseline'->'content') AS requested
JOIN media_assets asset ON asset.workspace_id = documents.workspace_id AND asset.id = requested.media_id
WHERE asset.scan_status <> 'deleting'
ON CONFLICT DO NOTHING;
