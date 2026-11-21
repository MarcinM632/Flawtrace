---
name: quote-vs-line-check
description: Checks that a quoted piece of evidence is really written at the cited place (file:line, ticket comment, page, endpoint) and means what the report says it means. Mechanical, cheap, done first.
---

# Quote against line

The application already checks that a cited file exists and that the line number is inside it. It also checks that a quote written in the `Dowód:` line stands near the cited line. You check the rest: that the cited place shows what the report claims it shows.

## For code: `path:line` with a quote or a claim
1. Open the cited file at the cited line. Code of the changed state is in the `kod-po` folders of the working folder and the connected repositories; the state before the change is in `kod-przed`. Use the state the claim is about: a present behaviour is read in the code after the change, a removed behaviour in the code before it.
2. **The quote is there.** Compare it to the lines at and around the cited line (up to 5 lines away is a near miss). Spaces, line breaks and comment text do not matter; names, operators, numbers and literals do.
   - exact: nothing to report;
   - found, but on another line: `bad-source` with the right line number in `evidence`;
   - not in the file: `bad-source`, `evidence`: what the cited line really contains;
   - a different name, operator or number (`>=` for `>`, another constant): `contradiction`, quote both.
3. **The line proves the claim.** A line that only declares a field, imports a class or logs a message does not prove a validation, a rule or a missing check. If the line is real but does not show what the finding says, `unsupported` with what the line really is.
4. **A missing check is shown by the whole function.** "No validation of X" cited on one line needs the surrounding function read in full. If a check of X is a few lines above or below, the claim is false: `refuted` or `contradiction` with that line.
5. **Ranges** (`File.kt:40-60`): the quote or the claim must lie inside the range; a range of more than 40 lines is too wide to prove anything, say so once.

## For other sources
- **Ticket comment**: open the ticket and the numbered comment. The words quoted must be in that comment, not in another one or in the description. Wrong comment = `bad-source` with the right place.
- **Confluence**: the quoted rule must be on the cited page in its newest version. A rule that exists only in an older version is `contradiction` with the newer text.
- **Knowledge base**: the file name and the passage.
- **Endpoint**: the name must be in `mcp__sources__api_endpoints` and the field or parameter in the contract of that endpoint.
- **Call number `[cN]`** in a test-run report: the value must be in that call of `calls.jsonl` of the working folder. A value taken from the description of an endpoint and given as a reading is `unsupported`.

## Rules
- Use the quote exactly as it is in the report for the `quote` field of the finding.
- One finding per wrong reference. Do not repeat a reference that is wrong in several places; list the first place and say how many more.
- Do not judge the finding here (that is `finding-adversary`). Here you judge only the link between the report and its evidence.
