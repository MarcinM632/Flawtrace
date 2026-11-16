# Flawtrace as a service: plan

Decisions taken (2026-11-16):

1. **The owner pays for no tokens.** Every user connects their own AI with their own API key (Claude, Gemini, ChatGPT or any OpenAI-compatible endpoint). Flawtrace never routes model traffic through an account of the owner.
2. **Zero cost to build.** Everything is built and tested locally on free software. Money is spent only when a public hosted version goes live (see Costs).
3. **PostgreSQL from the start**, not SQLite.
4. **Simple to use.** A new user signs up, confirms the e-mail, pastes an AI key, connects the product and runs the first test.

## Two ways an AI connects (both keep token cost off the owner)

| Mode | Who runs the model | Status |
| --- | --- | --- |
| **A. The AI drives Flawtrace** | The user's own client (Claude Desktop/Code, ChatGPT) calls Flawtrace through `/api/v1` or the MCP server. Their subscription, their cost. | Done (`agent-ui/INTEGRATIONS.md`) |
| **B. Flawtrace drives the AI** | The agents inside Flawtrace call the provider with the user's API key (BYOK). | To build |

Note for users: a Claude.ai or ChatGPT **subscription is not an API key**. BYOK needs an API key from the provider's developer console, which is billed separately by the provider. Mode A works with a plain subscription.

## Mode B: what has to be built

Today the agents run through the Claude Code CLI, signed in on one machine. For BYOK:

1. **Provider adapter** with one interface (`complete(messages, tools) -> text | tool calls, usage`) and implementations for Anthropic, OpenAI, Google Gemini and any OpenAI-compatible URL (covers local and other models).
2. **Own agent loop** that replaces the CLI: calls the adapter, executes the requested tools, feeds results back, stops on a final report or a step limit.
3. **Tool executor** around the existing tools: the `qa` MCP server (API calls), `sources` (Jira, Confluence, repositories, knowledge), Playwright (UI tests), `qa-git`. Tool schemas are translated per provider.
4. **Prompt port**: the `CLAUDE.md` of each agent is written for Claude Code (sub-agents, skills). Each one needs a provider-neutral version.
5. **Key vault**: keys stored encrypted (AES-256-GCM, master key from the environment of the server), shown only masked, never logged, sent only to the provider the user chose. A "Test key" button before first use.
6. **Usage and limits**: tokens and estimated cost per run from the provider's usage field, a per-run step and token ceiling so a mistake cannot burn the user's budget.
7. **Quality gate per model**: a fixed set of reference tasks run against each supported model; only models that pass are listed as supported. The Verifier agent stays mandatory, so a weaker model cannot pass an unverified claim.

Risk: agent quality differs between models. Start with Claude and one more provider, add others after they pass the gate.

## Accounts and data

- Sign up and sign in with e-mail and password (scrypt hash), e-mail confirmation, password reset. Tokens are single use, stored as hashes, reset expires after one hour. Rate limit on attempts, `httpOnly` session cookie.
- PostgreSQL: users, organisations, memberships, sessions, tokens, encrypted AI keys, run metadata, bug registry, settings. `org_id` on every table; row-level security.
- E-mails: in development the link is printed to the console (no account, no cost). In production use a provider with a free tier (Resend, SES, Postmark) once a domain exists.

## Structure already in place

- `agent-ui/lib/llm/`: provider registry (Claude Code, Anthropic, OpenAI, Gemini, any OpenAI-compatible address), one `complete(system, input)` entry point, user key stored locally in `llm.json`, never returned by the API or written into errors.
- Settings > AI provider: choose provider, model, address and key, then Test. Only a direct local request may change it.
- Single-step features (prompt engineer, metrics text, coverage text) use the selected provider. **Agents still run on Claude Code** until the agent loop (phase 2) exists; the UI says so.

## Phases

- [ ] **0. Accounts**: Postgres (local Docker or installer, or a free Neon database), sign up, confirm e-mail, sign in, reset password, console mailer. Cost: 0.
- [ ] **1. Organisations and key vault**: workspaces, roles, encrypted AI keys, Test key button. Cost: 0.
- [ ] **2. Provider adapter and agent loop** for Claude, then a second provider; reference-task gate. Cost: 0 to build, tokens only when testing with your own small budget.
- [ ] **3. Isolation**: each run in a throwaway container with no shared disk; data separated per organisation.
- [ ] **4. Hosting and plans**: public deployment, Stripe. First money spent here (see Costs).
- [ ] **5. Pilot** with a few companies before building anything more.

## Costs (approximate; check current price lists)

- Building and testing: **0**.
- Tokens: **0 for the owner** (user's key, or user's own client in mode A).
- Public hosted version: a small server, a domain and e-mail sending, roughly 30 to 80 USD per month at the start; Stripe takes a fee per payment, no monthly fee. A free tier can cover a closed beta but has limits and can sleep.
- **Truly zero alternative**: self-hosted. A company runs Flawtrace itself (Docker) with its own database and key; the owner hosts nothing.

## Pricing consequence

With no token cost the owner's marginal cost per customer is only hosting and support. A **flat monthly subscription per workspace** now fits: no usage meter needed, no risk from heavy users. Keep a free trial limited in time, and keep self-hosted as a separate paid licence if there is demand.

## Open points

- Terms: check each provider's terms for use of API keys by a third-party application.
- Legal: privacy policy, terms, data processing agreement; customers will send data about their own software.
- Security: the whole app outside `/api/v1` has no login yet; no public deployment before phase 0 and 3 are done.
