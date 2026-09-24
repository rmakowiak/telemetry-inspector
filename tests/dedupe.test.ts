import { describe, expect, it } from 'vitest';
import { Deduper, cleanProperties } from '../src/dedupe.js';
import type { LogicalEvent, Transport } from '../src/types.js';

const at = (ms: number, transport: Transport, props: Record<string, unknown> = { run_id: 'r1' }): LogicalEvent => ({
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
		expect(cleanProperties({ run_id: 'r1', $lib: 'web', instance_id: 'i', token: 't' })).toEqual({ run_id: 'r1' });
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
		d.push(at(0, 'rudder', { run_id: 'r1' }));
		expect(d.push(at(1000, 'posthog', { run_id: 'r2' })).kind).toBe('new');
	});

	it('ignores the order the properties were written in', () => {
		const d = new Deduper();
		d.push(at(0, 'rudder', { a: 1, b: 2 }));
		expect(d.push(at(500, 'posthog', { b: 2, a: 1 })).kind).toBe('merged');
	});

	it('merges each row at most once, so ten repeats stay ten rows', () => {
		const d = new Deduper();
		for (let i = 0; i < 10; i++) d.push(at(i * 10, 'rudder'));
		let merged = 0;
		for (let i = 0; i < 10; i++) if (d.push(at(i * 10 + 5, 'posthog')).kind === 'merged') merged++;
		expect(merged).toBe(10);
	});
});
