"""Page objects for the web apps: the one place that knows selectors.

A UI test reads like an API test - scenario, actions, verifications - and never holds a CSS selector.
When the front end changes markup, the fix is here, not in every test. Selectors prefer what a user sees
(roles, labels, visible text) over classes, so a restyle does not break them.
"""
