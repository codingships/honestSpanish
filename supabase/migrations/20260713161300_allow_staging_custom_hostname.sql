-- Keep historical Worker-host smoke rows valid while making the branded
-- staging hostname the only additional accepted stable origin.
ALTER TABLE public.staging_integration_smoke_runs
    DROP CONSTRAINT staging_integration_smoke_runs_base_host_check,
    ADD CONSTRAINT staging_integration_smoke_runs_base_host_check CHECK (
        base_host = 'espanolhonesto-staging.alindev95.workers.dev'
        OR base_host = 'staging.espanolhonesto.com'
        OR base_host ~ '^[a-z0-9]+(?:-[a-z0-9]+)*-espanolhonesto-staging[.]alindev95[.]workers[.]dev$'
    );
