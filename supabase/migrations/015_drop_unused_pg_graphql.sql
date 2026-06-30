-- The app uses Supabase REST/Auth, not the pg_graphql endpoint.
-- Dropping the unused extension removes GraphQL schema introspection exposure.

DROP EXTENSION IF EXISTS pg_graphql;
