# Checking n8n telemetry events from an agent

Drop this file into a repository so an agent knows how to check what n8n sent.

## Start the capture

```bash
npx github:rmakowiak/telemetry-inspector --headless &
LOG=$(npx github:rmakowiak/telemetry-inspector --print-log-path)
```

The capture listens on port 19081. Point n8n at it and restart the n8n backend:

```bash
export N8N_DIAGNOSTICS_ENABLED=true
export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:19081'
export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub
export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081
```

## Read the log

The log holds one JSON line per HTTP request, in the shape
`{ ts, method, path, body }`. A request carries one event in `body`, or several
in `body.batch`.

Every event name that fired, with counts:

```bash
jq -r 'select(.body | type == "object") | [.body] + (.body.batch // []) | .[].event // empty' "$LOG" | sort | uniq -c | sort -rn
```

One event with its properties:

```bash
jq -c --arg name 'Your event name' \
  'select(.body | type == "object") | [.body] + (.body.batch // []) | .[] | select(.event == $name) | .properties' "$LOG"
```

Assert that an event fired with the properties you expect. The command exits 0
on a match and 1 on no match:

```bash
jq -e --arg name 'Your event name' \
  'select(.body | type == "object") | [.body] + (.body.batch // []) | .[] | select(.event == $name) | select(.properties.source == "toolbar")' \
  "$LOG" > /dev/null
```

## Count an event once

Every event arrives twice, once from RudderStack and once from a PostHog SDK.
Filter on the path to count it once:

- `/v1/track` and `/v1/batch` are RudderStack.
- `/e/` and `/batch/` are the PostHog SDKs.

```bash
jq -r 'select(.path | startswith("/v1/")) | select(.body | type == "object") | [.body] + (.body.batch // []) | .[].event // empty' "$LOG" \
  | sort | uniq -c
```

## Start from a clean log

Restart the capture. A fresh start empties the log:

```bash
pkill -f 'telemetry-inspector --headless'
npx github:rmakowiak/telemetry-inspector --headless &
```

## Paths that carry no event

`/flags*`, `/decide*`, `/array/*` and `/static/*` are feature flag polls and
asset loads. They are answered but never written to the log, so the log holds
events only.
