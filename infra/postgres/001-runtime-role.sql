DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    CREATE ROLE openround_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_app') THEN
    CREATE ROLE openround_app LOGIN PASSWORD 'openround-app-local';
  END IF;
END $$;

GRANT openround_runtime TO openround_app;
GRANT CONNECT ON DATABASE openround TO openround_app;
