# telemetry-inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-command tool that captures the PostHog traffic of a local n8n, shows every event live in a terminal interface, and writes a raw JSONL log that agents read with `grep` and `jq`.

**Architecture:** One binary with two roles. The process that binds the capture port owns the HTTP server, the log file, and the interface. A second invocation finds the port taken, asks `GET /health` for the log path, and follows that file instead. Both roles push raw records through the same pure `normalize` and `dedupe` functions into one capped store that the Ink interface renders.

**Tech Stack:** TypeScript on Node 20 or later, Ink 5 (React for terminals), Vitest, `ink-testing-library`, `tsup` for the bundle. No HTTP framework and no other runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-24-telemetry-inspector-design.md`

## Global Constraints

- Default capture port: `19081`. It must match `SHARED_TELEMETRY_PORT` in `~/n8n-worktrees/bin/n8n-wt`.
- Default log path: `~/.cache/telemetry-inspector/events-<port>.jsonl`.
- Node engine floor: `>=20`.
- Runtime dependencies are limited to `ink` and `react`. Everything else is a development dependency.
- The bundle at `dist/cli.js` is committed to the repository, so `npx github:rmakowiak/telemetry-inspector` runs without a build.
- The dedupe time window is `15000` milliseconds.
- Cleaned properties drop every key that starts with `$` plus `instance_id`, `version_cli`, `user_cloud_id`, `is_cloud_deployment`, `distinct_id`, `token`.
- Tests run with `npm test` (Vitest). Every task ends green.
- No em dashes and no contractions in user-facing strings and documentation.

---

### Task 1: Scaffold, types, argument parsing, environment block

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/types.ts`, `src/args.ts`, `src/env.ts`, `src/paths.ts`
- Test: `tests/args.test.ts`, `tests/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Transport = 'rudder' | 'posthog'`
  - `type Origin = 'frontend' | 'backend' | 'unknown'`
  - `interface RawRecord { ts: string; method: string; path: string; body: unknown }`
  - `interface LogicalEvent { id: string; name: string; ts: string; transports: Transport[]; origin: Origin; properties: Record<string, unknown>; raw: RawRecord }`
  - `interface Options { port: number; log: string; headless: boolean; printEnv: boolean; printLogPath: boolean; help: boolean }`
  - `parseArgs(argv: string[], env: NodeJS.ProcessEnv, isTTY: boolean): Options`
  - `envBlock(port: number): string`
  - `defaultLogPath(port: number): string`

- [ ] **Step 1: Write the failing tests**

`tests/args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

const env = {} as NodeJS.ProcessEnv;

describe('parseArgs', () => {
  it('defaults to port 19081 and a terminal interface', () => {
    const o = parseArgs([], env, true);
    expect(o.port).toBe(19081);
    expect(o.headless).toBe(false);
    expect(o.log).toMatch(/events-19081\.jsonl$/);
  });

  it('reads --port and moves the default log path with it', () => {
    const o = parseArgs(['--port', '20000'], env, true);
    expect(o.port).toBe(20000);
    expect(o.log).toMatch(/events-20000\.jsonl$/);
  });

  it('keeps an explicit --log path', () => {
    const o = parseArgs(['--log', '/tmp/x.jsonl'], env, true);
    expect(o.log).toBe('/tmp/x.jsonl');
  });

  it('turns on headless when stdout is not a terminal', () => {
    expect(parseArgs([], env, false).headless).toBe(true);
  });

  it('reads --headless, --env and --print-log-path', () => {
    expect(parseArgs(['--headless'], env, true).headless).toBe(true);
    expect(parseArgs(['--env'], env, true).printEnv).toBe(true);
    expect(parseArgs(['--print-log-path'], env, true).printLogPath).toBe(true);
  });

  it('rejects a port that is not a number', () => {
    expect(() => parseArgs(['--port', 'abc'], env, true)).toThrow(/--port/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--wat'], env, true)).toThrow(/--wat/);
  });
});
```

`tests/env.test.ts`:

```ts
import { expect, it } from 'vitest';
import { envBlock } from '../src/env.js';

it('prints five exports aimed at the given port', () => {
  const block = envBlock(19081);
  const lines = block.trim().split('\n');
  expect(lines).toHaveLength(5);
  expect(lines[0]).toBe('export N8N_DIAGNOSTICS_ENABLED=true');
  expect(block).toContain("export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'");
  expect(block).toContain("export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:19081'");
  expect(block).toContain('export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub');
  expect(block).toContain('export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npm test`
Expected: FAIL, because `src/args.ts` and `src/env.ts` do not exist.

- [ ] **Step 3: Write the scaffold and the two modules**

`package.json` holds `"type": "module"`, `"bin": { "telemetry-inspector": "dist/cli.js" }`, `"engines": { "node": ">=20" }`, the scripts `build` (`tsup src/cli.tsx --format esm --out-dir dist --banner.js "#!/usr/bin/env node"`), `test` (`vitest run`), and `typecheck` (`tsc --noEmit`). Dependencies: `ink`, `react`. Development dependencies: `@types/node`, `@types/react`, `ink-testing-library`, `tsup`, `typescript`, `vitest`.

`src/paths.ts` builds `defaultLogPath(port)` from `os.homedir()`, `.cache/telemetry-inspector`, and `events-<port>.jsonl`.

`src/args.ts` walks the argument list, throws an `Error` naming the offending flag, and applies the default log path after the port is known.

`src/env.ts` returns the five export lines joined by newlines.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold, argument parsing and the environment block"
```

---

### Task 2: normalize

**Files:**
- Create: `src/normalize.ts`
- Test: `tests/normalize.test.ts`
- Use: `tests/fixtures/*.json`, written by `scripts/make-fixtures.mjs`. They copy
  the shape of a real capture and none of its content: no real event names, no
  identifiers, no feature flag names.

**Interfaces:**
- Consumes: `RawRecord`, `LogicalEvent`, `Transport`, `Origin` from Task 1.
- Produces: `normalize(record: RawRecord): LogicalEvent[]`

The fixtures are one raw record per file, all invented:

| File | Path | Shape |
| --- | --- | --- |
| `rudder-track.json` | `/v1/track` | one event in `body` |
| `rudder-batch.json` | `/v1/batch` | events in `body.batch` |
| `posthog-web.json` | `/e/` | events in `body.batch`, `$lib` is `web` |
| `posthog-node.json` | `/batch/` | events in `body.batch`, `$lib` is `posthog-node` |
| `posthog-base64.json` | `/e/?compression=base64` | body is the string `data=<base64 of the JSON>` |
| `flags.json` | `/flags/?v=2` | a flag poll, no event |
| `rudder-page.json` | `/v1/page` | a page view |

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalize } from '../src/normalize.js';
import type { RawRecord } from '../src/types.js';

const load = (name: string): RawRecord =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('normalize', () => {
  it('reads one RudderStack track event', () => {
    const [e] = normalize(load('rudder-track'));
    expect(e.name).toBe('Report opened');
    expect(e.transports).toEqual(['rudder']);
    expect(e.origin).toBe('frontend');
    expect(e.properties.job_id).toBeDefined();
  });

  it('reads a RudderStack batch', () => {
    const events = normalize(load('rudder-batch'));
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Report deleted');
    expect(events[0].transports).toEqual(['rudder']);
  });

  it('reads a posthog-js batch as frontend', () => {
    const [e] = normalize(load('posthog-web'));
    expect(e.name).toBe('Report opened');
    expect(e.transports).toEqual(['posthog']);
    expect(e.origin).toBe('frontend');
  });

  it('reads a posthog-node batch as backend', () => {
    const [e] = normalize(load('posthog-node'));
    expect(e.transports).toEqual(['posthog']);
    expect(e.origin).toBe('backend');
  });

  it('decodes a base64 body', () => {
    const events = normalize(load('posthog-base64'));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].name).toBe('$pageleave');
  });

  it('produces no event for a flag poll', () => {
    expect(normalize(load('flags'))).toEqual([]);
  });

  it('names a page view $page', () => {
    const [e] = normalize(load('rudder-page'));
    expect(e.name).toBe('$page');
  });

  it('keeps a body that is not JSON as one unparsed event', () => {
    const [e] = normalize({ ts: '2026-01-01T00:00:00.000Z', method: 'POST', path: '/e/', body: 'not json at all' });
    expect(e.name).toBe('<unparsed>');
    expect(e.properties.raw).toBe('not json at all');
  });

  it('gives every event a distinct id', () => {
    const ids = normalize(load('posthog-node')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/normalize.test.ts`
Expected: FAIL, because `src/normalize.ts` does not exist.

- [ ] **Step 3: Write the implementation**

The function decides in this order:

1. Take the pathname before the query string. When it starts with `/flags`, `/decide`, `/array`, or equals `/favicon.ico` or `/`, return `[]`.
2. When the body is a string that starts with `data=`, decode the part after `data=` with `decodeURIComponent` and then `Buffer.from(value, 'base64')`, and parse the result as JSON. When that fails, fall through to the unparsed case.
3. When the body is a string that is not JSON, return one `<unparsed>` event whose `properties.raw` holds the string.
4. Collect the event objects: `body.batch` when it is an array, otherwise the body itself.
5. Map `/v1/page` to the name `$page` and `/v1/identify` to `$identify`. Otherwise use `item.event`. Skip an item with no name and no mapping.
6. The transport is `rudder` when the pathname starts with `/v1/`, otherwise `posthog`.
7. The origin is `backend` when `properties.$lib` is `posthog-node` or `properties.$is_server` is true, `frontend` when `properties.$lib` is `web` or the RudderStack context names a JavaScript SDK, otherwise `unknown`.
8. The timestamp is `item.timestamp ?? item.originalTimestamp ?? record.ts`.
9. The id is `` `${record.ts}:${index}` `` plus a counter, so two events in one batch never share an id.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/normalize.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: turn raw PostHog requests into logical events"
```

---

### Task 3: dedupe

**Files:**
- Create: `src/dedupe.ts`
- Test: `tests/dedupe.test.ts`

**Interfaces:**
- Consumes: `LogicalEvent` from Task 1.
- Produces:
  - `cleanProperties(props: Record<string, unknown>): Record<string, unknown>`
  - `class Deduper { push(event: LogicalEvent): { kind: 'new'; event: LogicalEvent } | { kind: 'merged'; event: LogicalEvent } }`

`push` returns `new` when the event starts a row, and `merged` when it joined an existing row. In the merged case, `event` is the row that changed, with the second transport added. The store in Task 4 uses the two cases to append or to replace.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { Deduper, cleanProperties } from '../src/dedupe.js';
import type { LogicalEvent, Transport } from '../src/types.js';

const at = (ms: number, transport: Transport, props: Record<string, unknown> = { job_id: 'r1' }): LogicalEvent => ({
  id: `${transport}-${ms}`,
  name: 'User saved workflow',
  ts: new Date(ms).toISOString(),
  transports: [transport],
  origin: 'frontend',
  properties: { ...props, instance_id: 'i', version_cli: '2.40.0', $lib: 'web' },
  raw: { ts: new Date(ms).toISOString(), method: 'POST', path: '/x', body: {} },
});

describe('cleanProperties', () => {
  it('drops the $ keys and the n8n boilerplate', () => {
    expect(cleanProperties({ job_id: 'r1', $lib: 'web', instance_id: 'i', token: 't' })).toEqual({ job_id: 'r1' });
  });
});

describe('Deduper', () => {
  it('merges the rudder copy and the posthog copy of one event', () => {
    const d = new Deduper();
    expect(d.push(at(0, 'rudder')).kind).toBe('new');
    const second = d.push(at(3000, 'posthog'));
    expect(second.kind).toBe('merged');
    expect(second.event.transports).toEqual(['rudder', 'posthog']);
  });

  it('does not merge two copies from the same transport', () => {
    const d = new Deduper();
    d.push(at(0, 'rudder'));
    expect(d.push(at(100, 'rudder')).kind).toBe('new');
  });

  it('does not merge outside the 15 second window', () => {
    const d = new Deduper();
    d.push(at(0, 'rudder'));
    expect(d.push(at(15001, 'posthog')).kind).toBe('new');
  });

  it('does not merge when the cleaned properties differ', () => {
    const d = new Deduper();
    d.push(at(0, 'rudder', { job_id: 'r1' }));
    expect(d.push(at(1000, 'posthog', { job_id: 'r2' })).kind).toBe('new');
  });

  it('merges each row at most once, so ten repeats stay ten rows', () => {
    const d = new Deduper();
    for (let i = 0; i < 10; i++) d.push(at(i * 10, 'rudder'));
    let merged = 0;
    for (let i = 0; i < 10; i++) if (d.push(at(i * 10 + 5, 'posthog')).kind === 'merged') merged++;
    expect(merged).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: FAIL, because `src/dedupe.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`Deduper` keeps a `Map` from a key to a list of open rows. The key is the event name plus a stable JSON string of the cleaned properties, built with sorted keys so the property order never matters. On `push`, it looks for the oldest open row under that key whose transport set does not already hold the new transport and whose timestamp is within 15000 milliseconds. On a hit it adds the transport, marks that row closed for this transport, and returns `merged`. Otherwise it stores the event as a new open row and returns `new`. Rows older than 15000 milliseconds are dropped from the map on every push, so memory stays flat.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: merge the two transport copies of one event"
```

---

### Task 4: store

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `normalize` (Task 2), `Deduper` (Task 3).
- Produces:
  - `class EventStore { constructor(max?: number); add(record: RawRecord): void; events(): LogicalEvent[]; visible(opts: { filter: string; showLifecycle: boolean }): LogicalEvent[]; clear(): void; subscribe(fn: () => void): () => void; count: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { EventStore } from '../src/store.js';
import type { RawRecord } from '../src/types.js';

const track = (name: string, path = '/v1/track', props: Record<string, unknown> = {}): RawRecord => ({
  ts: new Date().toISOString(),
  method: 'POST',
  path,
  body: { event: name, properties: { ...props, $lib: 'web' } },
});

describe('EventStore', () => {
  it('turns records into rows and counts them', () => {
    const s = new EventStore();
    s.add(track('A'));
    s.add(track('B'));
    expect(s.events().map((e) => e.name)).toEqual(['A', 'B']);
  });

  it('merges a twin into the existing row instead of appending', () => {
    const s = new EventStore();
    s.add(track('A', '/v1/track', { job_id: 'r' }));
    s.add({ ts: new Date().toISOString(), method: 'POST', path: '/e/', body: { batch: [{ event: 'A', properties: { job_id: 'r', $lib: 'web' } }] } });
    expect(s.events()).toHaveLength(1);
    expect(s.events()[0].transports).toEqual(['rudder', 'posthog']);
  });

  it('hides $ events unless asked', () => {
    const s = new EventStore();
    s.add(track('$pageleave'));
    s.add(track('A'));
    expect(s.visible({ filter: '', showLifecycle: false }).map((e) => e.name)).toEqual(['A']);
    expect(s.visible({ filter: '', showLifecycle: true })).toHaveLength(2);
  });

  it('filters on the name and on the properties', () => {
    const s = new EventStore();
    s.add(track('Report opened', '/v1/track', { source: 'toolbar' }));
    s.add(track('Export finished', '/v1/track', { type: 'csv' }));
    expect(s.visible({ filter: 'report', showLifecycle: false })).toHaveLength(1);
    expect(s.visible({ filter: 'csv', showLifecycle: false })).toHaveLength(1);
    expect(s.visible({ filter: 'nothing', showLifecycle: false })).toHaveLength(0);
  });

  it('drops the oldest row past the cap', () => {
    const s = new EventStore(3);
    for (const n of ['A', 'B', 'C', 'D']) s.add(track(n));
    expect(s.events().map((e) => e.name)).toEqual(['B', 'C', 'D']);
  });

  it('tells subscribers when something changed', () => {
    const s = new EventStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.add(track('A'));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.add(track('B'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('empties on clear', () => {
    const s = new EventStore();
    s.add(track('A'));
    s.clear();
    expect(s.events()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL, because `src/store.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`add` calls `normalize`, pushes each result through the `Deduper`, appends on `new`, and leaves the row in place on `merged` (the `Deduper` mutated it). It then trims to the cap and tells the subscribers once per record. The filter lowercases the needle and matches it against the event name and against `JSON.stringify` of the cleaned properties. `clear` empties the list and builds a fresh `Deduper`.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: capped event store with filtering and subscriptions"
```

---

### Task 5: log file and tailing

**Files:**
- Create: `src/logfile.ts`
- Test: `tests/logfile.test.ts`

**Interfaces:**
- Consumes: `RawRecord` from Task 1.
- Produces:
  - `class LogWriter { constructor(path: string); truncate(): void; append(record: RawRecord): void; clear(): void; readAll(): RawRecord[] }`
  - `function tailFile(path: string, onRecord: (r: RawRecord) => void): () => void`

`tailFile` reads what the file already holds, then follows it for new lines. It returns a function that stops following.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogWriter, tailFile } from '../src/logfile.js';
import type { RawRecord } from '../src/types.js';

const rec = (n: number): RawRecord => ({ ts: new Date().toISOString(), method: 'POST', path: '/v1/track', body: { event: `E${n}` } });
const tmp = () => join(mkdtempSync(join(tmpdir(), 'ti-')), 'events.jsonl');

describe('LogWriter', () => {
  it('creates the directory and writes one line per record', () => {
    const p = tmp();
    const w = new LogWriter(p);
    w.truncate();
    w.append(rec(1));
    w.append(rec(2));
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('reads its own lines back', () => {
    const p = tmp();
    const w = new LogWriter(p);
    w.truncate();
    w.append(rec(1));
    expect(w.readAll()[0].body).toEqual({ event: 'E1' });
  });

  it('skips a line that is not JSON instead of throwing', () => {
    const p = tmp();
    const w = new LogWriter(p);
    w.truncate();
    w.append(rec(1));
    require('node:fs').appendFileSync(p, 'garbage\n');
    expect(w.readAll()).toHaveLength(1);
  });

  it('empties the file on clear', () => {
    const p = tmp();
    const w = new LogWriter(p);
    w.truncate();
    w.append(rec(1));
    w.clear();
    expect(readFileSync(p, 'utf8')).toBe('');
  });
});

describe('tailFile', () => {
  it('delivers the lines already in the file and then the new ones', async () => {
    const p = tmp();
    const w = new LogWriter(p);
    w.truncate();
    w.append(rec(1));

    const seen: RawRecord[] = [];
    const stop = tailFile(p, (r) => seen.push(r));
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);

    w.append(rec(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toHaveLength(2);
    stop();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/logfile.test.ts`
Expected: FAIL, because `src/logfile.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`LogWriter` creates the parent directory with `mkdirSync(..., { recursive: true })` and appends with `appendFileSync`, one `JSON.stringify` per line. `readAll` splits on newlines and drops a line that fails to parse.

`tailFile` remembers a byte offset, reads from the offset to the end, splits complete lines, keeps a partial trailing line in a buffer, and repeats on a 200 millisecond timer. A timer is used rather than `fs.watch`, because `fs.watch` misses appends on some platforms and a 200 millisecond poll is invisible to a person. When the file becomes shorter than the offset, the offset resets to zero, so a `clear` in the owner is followed correctly.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/logfile.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: raw JSONL log writer and follower"
```

---

### Task 6: PostHog assets

**Files:**
- Create: `src/posthog-assets.ts`
- Test: `tests/posthog-assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `async function loadArrayJs(cacheDir: string, fetchImpl?: typeof fetch): Promise<{ body: string; stale: boolean }>`
  - `function remoteConfigJs(): string`
  - `function remoteConfigJson(): object`
  - `function flagsResponse(): object`

`loadArrayJs` returns the real `posthog-js` bundle. It serves the cached copy when one exists, otherwise it fetches `https://cdn.jsdelivr.net/npm/posthog-js@1/dist/array.full.js` and caches it. When both fail it returns a no-op shim with `stale: true`, and the status bar shows a warning.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flagsResponse, loadArrayJs, remoteConfigJs } from '../src/posthog-assets.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ti-cache-'));

describe('loadArrayJs', () => {
  it('fetches once and then serves the cache', async () => {
    const d = dir();
    const fetchImpl = vi.fn(async () => new Response('REAL BUNDLE', { status: 200 })) as unknown as typeof fetch;
    const first = await loadArrayJs(d, fetchImpl);
    expect(first.body).toBe('REAL BUNDLE');
    expect(first.stale).toBe(false);
    const second = await loadArrayJs(d, fetchImpl);
    expect(second.body).toBe('REAL BUNDLE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves a stale cache when the network fails', async () => {
    const d = dir();
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'array.full.js'), 'CACHED');
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await loadArrayJs(d, fetchImpl);
    expect(r.body).toBe('CACHED');
  });

  it('falls back to a no-op shim with no cache and no network', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await loadArrayJs(dir(), fetchImpl);
    expect(r.stale).toBe(true);
    expect(r.body).toContain('posthog');
  });
});

describe('the static answers', () => {
  it('answers flags with empty flags in the v2 shape', () => {
    expect(flagsResponse()).toEqual({
      flags: {},
      featureFlags: {},
      featureFlagPayloads: {},
      errorsWhileComputingFlags: false,
      quotaLimited: null,
    });
  });

  it('answers the remote config as JavaScript, not JSON', () => {
    expect(remoteConfigJs()).toContain('_POSTHOG_REMOTE_CONFIG');
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/posthog-assets.test.ts`
Expected: FAIL, because `src/posthog-assets.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`remoteConfigJs` returns:

```js
window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {};
window._POSTHOG_REMOTE_CONFIG['stub'] = { config: { enable_collect_everything: true }, siteApps: [] };
```

The shim body for the offline case is a small script that defines `window.posthog` with no-op methods, so the page never throws.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/posthog-assets.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: serve the real posthog-js bundle and the flag answers"
```

---

### Task 7: capture server

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `LogWriter` (Task 5), the asset helpers (Task 6), `RawRecord` (Task 1).
- Produces:
  - `interface CaptureServer { port: number; close(): Promise<void>; onRecord(fn: (r: RawRecord) => void): void; warning: string | null }`
  - `async function startServer(opts: { port: number; log: LogWriter; cacheDir: string }): Promise<CaptureServer>`
  - `async function probeHealth(port: number): Promise<{ tool: string; pid: number; port: number; log: string } | null>`

`startServer` rejects with an error whose `code` is `EADDRINUSE` when the port is taken. The caller then runs `probeHealth`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { LogWriter } from '../src/logfile.js';
import { probeHealth, startServer } from '../src/server.js';
import type { CaptureServer } from '../src/server.js';

let server: CaptureServer | null = null;
const startOnFreePort = async () => {
  const d = mkdtempSync(join(tmpdir(), 'ti-srv-'));
  const log = new LogWriter(join(d, 'events.jsonl'));
  log.truncate();
  server = await startServer({ port: 0, log, cacheDir: d });
  return { server: server!, log };
};
afterEach(async () => { await server?.close(); server = null; });

describe('the capture server', () => {
  it('records a posted event and answers 200', async () => {
    const { server: s, log } = await startOnFreePort();
    const res = await fetch(`http://127.0.0.1:${s.port}/v1/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'A', properties: {} }),
    });
    expect(res.status).toBe(200);
    expect(log.readAll()).toHaveLength(1);
    expect(log.readAll()[0].body).toMatchObject({ event: 'A' });
  });

  it('decodes a gzip body', async () => {
    const { server: s, log } = await startOnFreePort();
    await fetch(`http://127.0.0.1:${s.port}/v1/batch`, {
      method: 'POST',
      headers: { 'content-encoding': 'gzip', 'content-type': 'application/json' },
      body: gzipSync(Buffer.from(JSON.stringify({ batch: [{ event: 'G' }] }))),
    });
    expect(log.readAll()[0].body).toMatchObject({ batch: [{ event: 'G' }] });
  });

  it('answers a flag poll with empty flags', async () => {
    const { server: s } = await startOnFreePort();
    const res = await fetch(`http://127.0.0.1:${s.port}/flags/?v=2`, { method: 'POST', body: '{}' });
    expect(await res.json()).toMatchObject({ featureFlags: {} });
  });

  it('answers the remote config with JavaScript', async () => {
    const { server: s } = await startOnFreePort();
    const res = await fetch(`http://127.0.0.1:${s.port}/array/stub/config.js`);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('_POSTHOG_REMOTE_CONFIG');
  });

  it('answers health with the log path', async () => {
    const { server: s, log } = await startOnFreePort();
    const health = await probeHealth(s.port);
    expect(health?.tool).toBe('telemetry-inspector');
    expect(health?.log).toBe(log.path);
  });

  it('returns null from probeHealth when nothing listens', async () => {
    expect(await probeHealth(1)).toBeNull();
  });

  it('tells subscribers about each record', async () => {
    const { server: s } = await startOnFreePort();
    const seen: string[] = [];
    s.onRecord((r) => seen.push(r.path));
    await fetch(`http://127.0.0.1:${s.port}/v1/track`, { method: 'POST', body: '{"event":"A"}' });
    expect(seen).toEqual(['/v1/track']);
  });

  it('rejects with EADDRINUSE when the port is taken', async () => {
    const { server: s } = await startOnFreePort();
    const d = mkdtempSync(join(tmpdir(), 'ti-srv2-'));
    const log2 = new LogWriter(join(d, 'events.jsonl'));
    await expect(startServer({ port: s.port, log: log2, cacheDir: d })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL, because `src/server.ts` does not exist.

- [ ] **Step 3: Write the implementation**

The handler routes in this order: `/health`, `/static/*`, `/array/*/config` and `/array/*/config.js`, `/flags*` and `/decide*`, then the catch-all. The catch-all collects the body, decodes `gzip` or `deflate`, parses JSON when it can, writes the record to the log, tells the subscribers, and answers `{"status":1}` with status 200. The flag route answers `flagsResponse()`. Every route sets permissive CORS headers and answers `OPTIONS` with 204, because the browser sends a preflight to a cross-origin host. The server listens on `127.0.0.1`. When `port` is `0`, `server.port` reports the port the operating system chose.

`LogWriter` gains a public readonly `path`.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: capture server with health, flags and asset routes"
```

---

### Task 8: interface components

**Files:**
- Create: `src/ui/StatusBar.tsx`, `src/ui/EmptyState.tsx`, `src/ui/EventList.tsx`, `src/ui/DetailPane.tsx`, `src/ui/format.ts`
- Test: `tests/ui.test.tsx`

**Interfaces:**
- Consumes: `LogicalEvent` (Task 1), `cleanProperties` (Task 3), `envBlock` (Task 1).
- Produces:
  - `formatTime(iso: string): string` giving `HH:MM:SS`
  - `summarize(event: LogicalEvent, width: number): string` giving `key=value` pairs that fit the width
  - `<StatusBar count paused port role warning />`
  - `<EmptyState port />`
  - `<EventList events selectedIndex width height />`
  - `<DetailPane event raw width />`

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DetailPane } from '../src/ui/DetailPane.js';
import { EmptyState } from '../src/ui/EmptyState.js';
import { EventList } from '../src/ui/EventList.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { formatTime, summarize } from '../src/ui/format.js';
import type { LogicalEvent } from '../src/types.js';

const event: LogicalEvent = {
  id: '1',
  name: 'Report opened',
  ts: '2026-09-24T09:14:07.221Z',
  transports: ['rudder', 'posthog'],
  origin: 'frontend',
  properties: { report_kind: 'summary', duration_ms: 1234, instance_id: 'i', $lib: 'web' },
  raw: { ts: '2026-09-24T09:14:07.221Z', method: 'POST', path: '/v1/track', body: { event: 'Report opened' } },
};

describe('format', () => {
  it('prints the local time of day', () => {
    expect(formatTime('2026-09-24T09:14:07.221Z')).toMatch(/^\d\d:\d\d:\d\d$/);
  });
  it('summarizes the properties without the boilerplate', () => {
    const s = summarize(event, 80);
    expect(s).toContain('report_kind=summary');
    expect(s).not.toContain('instance_id');
  });
  it('never exceeds the width it is given', () => {
    expect(summarize(event, 12).length).toBeLessThanOrEqual(12);
  });
});

describe('EmptyState', () => {
  it('shows the setup block so a first run needs no documentation', () => {
    const { lastFrame } = render(<EmptyState port={19081} />);
    expect(lastFrame()).toContain('N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
    expect(lastFrame()).toContain('No events yet');
  });
});

describe('StatusBar', () => {
  it('shows the count, the port and the recording state', () => {
    const { lastFrame } = render(<StatusBar count={127} paused={false} port={19081} role="owner" warning={null} />);
    expect(lastFrame()).toContain('127');
    expect(lastFrame()).toContain('19081');
    expect(lastFrame()).toContain('REC');
  });
  it('shows PAUSED instead of REC when paused', () => {
    const { lastFrame } = render(<StatusBar count={1} paused port={19081} role="owner" warning={null} />);
    expect(lastFrame()).toContain('PAUSED');
  });
  it('shows a warning when one is given', () => {
    const { lastFrame } = render(<StatusBar count={0} paused={false} port={19081} role="owner" warning="offline" />);
    expect(lastFrame()).toContain('offline');
  });
});

describe('EventList', () => {
  it('marks the selected row', () => {
    const { lastFrame } = render(<EventList events={[event]} selectedIndex={0} width={60} height={5} />);
    expect(lastFrame()).toContain('Report opened');
    expect(lastFrame()).toContain('>');
  });
  it('shows only the last rows that fit the height', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...event, id: String(i), name: `E${i}` }));
    const { lastFrame } = render(<EventList events={many} selectedIndex={19} width={60} height={3} />);
    expect(lastFrame()).toContain('E19');
    expect(lastFrame()).not.toContain('E0\n');
  });
});

describe('DetailPane', () => {
  it('shows both transports and hides the boilerplate', () => {
    const { lastFrame } = render(<DetailPane event={event} raw={false} width={40} />);
    expect(lastFrame()).toContain('rudder + posthog');
    expect(lastFrame()).toContain('reason');
    expect(lastFrame()).not.toContain('instance_id');
  });
  it('shows the whole raw request in raw mode', () => {
    const { lastFrame } = render(<DetailPane event={event} raw width={40} />);
    expect(lastFrame()).toContain('/v1/track');
  });
  it('says so when nothing is selected', () => {
    const { lastFrame } = render(<DetailPane event={null} raw={false} width={40} />);
    expect(lastFrame()).toContain('Nothing selected');
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/ui.test.tsx`
Expected: FAIL, because the component files do not exist.

- [ ] **Step 3: Write the components**

Keep every component pure: it receives props and renders. No component reads the store or the clock. `summarize` walks the cleaned properties in insertion order, renders `key=value` with `JSON.stringify` for anything that is not a plain string, joins with a space, and truncates to the width with a single `…`.

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/ui.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: interface components for the event list and the detail pane"
```

---

### Task 9: the application and the entry point

**Files:**
- Create: `src/ui/App.tsx`, `src/cli.tsx`
- Test: `tests/app.test.tsx`, `tests/cli.e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the runnable binary.

`App` takes `{ store, port, role, warning, onClear, onQuit }` and owns the selection, the filter, the pause flag, the raw flag, and the lifecycle flag. It subscribes to the store in an effect.

`cli.tsx` does this, in order:

1. `parseArgs`. On `--help` print the usage and exit 0. On `--env` print `envBlock(port)` and exit 0.
2. Build the `LogWriter`.
3. Try `startServer`. On success the role is `owner`: truncate the log, and on `--print-log-path` print the path and exit 0.
4. On `EADDRINUSE` run `probeHealth`. When it answers with `tool === 'telemetry-inspector'` the role is `viewer` and the log path comes from the answer. Otherwise print an error naming the port and `--port`, then exit 1.
5. In headless mode print two lines (the log path and a hint) and keep running.
6. Otherwise render the Ink application.

- [ ] **Step 1: Write the failing tests**

`tests/app.test.tsx` drives the keys through `ink-testing-library`:

```tsx
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/ui/App.js';
import { EventStore } from '../src/store.js';
import type { RawRecord } from '../src/types.js';

const track = (name: string, props: Record<string, unknown> = {}): RawRecord => ({
  ts: new Date().toISOString(),
  method: 'POST',
  path: '/v1/track',
  body: { event: name, properties: { ...props, $lib: 'web' } },
});
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('App', () => {
  it('shows the setup block until the first event arrives', async () => {
    const store = new EventStore();
    const { lastFrame } = render(<App store={store} port={19081} role="owner" warning={null} />);
    expect(lastFrame()).toContain('N8N_DIAGNOSTICS_ENABLED');
    store.add(track('Report opened'));
    await tick();
    expect(lastFrame()).toContain('Report opened');
  });

  it('filters when the user types after f', async () => {
    const store = new EventStore();
    store.add(track('Report opened'));
    store.add(track('Export finished'));
    const { stdin, lastFrame } = render(<App store={store} port={19081} role="owner" warning={null} />);
    await tick();
    stdin.write('f');
    stdin.write('export');
    await tick();
    expect(lastFrame()).toContain('Export finished');
    expect(lastFrame()).not.toContain('Report opened');
  });

  it('pauses and resumes with p', async () => {
    const store = new EventStore();
    store.add(track('A'));
    const { stdin, lastFrame } = render(<App store={store} port={19081} role="owner" warning={null} />);
    await tick();
    stdin.write('p');
    await tick();
    expect(lastFrame()).toContain('PAUSED');
    stdin.write('p');
    await tick();
    expect(lastFrame()).toContain('REC');
  });

  it('shows the $ events only after .', async () => {
    const store = new EventStore();
    store.add(track('$pageleave'));
    store.add(track('A'));
    const { stdin, lastFrame } = render(<App store={store} port={19081} role="owner" warning={null} />);
    await tick();
    expect(lastFrame()).not.toContain('$pageleave');
    stdin.write('.');
    await tick();
    expect(lastFrame()).toContain('$pageleave');
  });

  it('opens the help with ?', async () => {
    const store = new EventStore();
    store.add(track('A'));
    const { stdin, lastFrame } = render(<App store={store} port={19081} role="owner" warning={null} />);
    await tick();
    stdin.write('?');
    await tick();
    expect(lastFrame()).toContain('filter');
  });
});
```

`tests/cli.e2e.test.ts` runs the built binary as a child process:

```ts
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;

describe('the binary', () => {
  it('prints the environment block and exits', () => {
    const out = execFileSync('node', [cli, '--env', '--port', '19081'], { encoding: 'utf8' });
    expect(out).toContain('N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
  });

  it('captures a posted event to the log file in headless mode', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'ti-e2e-')), 'events.jsonl');
    const port = 19300;
    const child = spawn('node', [cli, '--headless', '--port', String(port), '--log', log], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 700));
      await fetch(`http://127.0.0.1:${port}/v1/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'E2E event', properties: { ok: true } }),
      });
      await new Promise((r) => setTimeout(r, 200));
      const lines = require('node:fs').readFileSync(log, 'utf8').trim().split('\n');
      expect(JSON.parse(lines[0]).body.event).toBe('E2E event');
    } finally {
      child.kill();
    }
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npm test`
Expected: FAIL, because `src/ui/App.tsx` and `src/cli.tsx` do not exist and `dist/cli.js` is not built.

- [ ] **Step 3: Write the application and the entry point**

`App` uses `useInput`. While the filter is open, every printable key appends to the filter, `backspace` removes one, `escape` clears and closes, and `enter` closes and keeps it. Outside the filter the keys are the ones the spec lists. The layout reads `process.stdout.columns` and renders two panes at 100 columns or more, otherwise one column with the detail under the selected row.

`y` writes the JSON to the clipboard by spawning `pbcopy` on macOS and `xclip -selection clipboard` elsewhere, and does nothing when neither exists.

- [ ] **Step 4: Build and run the tests**

Run: `npm run build && npm test`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: the terminal application and the binary"
```

---

### Task 10: bundle, documentation and n8n-wt

**Files:**
- Create: `README.md`, `AGENTS.md`
- Create: `dist/cli.js` (built and committed)
- Modify: `~/n8n-worktrees/bin/n8n-wt` (the telemetry section, lines 1806 to 1930)
- Delete: `~/n8n-worktrees/bin/templates/telemetry-stub.js`

- [ ] **Step 1: Write the README**

It covers the one command, the environment block, the keys, and three copy-paste recipes for agents:

```bash
# start capture with no terminal interface
npx github:rmakowiak/telemetry-inspector --headless &
LOG=$(npx github:rmakowiak/telemetry-inspector --print-log-path)

# every event of one name, newest last
grep -F '"Report opened"' "$LOG" | jq -c '.body'

# every event name that fired, with counts
jq -r '[.body] + (.body.batch // []) | .[].event // empty' "$LOG" | sort | uniq -c | sort -rn
```

`AGENTS.md` holds the same recipes in a form a teammate drops into their own repository.

- [ ] **Step 2: Build the bundle and commit it**

```bash
npm run build
git add -f dist/cli.js
git commit -m "docs: README and agent recipes, with the committed bundle"
```

- [ ] **Step 3: Change n8n-wt to run the new tool**

In `bin/n8n-wt`:

- Replace `TEMPLATE_TELEMETRY_STUB` with `TELEMETRY_INSPECTOR_DIR="$HOME/workspace/telemetry-inspector"`.
- `telemetry_cmd_up` runs `node "$TELEMETRY_INSPECTOR_DIR/dist/cli.js" --headless --port "$SHARED_TELEMETRY_PORT" --log "$SHARED_TELEMETRY_DIR/events.jsonl"` when that file exists, and `npx -y github:rmakowiak/telemetry-inspector --headless --port ... --log ...` when it does not.
- `telemetry_cmd_tail` runs the same binary with no `--headless`, so it attaches to the running capture and opens the interface.
- Update `telemetry_usage` and the two `README.md` mentions of `/tail` and `POST /clear`, which no longer exist.
- Leave `attach`, `detach`, `down`, and `status` as they are. The port and the environment variables do not change, so every existing worktree keeps working.

- [ ] **Step 4: Verify end to end against a real worktree**

```bash
n8n-wt telemetry down
n8n-wt telemetry up
n8n-wt telemetry status
curl -s -X POST localhost:19081/v1/track -H 'content-type: application/json' \
  -d '{"event":"Smoke test","properties":{"ok":true}}'
tail -1 ~/n8n-worktrees/shared/telemetry/events.jsonl
n8n-wt telemetry tail   # the interface opens and shows "Smoke test"
```

Expected: the log line holds the event, and the interface shows one row named `Smoke test`.

- [ ] **Step 5: Commit both repositories**

```bash
cd ~/workspace/telemetry-inspector && git add -A && git commit -m "chore: release the first version"
cd ~/n8n-worktrees && git add -A && git commit -m "feat: replace the telemetry stub with telemetry-inspector"
```
