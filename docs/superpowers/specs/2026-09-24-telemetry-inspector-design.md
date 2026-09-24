# telemetry-inspector design

Date: 2026-09-24

## Problem

n8n sends product analytics to PostHog from both the backend (`posthog-node`,
RudderStack) and the frontend (`posthog-js`). A developer who adds or changes an
event has no fast way to see what the running instance actually sends. The
current answer is a 165-line stub inside a personal tool (`n8n-wt`), which logs
one JSON line per HTTP request to a file that a person then reads with `tail -f`
and `jq`. That works for one person. It does not work for a team, and it gives
no immediate feedback.

## Goal

A tool that a teammate starts with one command, that shows every event the local
n8n sends as it happens, and that an agent can read without a terminal.

Two users carry equal weight:

1. A developer who clicks through the n8n UI and wants to read the events.
2. An agent that runs a scenario and then needs the raw record of what fired.

## Non-goals

The first version does not control feature flags, does not forward events to a
real PostHog project, does not replay a saved session, and holds no schema or
catalog of n8n event names. Every event is opaque data.

## Distribution

The code lives in its own private repository, `rmakowiak/telemetry-inspector`.
A teammate runs it with:

```
npx github:rmakowiak/telemetry-inspector
```

The bundled output is committed to the repository. `npx` from a git URL then
starts without an install or a build step on the teammate's machine.

## Setup

The tool does not launch n8n and does not edit any file in an n8n checkout. It
prints the five environment variables that point n8n at it:

```
export N8N_DIAGNOSTICS_ENABLED=true
export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub
export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081
```

The user pastes that block into the shell that runs n8n, then restarts the n8n
backend. The block also appears in the empty state of the interface, so a first
run needs no documentation.

## Process model

The tool is one binary with two roles, decided at startup.

1. The process tries to bind the capture port (19081 by default).
2. If the bind succeeds, the process is the owner. It runs the HTTP server,
   truncates and writes the log file, and renders the interface.
3. If the bind fails, the process sends `GET /health` to that port. When the
   answer identifies this tool, the process becomes a viewer: it reads the log
   path from the answer and follows that file. When the answer is anything
   else, the process stops and tells the user to pass `--port`.

Flags:

- `--port <n>`: the capture port. Default 19081.
- `--log <path>`: the log file path. Default `~/.cache/telemetry-inspector/events-<port>.jsonl`.
- `--headless`: capture with no interface. For agents and for CI.
- `--env`: print the environment block and exit.
- `--print-log-path`: print the absolute log path and exit.

A stdout that is not a terminal turns on `--headless` automatically.

## Components

Each component has one purpose and its own tests.

### server

A catch-all HTTP server. It answers every unknown request with `200` and a
generic JSON body, so `posthog-js` and `posthog-node` never retry or report an
error. It has four special paths:

- `/flags*` and `/decide*` answer with empty feature flags. `/flags/?v=2` is
  what current `posthog-js` calls, and it was 72 percent of all requests in a
  real capture, so it must be answered in the shape that version expects:
  `{"flags":{},"featureFlags":{},"featureFlagPayloads":{},"errorsWhileComputingFlags":false,"quotaLimited":null}`.
  The tool shows what n8n would send. It does not evaluate flags.
- `/static/*` serves the real `posthog-js` browser bundle, proxied once from
  `https://cdn.jsdelivr.net/npm/posthog-js@1/dist/array.full.js` and then cached
  on disk. The n8n frontend loads this script from the configured API host. A
  generic JSON answer turns `capture()` into a silent no-op, so this path must
  return the real library.
- `/array/<token>/config` and `/array/<token>/config.js` answer with a minimal
  remote configuration. `posthog-js` fetches this at startup. The `.js` form
  must return JavaScript that calls
  `window._POSTHOG_REMOTE_CONFIG`, not JSON.
- `/health` answers with the tool name, the process id, the port, and the
  absolute log path. The viewer role depends on it.
- Everything else is recorded.

The server decodes `gzip` and `deflate` bodies before it records them. It
trusts the `content-encoding` header first and then sniffs the first two bytes
for the gzip magic number `1f 8b`. The sniff is required: `posthog-js` sends
`?compression=gzip-js` and sets no `content-encoding` header, so a
header-only check loses those events. A real capture held 20 events lost this
way.

### logfile

Appends one JSON line per raw HTTP request. The line holds the timestamp, the
method, the full path, the headers that matter, and the parsed body. Nothing is
stripped and nothing is merged. This file is the interface for agents.

The owner truncates the file when it starts. A viewer never writes to it.

### normalize

A pure function. It takes one raw request record and returns zero or more
logical events. A real capture shows four request shapes that carry events and
several that do not:

- `/v1/track`: one RudderStack event in the body.
- `/v1/batch`: RudderStack events in `body.batch`.
- `/e/` and `/e/?compression=base64`: `posthog-js` events in `body.batch`.
  The base64 form arrives as the form string `data=<base64 of the JSON>` and
  must be decoded first.
- `/batch/`: `posthog-node` events in `body.batch`.
- `/flags*`, `/decide*`, `/array/*`, `/favicon.ico`, and `/`: no events.
- `/v1/page` and `/v1/identify`: page views and identify calls. These produce
  events named `$page` and `$identify`, which the default filter hides.

Each logical event carries the name, the timestamp, the transport, the origin,
the properties, and a reference to the raw record.

The transport comes from the path: `/v1/*` is `rudder`, everything else is
`posthog`. The origin comes from the `$lib` property: `posthog-node` and
`$is_server` mean `backend`, anything else means `frontend`.

A body that is not JSON produces one event named `<unparsed>` that holds the raw
string. The tool never drops a request.

### dedupe

Every event reaches the server twice. A frontend event arrives once from the
RudderStack SDK (`/v1/track`) and once from `posthog-js` (`/e/`). A backend
event arrives once from RudderStack (`/v1/batch`) and once from `posthog-node`
(`/batch/`). This component merges the two copies into one logical event tagged
with both transports.

Two events merge only when all of these are true:

- The event names are equal.
- The transports differ.
- The timestamps are within 15000 milliseconds of each other.
- The cleaned properties are deeply equal.

A real capture shows a gap of about 3 seconds between the two copies of one
event, because `posthog-js` batches before it sends. The window is 15 seconds to
cover that gap with room to spare. The cleaned properties are highly
distinguishing (they hold identifiers such as `job_id` and `batch_id`), so a
wide window does not cause a wrong merge.

Each copy is merged at most once, so ten repeats of one event show as ten rows.
Two copies from the same transport never merge.

The interface shows an event the moment its first copy arrives. When the twin
arrives later, the existing row gains the second transport tag. The tool never
delays a row to wait for a twin.

The cleaned properties drop every key that starts with `$` and these keys that
every n8n event repeats: `instance_id`, `version_cli`, `user_cloud_id`,
`is_cloud_deployment`, `distinct_id`, and `token`.

### ui

An Ink application. Ink renders React components to the terminal.

Layout, in a terminal of 100 columns or more:

```
telemetry-inspector  REC  127      | Report opened
-----------------------------------+---------------------------
 09:14:02 Report opened         | ts     09:14:07.221
 09:14:03 Export finished               | via    rudder + posthog
 09:14:05 User saved workflow      | {
>09:14:07 Report opened|   "report_kind": "summary",
 09:14:09 Report scheduled        |   "duration_ms": 1234,
                                   |   "scope": "user"
                                   | }
 [f]ilter [p]ause [c]lear  [tab] raw  [y] copy  [q]uit
```

Below 100 columns the layout collapses to a single list, and the detail of the
selected event opens under its row.

The list holds one row per logical event, in arrival order, newest last. The
view follows the newest event until the user scrolls up. After that it shows a
counter of unseen events instead of jumping.

Events whose name starts with `$` are lifecycle noise from the SDKs
(`$pageleave`, `$set`, `$groupidentify`, `$page`, `$identify`). The list hides
them by default and the key `.` shows them.

The detail pane hides the boilerplate properties. `tab` switches to the full raw
request.

Keys:

- `j`, `k`, and the arrow keys move the selection.
- `g` and `G` go to the first and the last event.
- `f` opens a filter. The filter matches a substring against the event name and
  against the properties.
- `p` pauses the view. The server keeps recording to the file.
- `c` clears the view and empties the file.
- `y` copies the selected event as JSON to the system clipboard.
- `tab` switches the detail pane between the clean view and the raw request.
- `.` shows or hides the `$` lifecycle events.
- `?` shows the keys.
- `q` quits. When the process is the owner, the capture stops with it.

## Data flow

```
n8n backend and frontend
        |
        v
    server  --> logfile (raw JSON lines)  --> agents read this with grep and jq
        |
        v
   normalize --> dedupe --> capped list of 2000 logical events --> ui
```

A viewer process reads lines from the log file and sends them through the same
`normalize` and `dedupe` path, so both roles render from one pipeline.

## The interface for agents

An agent starts the capture and leaves it running:

```
npx github:rmakowiak/telemetry-inspector --headless
```

The command prints the log path on its first line and then runs until it is
killed. The agent runs its scenario and reads the file:

```
grep '"Report opened"' "$LOG" | tail -1 | jq .
```

The README carries three recipes of this shape. The tool adds no query language
and no assertion command.

## Error handling

- The port is taken by another program: the process stops and names the port and
  the `--port` flag.
- The `posthog-js` bundle cannot be fetched and no cached copy exists: the server
  returns a no-op shim and the status bar shows a warning, because without the
  real bundle the frontend capture fails without a message.
- The log path cannot be written: the process stops at startup and names the path.
- A request body is not JSON: the tool records the raw string and shows the row
  as `<unparsed>`.

## Testing

- Unit tests for `normalize` against invented fixtures, one per body shape,
  including the base64 form and the paths that carry no event. The fixtures
  copy the shape of a real capture and none of its content.
- Unit tests for `dedupe`: a RudderStack copy and a `posthog-js` copy merge, two
  copies from one transport do not merge, and two events outside the time window
  do not merge.
- Unit tests for the environment block and for the argument parser.
- An integration test that starts the server on a free port, posts the fixture
  payloads to it, and asserts the log lines and the derived logical events.
- Interface tests with `ink-testing-library` for the empty state, the list, the
  detail pane, and the narrow layout.

The implementation is test first.

## Change to n8n-wt

`n8n-wt` keeps the same port and the same environment variables, so every
existing worktree works without an attach or a detach.

- `bin/templates/telemetry-stub.js` is deleted.
- `n8n-wt telemetry up` starts this tool in headless mode. It uses the local
  checkout at `~/workspace/telemetry-inspector` when that exists, and falls back
  to `npx github:rmakowiak/telemetry-inspector`.
- `n8n-wt telemetry tail` opens the interface, which attaches to the running
  capture.
- `down`, `status`, `attach`, and `detach` keep their current behavior.

## Open questions

None.
