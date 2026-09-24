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
		expect(e.properties.run_id).toBeDefined();
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
		const [e] = normalize({
			ts: '2026-01-01T00:00:00.000Z',
			method: 'POST',
			path: '/e/',
			body: 'not json at all',
		});
		expect(e.name).toBe('<unparsed>');
		expect(e.properties.raw).toBe('not json at all');
	});

	it('gives every event a distinct id', () => {
		const ids = normalize(load('posthog-node')).map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives distinct ids to two records that arrived in the same millisecond', () => {
		const record: RawRecord = {
			ts: '2026-01-01T00:00:00.000Z',
			method: 'POST',
			path: '/v1/track',
			body: { event: 'A', properties: {} },
		};
		expect(normalize(record)[0].id).not.toBe(normalize(record)[0].id);
	});
});
