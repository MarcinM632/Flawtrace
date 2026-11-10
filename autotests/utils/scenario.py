"""The BDD scenario attached to every test.

The scenario is the part of a test a non-technical reader can act on: it says who, in what state,
does what, and what must follow. It is printed on failure, so a red test explains itself without
anyone opening the file.
"""


def add_scenario_to_report(request, scenario):
    request.node.scenario = scenario
