# Connecting LLMs and other tools

Flawtrace exposes one integration API, `/api/v1`, plus an MCP server. Through them Claude, ChatGPT or any agent can start **UI tests** and **backend tests**, run the autotest suite and read the reports.

## API key

Every call except the two descriptions needs a key. Set `QA_API_KEY`, or let the app generate one on first start: it is saved in `agent-ui/api-key.txt` (git-ignored). Send it as `Authorization: Bearer <key>` or `X-API-Key: <key>`.

## Tools

| Tool | What it does |
| --- | --- |
| `run_ui_test` | `url`, `goal`, optional `username`/`password` -> starts a UI test, returns a run id |
| `run_backend_test` | `description`, optional `scope` -> starts a backend (API) test, returns a run id |
| `run_suite` / `list_suite` / `get_suite_run` | run and read the pytest autotest suite |
| `list_runs` / `get_run` / `cancel_run` | read status and report; poll `get_run` until status is not `running` |

REST: `POST /api/v1/tests/ui`, `POST /api/v1/tests/backend`, `GET /api/v1/runs/{id}` and so on. Spec: `GET /api/v1/openapi.json`.

## Claude (Desktop, Code, any MCP client)

Add the server to `.mcp.json` (or Claude Desktop config):

```json
{ "mcpServers": { "flawtrace": {
  "command": "node", "args": ["agent-ui/mcp/flawtrace-server.js"],
  "env": { "FLAWTRACE_URL": "http://127.0.0.1:4317" } } } }
```

On the same machine the key is read from `api-key.txt`; otherwise add `FLAWTRACE_API_KEY`.

## ChatGPT (Custom GPT Actions)

1. The app must be reachable from the internet (a tunnel or a hosted deployment; set `QA_PUBLIC_URL` to that address).
2. In the GPT editor: Actions -> Import from URL -> `<public url>/api/v1/openapi.json`.
3. Authentication: API key, Bearer, paste the key.

## OpenAI / Anthropic API (function calling), other LLMs

`GET /api/v1/tools?format=openai` returns `tools` ready for the Chat Completions / Responses API, `?format=anthropic` for the Messages API, `?format=mcp` for MCP. Run the tool the model picks by calling the matching REST route (`name` = `operationId` in the spec) with your key.

## Notes

- A started run costs model usage, exactly as a run started from the page.
- The API does not bind the app to the network: to reach it from elsewhere set `QA_HOST=0.0.0.0` (or use a tunnel) and keep the key secret.
