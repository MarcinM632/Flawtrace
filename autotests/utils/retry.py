"""Retry for checks that race with the system, never for hiding a defect.

Some state lands asynchronously: a position appears a moment after the order is accepted, a group
change propagates on the next refresh. A `verify_*` helper for that kind of check is wrapped here
so it waits instead of failing on the first look.

It is not a flaky-test plaster. If a test needs a retry to pass at all, the retry is hiding a bug
and belongs in the bug registry instead.
"""
import functools
import time


def retry_on_failure(retries=3, delay=2):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last = None
            for attempt in range(1, retries + 1):
                try:
                    return func(*args, **kwargs)
                except AssertionError as error:
                    last = error
                    if attempt < retries:
                        time.sleep(delay)
            raise AssertionError(f"Still failing after {retries} attempts: {last}")
        return wrapper
    return decorator
