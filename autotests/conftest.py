"""Session-wide setup: make the repo importable, and print the scenario when a test fails."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attach the BDD scenario to a failure, so the report explains itself without the source."""
    outcome = yield
    report = outcome.get_result()
    scenario = getattr(item, "scenario", None)
    if report.when == "call" and report.failed and scenario:
        report.sections.append(("Scenario", scenario))
