#!/usr/bin/env node
// Writes the test fixtures.
//
// The fixtures are invented. They copy the SHAPE of what PostHog and
// RudderStack actually post (paths, batch wrappers, the base64 form body, the
// `$lib` markers that tell a browser event from a server one) and nothing
// else. Event names, property names, identifiers and URLs are all made up for
// a fictional app, so no real product or person appears in this repository.
//
// Run: node scripts/make-fixtures.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'tests', 'fixtures');

const INSTANCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER = '00000000-1111-2222-3333-444444444444';
const SESSION = '00000000-aaaa-bbbb-cccc-555555555555';

// Keys every event repeats. The tool strips these by name, so the names have
// to be real even though the values do not.
const boilerplate = {
	instance_id: INSTANCE,
	version_cli: '1.0.0',
};

const browserContext = {
	$os: 'Mac OS X',
	$browser: 'Chrome',
	$device_type: 'Desktop',
	$current_url: 'http://localhost:5678/reports/demo',
	$host: 'localhost:5678',
	$pathname: '/reports/demo',
	$lib: 'web',
	$lib_version: '1.0.0',
	$device_id: SESSION,
	$session_id: SESSION,
	distinct_id: `${INSTANCE}#${USER}`,
	token: 'stub',
};

const write = (name, record) => {
	writeFileSync(join(out, `${name}.json`), `${JSON.stringify(record)}\n`);
};

mkdirSync(out, { recursive: true });

// One RudderStack track call: the event sits directly in the body, and the
// library block is how the tool knows it came from a browser.
write('rudder-track', {
	ts: '2026-01-01T10:00:00.000Z',
	method: 'POST',
	path: '/v1/track',
	body: {
		channel: 'web',
		context: {
			library: { name: 'RudderLabs JavaScript SDK', version: '1.33.0' },
			traits: { ...boilerplate, user_role: 'global:owner' },
			locale: 'en-US',
		},
		event: 'Report opened',
		properties: { ...boilerplate, run_id: 'run_0000000001', report_kind: 'summary', duration_ms: 1234 },
		messageId: 'msg-0000000001',
		originalTimestamp: '2026-01-01T10:00:00.000Z',
	},
});

// A RudderStack batch: the events sit in `body.batch`, and a backend call
// carries no library block at all.
write('rudder-batch', {
	ts: '2026-01-01T10:00:01.000Z',
	method: 'POST',
	path: '/v1/batch',
	body: {
		batch: [{ event: 'Report deleted', properties: { count: 1, source: 'toolbar', tags: ['demo'] } }],
	},
});

// posthog-js: the events sit in `body.batch` and `$lib` is `web`.
write('posthog-web', {
	ts: '2026-01-01T10:00:03.000Z',
	method: 'POST',
	path: '/e/',
	body: {
		api_key: 'stub',
		batch: [
			{
				uuid: '00000000-6666-7777-8888-999999999999',
				event: 'Report opened',
				properties: {
					...browserContext,
					...boilerplate,
					run_id: 'run_0000000001',
					report_kind: 'summary',
					duration_ms: 1234,
				},
				timestamp: '2026-01-01T10:00:00.000Z',
			},
		],
		sent_at: '2026-01-01T10:00:03.000Z',
	},
});

// posthog-node: `$lib` is `posthog-node` and `$is_server` is true, which is
// how the tool tells a backend event from a browser one.
write('posthog-node', {
	ts: '2026-01-01T10:00:04.000Z',
	method: 'POST',
	path: '/batch/',
	body: {
		api_key: 'stub',
		batch: [
			{
				event: 'Report scheduled',
				properties: {
					...boilerplate,
					schedule: 'daily',
					$lib: 'posthog-node',
					$lib_version: '5.0.0',
					$is_server: true,
					$geoip_disable: true,
				},
				timestamp: '2026-01-01T10:00:04.000Z',
				distinct_id: `${INSTANCE}#${USER}`,
			},
			{
				event: 'Export finished',
				properties: {
					...boilerplate,
					rows: 42,
					$lib: 'posthog-node',
					$lib_version: '5.0.0',
					$is_server: true,
				},
				timestamp: '2026-01-01T10:00:05.000Z',
				distinct_id: `${INSTANCE}#${USER}`,
			},
		],
	},
});

// posthog-js again, but compressed: the body is the form string
// `data=<base64 of the JSON>` and carries no content-encoding header.
const compressed = {
	api_key: 'stub',
	batch: [
		{
			uuid: '00000000-cccc-dddd-eeee-000000000000',
			event: '$pageleave',
			properties: { ...browserContext, ...boilerplate },
			timestamp: '2026-01-01T10:00:06.000Z',
		},
	],
};
write('posthog-base64', {
	ts: '2026-01-01T10:00:06.000Z',
	method: 'POST',
	path: '/e/?compression=base64',
	body: `data=${Buffer.from(JSON.stringify(compressed)).toString('base64')}`,
});

// A feature flag poll. It carries no event, so the tool records it and shows
// nothing.
write('flags', {
	ts: '2026-01-01T10:00:07.000Z',
	method: 'POST',
	path: '/flags/?v=2',
	body: {
		token: 'stub',
		distinct_id: `company_${INSTANCE}`,
		groups: { company: INSTANCE },
		person_properties: {},
		geoip_disable: true,
		flag_keys_to_evaluate: ['demo_flag'],
	},
});

// A RudderStack page view. It has no event name, so the path supplies one.
write('rudder-page', {
	ts: '2026-01-01T10:00:08.000Z',
	method: 'POST',
	path: '/v1/page',
	body: {
		channel: 'web',
		context: {
			library: { name: 'RudderLabs JavaScript SDK', version: '1.33.0' },
			traits: boilerplate,
			page: { path: '/reports/demo', title: 'Reports', url: 'http://localhost:5678/reports/demo' },
		},
		name: 'Reports',
		properties: { ...boilerplate, path: '/reports/demo', title: 'Reports' },
		messageId: 'msg-0000000002',
	},
});

console.log(`wrote 7 fixtures to ${out}`);
