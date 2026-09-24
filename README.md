# telemetry-inspector

Watch the PostHog events your local n8n sends, live in the terminal.

n8n reports product analytics from the backend (`posthog-node` and RudderStack)
and from the frontend (`posthog-js` and RudderStack). This tool stands in for
PostHog on your own machine. It answers every request so the SDKs never retry,
it shows each event as it arrives, and it writes a raw log that you or an agent
can read with `grep` and `jq`.

It is not PostHog. Feature flags always report "nothing active", so the tool
shows what n8n would send. It does not repeat the evaluation PostHog does on
its own side.

## Start it

```
npx github:rmakowiak/telemetry-inspector
```

The screen shows five environment variables. Paste them into the shell that
runs n8n and restart the n8n backend:

```
export N8N_DIAGNOSTICS_ENABLED=true
export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub
export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081
```

Events appear the moment n8n sends one. Click through the editor and watch.

Once events are flowing the block is no longer on screen. Press `s` at any
time to bring it back, together with the path of the raw log.

## Read the screen

```
telemetry-inspector REC  83 events  :19081
 10:16:29 Report opened                     report_kind=summary  … │ Export finished
 10:16:32 Report scheduled                  schedule=daily         │ ts 10:16:32  backend
>10:16:32 Export finished                   rows=42                │ via rudder + posthog
                                                                   │
                                                                   │ {
                                                                   │   "rows": 42,
                                                                   │   "format": "csv"
                                                                   │ }
[f]ilter  [p]ause  [c]lear  [y]ank  [tab] raw  [.] show $  [s]etup  [?] keys  [q]uit
```

Every event reaches the tool twice, once from RudderStack and once from a
PostHog SDK. One row is one event. `via rudder + posthog` means both copies
arrived. A row in yellow has been seen on one transport only, which usually
means the twin is still on its way.

Properties that every event repeats are hidden: the `posthog-js` context keys
that start with `$`, and `instance_id`, `version_cli`, `user_cloud_id`,
`is_cloud_deployment`, `distinct_id` and `token`. Press `tab` to see the whole
raw request instead.

Events whose name starts with `$` are SDK lifecycle noise (`$pageleave`,
`$set`, `$groupidentify`, `$page`, `$identify`). They are hidden. Press `.` to
show them.

## Keys

```
j / k or arrows   move the selection
g / G             first and last event
f                 filter, escape clears it
p                 pause the view, capture keeps running
c                 empty the list and the log file
y                 copy the selected event as JSON
tab               show the raw request
.                 show or hide the $ lifecycle events
s                 the environment block that points n8n at this capture
?                 the key list
q                 quit
```

The filter matches a substring against the event name and against the
properties.

## Options

```
--port <n>         capture port (default 19081)
--log <path>       log file (default ~/.cache/telemetry-inspector/events-<port>.jsonl)
--headless         capture with no interface, for agents and CI
--env              print the environment block and exit
--print-log-path   print the log file path and exit
--help             the option list
```

Run the command a second time on the same port and it opens a second view of
the same capture instead of failing. A terminal that quits a view never stops
the capture that another process owns.

## For agents

The raw log is the interface. One JSON line per HTTP request, nothing stripped
and nothing merged, in the shape `{ ts, method, path, body }`.

Start the capture and leave it running:

```bash
npx github:rmakowiak/telemetry-inspector --headless &
LOG=$(npx github:rmakowiak/telemetry-inspector --print-log-path)
```

Every request for one event, newest last:

```bash
grep -F '"Your event name"' "$LOG" | jq -c '.body'
```

Every event name that fired, with counts:

```bash
jq -r 'select(.body | type == "object") | [.body] + (.body.batch // []) | .[].event // empty' "$LOG" | sort | uniq -c | sort -rn
```

Check that an event fired with the properties you expect:

```bash
jq -e --arg name 'Your event name' \
  'select(.body | type == "object") | [.body] + (.body.batch // []) | .[] | select(.event == $name) | select(.properties.source == "toolbar")' \
  "$LOG" > /dev/null && echo fired
```

The same event appears twice in the log, once per transport. Count it once by
filtering on the path: `/v1/track` and `/v1/batch` are RudderStack, `/e/` and
`/batch/` are the PostHog SDKs.

## What it answers

| Path | Answer |
| --- | --- |
| `/v1/track`, `/v1/batch`, `/e/`, `/batch/` | `{"status":1}`, and the request is recorded |
| `/flags*`, `/decide*` | empty feature flags |
| `/static/*` | the real `posthog-js` browser bundle, cached on disk |
| `/array/<token>/config[.js]` | a minimal remote configuration |
| `/health` | the tool name, the process id, the port and the log path |
| anything else | `{"status":1}`, and the request is recorded |

Bodies compressed with `gzip` or `deflate` are decoded first. The gzip magic
number is sniffed as well as read from the header, because `posthog-js` sends
`?compression=gzip-js` and sets no `content-encoding`.

## Who is using it

`npx` from a git URL does a `git clone`, so GitHub's clone traffic is the
closest thing to a download count:

```
npm run downloads
```

GitHub keeps a rolling 14 days, aggregates once a day, and a clone tells you
nothing about who ran it or whether they kept using the tool. For a number
with history, publish the package to npm instead.

## Develop

```
npm install
npm test          # 91 tests
npm run typecheck
npm run build     # writes dist/cli.js, which is committed
```

The fixtures under `tests/fixtures/` are invented, written by
`scripts/make-fixtures.mjs`. They copy the shape of a real capture and none of
its content. Never commit a real capture: it holds instance and user
identifiers, unreleased feature flag names and unreleased event schemas.

`dist/cli.js` is committed on purpose. `npx` from a git URL then starts in a
second and runs no install step on the machine that runs it. Rebuild and commit
it with every change.
