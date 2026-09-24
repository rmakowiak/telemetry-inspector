#!/usr/bin/env bash
# Prints how often this repository was cloned, which is how often somebody ran
# `npx github:rmakowiak/telemetry-inspector`. GitHub keeps a rolling 14 days
# and aggregates once a day, so today's number appears some hours late.
set -euo pipefail

repo="${1:-rmakowiak/telemetry-inspector}"

command -v gh >/dev/null 2>&1 || { echo "gh is not on PATH: https://cli.github.com" >&2; exit 1; }

gh api "repos/$repo/traffic/clones" --jq '
  "clones, last 14 days: \(.count) total, \(.uniques) unique\n",
  (.clones[] | select(.count > 0) | "  \(.timestamp[0:10])  \(.count) total  \(.uniques) unique")
'
