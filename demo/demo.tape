# Renders demo/demo.gif with vhs (https://github.com/charmbracelet/vhs).
#
#   brew install vhs
#   npm run demo
#
# The recording runs the published command on port 19577 with its own log
# file, and demo/feed.sh posts invented events at it. The port and the log
# are explicit on purpose: with no --port the tool binds 19081, finds the
# real capture already there, attaches to it as a viewer, and puts real
# events on screen. This GIF is published, so it must never do that.

Output demo/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1300
Set Height 620
Set Padding 14
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "cd $(pwd)"
Enter
Type "rm -rf /tmp/telemetry-demo && mkdir -p /tmp/telemetry-demo"
Enter
# Warm the npx cache, so the visible run starts straight away instead of
# showing a blank screen while git clones.
Type "npx -y github:rmakowiak/telemetry-inspector --env >/dev/null 2>&1"
Enter
Sleep 30s
# The feeder waits for /health, so it can start before the tool does.
Type "./demo/feed.sh 19577 >/dev/null 2>&1 &"
Enter
Type "clear"
Enter
Sleep 500ms
Show

Type "npx github:rmakowiak/telemetry-inspector --port 19577 --log /tmp/telemetry-demo/events.jsonl"
Sleep 600ms
Enter

# The empty state carries the setup: the block to paste into the shell that
# runs n8n. Hold it long enough to read.
Sleep 4s

# Events arrive.
Sleep 5s

# Filter down to one kind of event.
Type "f"
Sleep 500ms
Type "export"
Sleep 2200ms
Escape
Sleep 1200ms

# Walk up the list and open the raw request behind a row.
Type "k"
Sleep 400ms
Type "k"
Sleep 900ms
Tab
Sleep 2400ms
Tab
Sleep 800ms

# Bring the setup block back at any time.
Type "s"
Sleep 3s
Space
Sleep 600ms

Type "q"
Sleep 800ms
