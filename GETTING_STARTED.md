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

Open http://127.0.0.1:4317 in the browser. The setup window opens and stays open until the test environment API is connected. Work through its steps from top to bottom; every step except the first can be skipped and done later on the page **Sources**, where **Open setup** brings the window back.

With the API alone the agents still work: they read the application model built from the specification (the resources, what each can do, which one must exist before another and the order to create test data in), work out from it what the application is for and build the test flows. Every source you add later makes them more accurate.

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
| Projects | The project keys the team works in, for example `PRJ, SVC`. The first key feeds the first product, the second key the second product. Releases, the bug registry and the defect charts need these keys. |

Click **Save**. The app then loads Workspace, Releases, the bug registry and the defect charts from Jira. Workspace shows the open tasks assigned to the account of the token.

**Check that the data is right.** Under **Check what the app reads**, click **Check Jira data**. The table shows, for each search the app uses:

- the number of issues Jira returns, with the JQL and an **Open in Jira** link that runs the same search in Jira, so you can compare the count with the one Jira shows;
- what the app has loaded so far, with **matches** or **differs by N** next to it.

Type a name or email in **Person** to see the open tasks of that person. Type a ticket key in **Ticket** to see the exact text the agents receive. **Load into the app now** reloads every Jira page at once instead of waiting for the next scheduled refresh.

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
| "Jira has no project X" | The key in Projects is wrong, or the account of the token cannot see that project. |
| Releases or bugs are empty | Projects is empty, or the project has no unreleased version. Run **Check Jira data** to see which. |
| A count "differs" | The page was loaded before the latest change in Jira. Click **Load into the app now**. |
| Repository sync fails | `git clone` does not work from this computer. Fix git access first. |
| Agents do not start at all | Claude Code is not installed or not signed in. Run `claude` in a terminal. |

Tokens are stored only on this computer in `agent-ui/sources.json`, which git ignores.
