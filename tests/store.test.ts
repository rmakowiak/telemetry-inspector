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
	it('turns records into rows and keeps arrival order', () => {
		const s = new EventStore();
		s.add(track('A'));
		s.add(track('B'));
		expect(s.events().map((e) => e.name)).toEqual(['A', 'B']);
	});

	it('merges a twin into the existing row instead of appending', () => {
		const s = new EventStore();
		s.add(track('A', '/v1/track', { run_id: 'r' }));
		s.add({
			ts: new Date().toISOString(),
			method: 'POST',
			path: '/e/',
			body: { batch: [{ event: 'A', properties: { run_id: 'r', $lib: 'web' } }] },
		});
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

	it('does not tell subscribers about a record that carries no event', () => {
		const s = new EventStore();
		const fn = vi.fn();
		s.subscribe(fn);
		s.add({ ts: new Date().toISOString(), method: 'POST', path: '/flags/?v=2', body: {} });
		expect(fn).not.toHaveBeenCalled();
	});

	it('empties on clear', () => {
		const s = new EventStore();
		s.add(track('A'));
		s.clear();
		expect(s.events()).toEqual([]);
	});
});
