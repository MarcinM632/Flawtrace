"""The one wildcard import every test file starts with.

A test's first line being `from utils.imports import *` keeps the top of every file identical and
short, so what a reader scans is the markers and the scenario, not twelve import lines. Only
things used by almost every test belong here; anything narrower is imported by name.
"""
import time

import pytest

from utils.scenario import add_scenario_to_report
from utils.retry import retry_on_failure

__all__ = [
    "pytest",
    "time",
    "add_scenario_to_report",
    "retry_on_failure",
    "unique_id",
]


def unique_id():
    """Millisecond stamp, for names and comments that must not collide between parallel runs."""
    return str(int(time.time() * 1000))
