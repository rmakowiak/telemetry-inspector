# Fixtures

These files are invented. `scripts/make-fixtures.mjs` writes them.

They copy the shape of what PostHog and RudderStack actually post: the paths,
the batch wrappers, the `data=<base64>` form body, and the `$lib` markers that
tell a browser event from a server one. Event names, property names,
identifiers and URLs belong to a fictional app.

Do not paste a real capture in here. A capture holds instance identifiers,
user identifiers, unreleased feature flag names and unreleased event schemas.
