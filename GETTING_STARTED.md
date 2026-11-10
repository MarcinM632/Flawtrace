# Getting started

This guide takes about 15 minutes. At the end the agents can read your tickets, specifications and code and run tests on your test environment.

## 1. Install

You need:

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 18 or newer | `node --version` |
| Git | any recent | `git --version` |
| Bash | Git Bash on Windows | `bash --version` |
| Claude Code | latest, signed in | `claude --version`, then run `claude` once and sign in |

## 2. Start the application

```
cd agent-ui
npm start
```

Open http://127.0.0.1:4317 in the browser. The page **Sources** opens with a checklist. Work through it from top to bottom. Every step shows a green tick when it is done.

## 3. Connect the sources

Only step 3.1 is required to run tests. The other sources make the agents more accurate, so connect as many as you can.

### 3.1 Test environment API (required for QA MCP and Execution)

| Field | Where to find it |
| --- | --- |
| Base address | The address every API path starts with, for example `https://test.example.com/api`. |
| Authorization | The header your API expects, usually `Authorization` with the value `Bearer <token>`. Leave it empty when the test API needs no login. |
| Specification | The address of the Swagger UI page or of the OpenAPI JSON, for example `https://test.example.com/swagger-ui/index.html` or `/v3/api-docs`. Without an address, use **Upload JSON**. |

Click **Save and import endpoints**. The endpoints appear in **Tools**. Tick **Read only** if the agents may only send GET requests.

### 3.2 Jira

| Field | Where to find it |
| --- | --- |
| Address | The address of your Jira, for example `https://your-org.atlassian.net`. |
| Email | The email you use to sign in to Jira. |
| API token | Create it at https://id.atlassian.com/manage-profile/security/api-tokens, then **Create API token**. For Jira Data Center leave the email empty and paste a personal access token. |
| Projects | The project keys the team works in, for example `PRJ, SVC`. |

### 3.3 Confluence

Leave every field empty when Confluence is on the same Atlassian site as Jira. Fill in **Spaces** to limit the search to the spaces that hold specifications.

### 3.4 Code repositories

Add one row per repository: a short name, the clone address or a local folder, and the branch with released code. Click **Save and sync**. Private repositories need git access on this computer, so first check that `git clone <address>` works in a terminal.

### 3.5 Knowledge base

The folder `knowledge/` already holds the test process, performance testing and test techniques. Open `knowledge/how-we-test.md` and replace every line in angle brackets: environments, test data prefix, definition of done. The agents read this file before every run.

## 4. Check

1. Click **Test connections** on the Sources page. Every row must be green.
2. Open **QA MCP** and run a short read-only process, for example: `List the first page of <a resource> and check that the answer is HTTP 200.`
3. The report must name the endpoint it called and the call number, for example `[c1]`.

When this works, run a real task through Test Flow: open **1. Planning**, paste a ticket key and switch the mode to **Auto** to run all phases one after another.

## Problems

| Symptom | Cause and fix |
| --- | --- |
| QA MCP button is disabled | No endpoints imported or no base address. Finish step 3.1. |
| "No OpenAPI or Swagger JSON found" | Use the address of the JSON document itself, or upload the file. |
| Jira test says HTTP 401 | Wrong email or token. Tokens are tied to the account that created them. |
| Repository sync fails | `git clone` does not work from this computer. Fix git access first. |
| Agents do not start at all | Claude Code is not installed or not signed in. Run `claude` in a terminal. |

Tokens are stored only on this computer in `agent-ui/sources.json`, which git ignores.
