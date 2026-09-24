#!/usr/bin/env bash
# Posts invented events at the demo capture, so the recording shows a stream
# arriving live. Nothing here comes from a real instance: the GIF is
# published, so it carries made-up names exactly like the fixtures do.
#
# It waits for the capture to answer before it starts, so the timing of the
# recording corrects itself no matter how long the tool takes to boot.
set -euo pipefail
port="${1:-19577}"

# The default port belongs to a real capture on a developer machine. Feeding
# that one would put real events on screen, and the screen is being recorded.
if [ "$port" = "19081" ]; then
	echo "refusing to feed port 19081: that is the real capture port" >&2
	exit 1
fi

for _ in $(seq 1 100); do
	curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break
	sleep 0.2
done

# The library block is what marks a RudderStack call as coming from a browser,
# exactly as the real SDK sends it. Without it the row reads "unknown".
CONTEXT='{"library":{"name":"RudderLabs JavaScript SDK","version":"1.33.0"}}'

track() { # the RudderStack copy
	curl -s -o /dev/null -X POST "http://127.0.0.1:$port/v1/track" \
		-H 'content-type: application/json' \
		-d "{\"event\":\"$1\",\"properties\":$2,\"context\":$CONTEXT}" || true
}

posthog() { # the posthog-js copy of the same event, so the row shows both
	curl -s -o /dev/null -X POST "http://127.0.0.1:$port/e/" \
		-H 'content-type: application/json' \
		-d "{\"batch\":[{\"event\":\"$1\",\"properties\":$(echo "$2" | sed 's/}$/,"$lib":"web"}/')}]}" || true
}

both() { track "$1" "$2"; sleep 0.15; posthog "$1" "$2"; }

# Long enough for a viewer to read the setup block on the empty screen.
sleep 3.5

both 'Report opened'    '{"report_kind":"summary","duration_ms":1234}'; sleep 0.9
both 'Panel resized'    '{"panel":"sidebar","width":320}';              sleep 0.8
both 'Export finished'  '{"rows":42,"format":"csv"}';                   sleep 0.9
track '$pageleave'      '{"path":"/reports/demo"}';                     sleep 0.5
both 'Report scheduled' '{"schedule":"daily","hour":9}';                sleep 0.9
both 'Export finished'  '{"rows":1084,"format":"json"}';                sleep 0.8
both 'Teammate invited' '{"role":"editor","via":"link"}';               sleep 0.9
both 'Report opened'    '{"report_kind":"detail","duration_ms":97}'
