# Search Console MCP

Local, project-owned MCP server for read-only access to the Google Search Console
property `sc-domain:espanolhonesto.com`.

## Security boundary

- Runs only over MCP stdio. It does not open an HTTP port.
- Requests the OAuth scope
  `https://www.googleapis.com/auth/webmasters.readonly` through Google
  Application Default Credentials (ADC).
- Accepts only end-user `authorized_user` ADC. Service accounts, Compute
  credentials, Workload Identity and other credential types are rejected.
- Hard-codes the Search Console property; tools cannot accept or enumerate a
  different property.
- Exposes only analytics queries, URL inspection and sitemap listing. It has no
  submit, add, delete or indexing tools.
- URL inspection accepts only HTTPS URLs on `espanolhonesto.com` or its
  subdomains, without credentials, fragments or non-standard ports.
- Does not log credentials, request bodies, queries, URLs or upstream error
  messages. Startup logs on stderr contain only fixed text.

Authentication and Codex MCP registration are separate launch steps. Do not
store OAuth client files, ADC files or tokens in this repository.

The launch authorization should create a dedicated `authorized_user` ADC grant
with only the read-only scope above. An existing user refresh token can already
carry broader grants that the library cannot reliably narrow or inspect
offline. The server's fixed method-and-endpoint allowlist still prevents this
MCP from issuing write requests.

Submitting or deleting a sitemap is deliberately outside this read-only MCP.
That launch action must be performed manually in Search Console, with explicit
authorization and a review of the exact property and sitemap URL.

## One-time authorization

Use the Google account that can see both the Cloud project
`stunning-tract-481609-p7` and the Search Console domain property
`espanolhonesto.com`:

1. Enable **Google Search Console API** in that exact Cloud project.
2. Configure the OAuth consent screen for the Workspace organization and create
   an OAuth client of type **Desktop app** in the same project.
3. Download the client JSON to a private location outside this repository. Do
   not paste it into Codex, commit it or copy it into a project artifact.
4. Install Google Cloud CLI locally and create a dedicated ADC grant:

```powershell
gcloud auth application-default login --client-id-file="C:\private\search-console-desktop-client.json" --scopes="https://www.googleapis.com/auth/webmasters.readonly"
```

5. Confirm only that the resulting ADC credential has type `authorized_user`;
   never print its client secret or refresh token.
6. Change the project override in `.codex/config.toml` to `enabled=true`, open a
   new Codex task in this repository, then run ping, sitemap listing, a bounded
   analytics query and representative URL inspections.

The browser is used only for the Google consent screen. Routine reads happen
through this MCP after authorization.

## Local validation

From the repository root:

```powershell
pnpm --filter @espanol-honesto/searchconsole-mcp typecheck
pnpm --filter @espanol-honesto/searchconsole-mcp test
pnpm --filter @espanol-honesto/searchconsole-mcp build
```

After an explicit ADC authorization and a successful build, the stdio entry
point is `tools/searchconsole-mcp/dist/server.js`.
