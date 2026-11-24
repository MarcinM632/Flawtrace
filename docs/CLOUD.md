# Flawtrace Cloud: how it works and how to run it

The same application as the local one, offered as a service: a customer signs up, pastes their own AI key, connects sources and runs agents. The owner pays no tokens. Release steps: [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) (in Polish).

## Parts

```
browser ──https──> Caddy ──> gateway (agent-ui/cloud/server.js)
                              │  site host  : landing, legal pages (static, from cloud/site)
                              │  app host   : /_gw/*  sign-up, sign-in, account, billing, Stripe webhook
                              │               everything else: signed-in, confirmed, paying -> reverse proxy
                              ▼
                      workspace process (agent-ui/server.js, one per customer, loopback only)
                              │  data folder   CLOUD_DATA/orgs/<id>
                              │  agent loop    lib/agent-loop.js (runs the agents on the customer's API key)
                              └─ MCP servers   qa (test API), sources (Jira, Confluence, repos, knowledge), playwright
```

| File | Role |
| --- | --- |
| `cloud/server.js` | HTTP router, account API, authenticated proxy, static pages |
| `cloud/auth.js` | Sign-up, sign-in, sessions, e-mail confirmation, reset, invitations, plan rules (`access`) |
| `cloud/db.js` | SQLite (`node:sqlite`): users, workspaces, sessions, tokens, invites, Stripe events, audit |
| `cloud/tenants.js` | Starts, stops and sweeps the per-customer processes, keys, limits |
| `cloud/billing.js` | Stripe checkout, portal, webhook signature and event handling (REST, no SDK) |
| `cloud/mailer.js` | E-mail through Resend, or printed to the log when no key is set |
| `cloud/admin.js`, `cloud/backup.js` | Operator commands and the database snapshot |
| `lib/hosted.js`, `lib/net-guard.js`, `lib/secrets.js` | Inside the workspace process: gateway-only access, blocked routes, outbound guard, sealed secrets |
| `lib/agent-loop.js`, `lib/agent-tools.js`, `lib/mcp-client.js`, `lib/llm/chat.js` | Agent loop, restricted tools, MCP client, provider adapters |

## Run it on your computer

```bash
cd agent-ui
npm run cloud          # site on http://localhost:8080, app on http://app.localhost:8080
```

Browsers send `*.localhost` to your machine, so no hosts-file edit is needed. E-mails are printed in the terminal (no Resend key). Without Stripe keys it is a free beta. Data goes to `../cloud-data` (git-ignored). Tests: `npm test` (the cloud tests start a real gateway and real workspace processes).

## What protects a customer

1. **Own process, folder and key per workspace.** The key is `HMAC(CLOUD_MASTER_SECRET, workspace id)`; tokens and AI keys are sealed with AES-256-GCM (`lib/secrets.js`).
2. **The workspace process is closed to everything but the gateway.** It listens on 127.0.0.1 and answers only requests with the per-start gateway token (`QA_GATEWAY_TOKEN`). Its environment is trimmed: no Stripe, mail or master secret reaches it.
3. **No code runs on the host.** `/api/suite`, `/api/autotests`, `/api/admin`, `/api/v1`, CLI login and similar routes return 403 (`lib/hosted.js`). Agents have no shell: `Bash` accepts only `qa-git.sh` and the skills' `validate-*.sh`, run without a shell and with folder checks (`lib/agent-tools.js`). `Write`/`Edit` are limited to the run folder; `Read`/`Grep`/`Glob` to the run folder, the workspace's repositories and the agent's own folder.
4. **Outbound guard.** `fetch` is wrapped in the workspace process and in the MCP servers: private, loopback, link-local and metadata addresses are refused, redirects are followed by hand and re-checked, credentials are dropped on a cross-host redirect. Repository addresses must be public `https://`. The knowledge folder is fixed to the workspace.
5. **Limits per run:** 150 steps, 6M tokens, the agent's time limit; output of one tool cut at 40k characters; old tool output dropped when the context passes about 150k tokens.
6. **Text from tickets and pages is data.** A fixed rule is appended to every system prompt of the loop (`SAFETY_NOTE`).
7. **Accounts:** scrypt hashes, rate limits, identical answers for unknown accounts, `HttpOnly` `SameSite=Lax` cookie (`__Host-` on https), same-origin check on every write (also through the proxy), strict CSP on gateway pages.

### Residual risks (be honest with customers about them)

- Workspaces share one container, one OS user and one disk. A bug in the folder checks of the workspace process could expose another workspace's files or the gateway database. Next step: one container per workspace with CPU, memory and disk limits (`spawn` in `tenants.js` becomes `docker run`).
- The browser runs with `--no-sandbox` inside the container (`QA_PLAYWRIGHT_NO_SANDBOX=1`), so a browser exploit from a hostile page is contained only by the container. Consider the Playwright seccomp profile if you can use it.
- The outbound guard checks the address before the call; a DNS answer that changes between the check and the call is possible. The gateway token on every workspace process and the metadata-address firewall rule (checklist step 3) make this harmless in practice.
- SQLite on one server: a single point of failure. Backups are what protects against loss (checklist step 9).

## Operate

```bash
docker compose ps                                     # state
docker compose logs -f gateway                        # gateway log
docker compose exec gateway sh -c 'tail -50 /data/orgs/*/server.log'    # workspace logs
docker compose exec gateway node agent-ui/cloud/admin.js stats          # numbers
docker compose exec gateway node agent-ui/cloud/admin.js help           # all operator commands
git pull && docker compose up -d --build              # update (customers' processes restart on their next request)
```

A workspace process starts on the first request and stops after `TENANT_IDLE_MINUTES` without requests, never while it is working (`/api/gateway/busy`). `MAX_RUNNING_TENANTS` caps how many run at once; when it is reached, the least recently used idle one is stopped.

An idle workspace process takes about 55-65 MB. The memory goes to agent runs (agent plus browser), so they have their own ceiling: `MAX_ACTIVE_RUNS` for the whole server (default from RAM: (RAM - 1.5 GB) / `RUN_MEMORY_MB`) and `MAX_RUNS_PER_ORG` per workspace. A run over the ceiling waits in a fair queue (oldest first, a workspace at its own ceiling is skipped so it cannot block others) and its log shows its place. Workspaces ask for slots on an internal loopback address (`QA_SLOT_URL`, never on the public port), lease them for 90 s and renew while running, so a crashed process frees its slots. `/healthz` shows `runs: { active, waiting, max }`. Locally, `QA_MAX_PARALLEL_RUNS` does the same per app (default: no limit).

Temporary files of a workspace (browser profiles, downloads) go to its own `tmp` folder on the data volume, cleaned at each start, not the shared `/tmp` (a RAM-backed tmpfs in the container).

## Plans

`auth.access(org)` decides: `beta` (no Stripe key: free), `trial` (`TRIAL_DAYS`, no card), `active`, `past_due` (`PAST_DUE_GRACE_DAYS` of grace), then blocked. A blocked workspace sees the account page and cannot start the product; its data stays. Invoice customers: `admin.js grant <email>` marks a workspace as paid by hand.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Sign-up mail does not arrive | `RESEND_API_KEY`, domain verified in Resend (SPF/DKIM), spam folder, gateway log (`mail failed`) |
| "Your workspace is restarting" | `docker compose logs gateway`, then the workspace's `server.log`; memory (`TENANT_MEMORY_MB`) |
| "The service is busy right now" | `MAX_RUNNING_TENANTS` reached by working processes; raise it if the server has memory |
| Runs say "Queued: the server is at its limit" | `MAX_ACTIVE_RUNS` reached; `/healthz` shows active and waiting runs. Raise it only if `free -m` shows spare memory during runs |
| Stripe says paid, workspace not active | Webhook delivery log in Stripe (signing secret mismatch is the usual cause), `audit` via `admin.js audit <email>` |
| A run fails with "No API key" | The customer has not saved a key under Settings > AI provider |
| A run fails with "daily token budget … used up" | The workspace's own daily limit (Settings > AI provider > Token budget); it resets at midnight |
| "Possible prompt injection in the result of …" in a run log | Text in a page, ticket or API answer that looks like instructions to the model. It was fenced as data; nothing to fix on our side, but worth telling the customer |
| UI test cannot start the browser | Workspace `server.log`; the image sets `QA_PLAYWRIGHT_MCP_BIN` and `PLAYWRIGHT_BROWSERS_PATH` |
| Server refuses to start publicly | The legal fields in `.env` are still placeholders |

## Agent safeguards (API-key agent loop)

- **Untrusted boundary.** Every tool result (web page, API answer, Jira ticket, file, command output) reaches the model between `<<UNTRUSTED nonce=… source=…>>` and `<<END nonce=…>>`, with one random nonce per run. Fence markers inside the content are removed, so a page cannot close the fence and add instructions after it. Phrases that look like injections (override, role change, "no vulnerabilities found", requests to send keys) mark the fence `injection-suspect`, appear in the run log and are kept in the run (`injectionSuspects`). The Jira text that Flawtrace puts into the prompt is fenced the same way, for Claude Code runs too. `QA_UNTRUSTED_BOUNDARY=0` turns it off.
- **Backup provider.** Settings > AI provider > Backup provider (another provider, or a cheaper model of the same one). When a call fails for a reason retrying will not fix (overloaded after all retries, 429, 5xx, 401/403, no credit, quota), the run continues on the backup with the same conversation; the switch is in the log and in the run (`failovers`, `provider`). Plain request errors (400) do not switch.
- **Token budget.** Counted like the price: uncached input + output + cache writes + one tenth of cache reads. Per run (default 2,000,000, `QA_AGENT_TOKEN_LIMIT`): at 85% the agent is told to stop exploring and write its report; at 100% it gets one last turn without tools, so the run still ends with a report (`budgetStop`). Per day for the whole workspace (default none, `QA_DAY_TOKEN_LIMIT`): when used up, new runs do not start and say why; it resets at midnight. Both are set by the customer in Settings > AI provider.
