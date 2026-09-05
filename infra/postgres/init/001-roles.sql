DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qarau_api') THEN
    CREATE ROLE qarau_api LOGIN PASSWORD 'qarau-api-local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qarau_worker') THEN
    CREATE ROLE qarau_worker LOGIN PASSWORD 'qarau-worker-local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qarau_chain') THEN
    CREATE ROLE qarau_chain LOGIN PASSWORD 'qarau-chain-local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE qarau TO qarau_api, qarau_worker, qarau_chain;
GRANT USAGE ON SCHEMA public TO qarau_api, qarau_worker, qarau_chain;

ALTER DEFAULT PRIVILEGES FOR ROLE qarau_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qarau_api, qarau_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE qarau_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO qarau_chain;
ALTER DEFAULT PRIVILEGES FOR ROLE qarau_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qarau_api, qarau_worker, qarau_chain;
