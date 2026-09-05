# Español Honesto

Español Honesto is a Spanish academy application for adults preparing for production launch. Its initial offer is one-to-one online Spanish: four 50-minute classes for EUR 259, renewing every 28 days from the first class. Before payment, a learner sees the teacher, weekly schedule, timezone, all four class dates, and the exact renewal date.

The application is server-rendered with Astro and React. Supabase provides Auth and Postgres. Staging uses Stripe Sandbox, and its separate Cloudflare Worker handles Google Workspace and Resend fulfillment. Production is currently the Cloudflare Pages project `espanolhonesto`; checkout remains closed and production fulfillment Workers are outside the repository's current deployment scope.

## Agent-assisted booking with WebMCP

Staging URL: [staging.espanolhonesto.com](https://staging.espanolhonesto.com)

The WebMCP integration extends the existing product instead of introducing a separate booking engine. The same canonical offer, public availability endpoint, slot validation, visible review modal, account boundary, legal acknowledgements, Turnstile, and Stripe path remain authoritative for people and agents.

### Integration

The product contains public availability, atomic slot holds, four-date and renewal validation, account recovery, legal review, Stripe checkout, subscription operations, a student campus, teacher/admin operations, fulfillment, and an ordinary non-agent booking flow.

WebMCP adds:

- top-level imperative WebMCP registration through `document.modelContext.registerTool(...)`;
- six small tools over the real offer and public booking flow;
- bounded availability pagination with exact dates converted to a requested IANA timezone;
- a visible, editable, local-only learning brief shared by the person and agent;
- visible, reversible handoff into the existing booking review;
- cancellation, stale-data, untrusted-content, fallback, and safety contracts.

The implementation lives primarily in `src/lib/academy-webmcp.ts`, `src/lib/public-availability-client.ts`, and `src/components/AcademyWebMcpPanel.tsx`.

### Site tools

| Tool | Effect |
|---|---|
| `get_academy_offer` | Reads the canonical offer, fit boundaries, guarantee, and human checkout requirements. |
| `check_fit` | Applies explicit adult/language/lesson-format boundaries without ranking or persuasion. |
| `list_bookable_slots` | Reads one current public place per page, including source schedule, requested-timezone dates, renewal, and checkout state. |
| `draft_learning_brief` | Populates an editable goal/context brief that remains only in the current page. |
| `prepare_booking_review` | Revalidates one public place and opens it in the ordinary visible review or login flow. |
| `clear_booking_draft` | Clears the local brief, closes the review, and restores the neutral page. |

Live teacher and database strings are marked as untrusted content. Runtime validation is independent of the JSON Schemas, volatile results include their source and observation time, and availability calls receive the agent's cancellation signal.

### Human safety boundary

WebMCP can read public product facts and prepare visible, reversible page state. It cannot:

- sign in or access the private campus;
- attest that the learner is an adult;
- accept terms, privacy, service-start, or withdrawal acknowledgements;
- solve or bypass Turnstile;
- create a hidden hold or Checkout Session;
- authorize payment or claim that a purchase succeeded.

Those actions remain in the existing visible interface and server-side authorization path. If WebMCP is unavailable or registration fails, the complete human booking flow still works.

### Example scenario

Open the English page in ChatGPT's built-in browser or a WebMCP-enabled compatible browser, then ask:

> I am an adult at B1 moving to Madrid. I want individual online Spanish lessons and I am available on Monday evenings in Europe/London. Check whether the academy fits, compare current places in my timezone, draft a short learning brief for workplace conversations, and prepare the place I choose for review. Do not accept terms, pass a security check, reserve, or pay for anything.

The shared outcome is an honest fit decision, current bounded inventory, four exact dates and renewal in the learner's timezone, an editable on-page brief, a revalidated visible review, and a clear stop before consent or payment.

### Current preview limits

- WebMCP is an experimental, page-scoped browser API and is feature-detected at runtime.
- Staging remains a non-indexed test environment and uses Stripe Sandbox rather than live customer payments.
- A place is not held by a WebMCP tool; availability is revalidated when review opens and again by the existing checkout backend.
- Discovery and recommendation from a blank chat also depend on normal crawlability, structured data, reputation, and agent policy. WebMCP alone does not guarantee ranking.

The acceptance specification and remaining human/external gates are in `docs/LAUNCH_WEBMCP_SPEC.md`.

## Development and verification

Requirements: Node 22.12 or later and pnpm 10.33. Use pnpm only.

Install dependencies and run the public, credential-free checks:

```bash
pnpm install
pnpm run secrets:check
pnpm run typecheck
pnpm run lint
pnpm run test:run
pnpm run test:e2e
```

The public test suite uses inert local values and does not read staging credentials. Full staging development and builds require credentials for the exact resources documented in `docs/ENVIRONMENTS.md`. First copy `.env.example` to `.env.staging`, then run:

```bash
pnpm run env:staging:sync
pnpm run dev
```

Replace every placeholder locally before starting the integrated staging application. Never commit `.env.staging`, `.dev.vars.staging`, `.env.test`, or any provider secret. Deployment is manual from `main` through `.github/workflows/deploy-staging.yml`; there is no automatic production deployment.

## Architecture and durable sources

- `docs/PRODUCT.md`: offer, learner experience, and product boundaries.
- `docs/ENVIRONMENTS.md`: exact environment and provider map.
- `docs/OPERATIONS.md`: development, deployment, recovery, and incident operations.
- `docs/LAUNCH_WEBMCP_SPEC.md`: production launch, discovery, WebMCP, verification, and rollback requirements.
- `ARCHITECTURE.md`: structural boundaries.
- `docs/crm/custom-crm-model.md`: CRM model.
- `docs/crm/privacy-operations.md`: CRM privacy operations.

The current code, migrations, executable configuration, and tests remain the primary source of truth.

## Official WebMCP references

- [OpenAI site tools documentation](https://learn.chatgpt.com/docs/webmcp)
- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Chrome WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
