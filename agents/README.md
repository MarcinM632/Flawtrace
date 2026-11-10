# Agents

One folder per agent. The application starts each agent in its folder, so `CLAUDE.md` there is its working method.

| Folder | Agent |
| --- | --- |
| claudeAgentTestFlowPlanning | Test Flow phase 1, Planning |
| claudeAgentTestFlowAnalysis | Test Flow phase 3, Analysis |
| claudeAgentTestDesign | Test Flow phase 4, Design |
| claudeAgentTestFlowImplementation | Test Flow phase 5, Implementation |
| claudeAgentTestFlowCompletion | Test Flow phase 7, Completion |
| claudeAgent, claudeAgentB, claudeAgentMcp | Analyses |

Phase 6, Execution, and QA MCP have no folder: they run the procedure on the test environment through the qa MCP server, which calls the endpoints imported in the Sources tab.

Every agent starts with step 0: it reads the knowledge base, the ticket, Confluence, the code and the API contracts connected in the Sources tab. To teach the agents how to test, write it in the knowledge base (`../knowledge`), not here.

`_shared/` holds the business sense check added to every prompt and a short ISTQB library.
