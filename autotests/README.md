# autotests

Our own pytest suite against the backend under test. Tests are written from the **Autotests**
tab in the QA Manager UI: you describe a case in plain words and the agent writes the tests.
A finished agent run can also be turned into tests with its *Create autotests* button: the
flow of calls is split into several small tests.

New tests are written to a **staging copy** of this repo, run against the environment (and sent back
to the agent to fix when they fail), and only a test run that passed twice in a row can be saved
here with the **Save to repo** button. Nothing reaches this directory without that click, and nothing
is ever committed or pushed.

This repo is self-contained. It borrows its *style* from a separate reference-tests repo —
thin tests, a BDD scenario, logic in named helpers below the test — but shares no code with it
and never writes to it.

> This public copy has had its actual test files, HTTP client and environment config removed —
> they were specific to the private system under test. What remains is the scaffolding
> (`conftest.py`, `pytest.ini`, `utils/retry.py`, `utils/scenario.py`, `utils/imports.py`) and the
> conventions below, which describe how the suite works in general.

## Running

```powershell
pytest                      # everything
pytest -m SMOKE             # the short environment check
pytest -m INTEGRATION       # ISTQB integration level: backend-only, two or more services
pytest -m SYSTEM            # ISTQB system level: the complete integrated system, through the real UI
```

Every test carries exactly one ISTQB level marker — `SMOKE`, `INTEGRATION` or `SYSTEM` — alongside its
own area markers (registered in `pytest.ini`). The **Autotests** tab in the QA Manager UI groups by
this level (Smoke / System / Suite runner).

## Layout

```
conftest.py          session setup; prints the scenario on failure
pytest.ini           registered markers
utils/
  imports.py         the wildcard import every test starts with
  retry.py           retry_on_failure, for checks that race with the system
  scenario.py        add_scenario_to_report
  pages/             page objects for UI tests (selectors live here, never in a test)
tests/               the tests, in a folder per area (removed in this copy)
```

## How a test is written

```python
from utils.imports import *
from utils.methods.account_utils import get_account_balance


@pytest.mark.parametrize("client_id", [1001])
def test_balance_is_reported_for_an_existing_account(request, client_id):
    scenario = f"""GIVEN account {client_id} exists
        WHEN its balance is read through the backend
        THEN the response reports that account with a numeric balance"""
    add_scenario_to_report(request, scenario)

    balance = get_account_balance(client_id)

    verify_balance_belongs_to_account(balance, client_id)


def verify_balance_belongs_to_account(balance, client_id):
    assert str(balance["clientId"]) == str(client_id), \
        f"Balance was returned for {balance['clientId']}, expected {client_id}"
```

## Keep it simple

A test should be readable by someone who has never opened the code.

- **One test checks one thing.** A long flow becomes several small, independent tests; each prepares
  its own state. The same step repeated with different values is one test with `parametrize`.
- **The name says what is tested**, as a short English sentence (about nine words at most):
  `test_buy_order_opens_a_long_position`, not `test_flow_3` or `test_create_account_order_200`.
  No endpoint names, abbreviations or numbers in it. The file is named the same way: `test_<what>.py`.
- **The scenario is three or four short lines** of `GIVEN / WHEN / THEN`, one plain sentence each, as if
  told to a colleague. No endpoint paths, field names or internal units.
- **Failure messages explain the problem in words**: "Position size is 5 lots, expected 1 lot".
- **Folders are services/areas**, one short lowercase word, e.g. `trading`, `accounts`, `instruments`.
  Use an existing folder when one fits.

Rules the agent follows, and reviewers should hold it to:

- The test body is scenario, action calls and verify calls — nothing else. No inline HTTP calls,
  no inline asserts beyond a trivial one, no nested calls passed as arguments.
- Helpers live below the test, named `get_*` / `create_*` / `verify_*`.
- No magic values in the body: they come from `@pytest.mark.parametrize`, where a reader sees them.
- A shared helper goes in `utils/methods/`; one only this file needs stays in the file.
- `GIVEN` names the environment and the exact values; `WHEN` every step; `THEN` the expected result.

## UI tests

UI tests drive a web app in a browser with Playwright (`pytest-playwright`). They are ordinary
pytest tests in this repo, run by the same runner, markers and verification loop; `-m UI` / `-m "not UI"` picks them.

- **Hybrid by default.** The browser does the step being tested; the backend supplies the
  expected values and does setup and cleanup. A UI test asserts that the screen agrees with the backend, so it catches
  what an API test cannot: wrong mapping, filters, dialogs, exports, disabled buttons.
- **Selectors live in page objects** in `utils/pages/`, never in tests. They use what a user sees (roles, labels, text).
- **Login once per run** through the real form; every test gets a fresh browser context from that session.
- **A failure keeps a trace and a screenshot** in `test-results/`: `playwright show-trace test-results/<test>/trace.zip`.
- **Write safely.** A test that creates something gives it a unique, clearly-marked name, makes it harmless
  (no notifications, patterns that match nothing) and deletes it in a fixture's teardown. Page-wide switches
  are never touched.

```powershell
pytest -m UI --headed --slowmo 300   # watch them run
```
