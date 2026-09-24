import type { LogicalEvent, Transport } from './types.js';

/** How far apart the two copies of one event may be. */
export const MERGE_WINDOW_MS = 15_000;

/**
 * Keys that every n8n event repeats. They carry no test signal and they
 * differ between the two transports, so they must not take part in matching.
 */
const BOILERPLATE = new Set([
	'instance_id',
	'version_cli',
	'user_cloud_id',
	'is_cloud_deployment',
	'distinct_id',
	'token',
]);

/** The properties a person cares about: no SDK context, no instance boilerplate. */
export const cleanProperties = (props: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		if (key.startsWith('$') || BOILERPLATE.has(key)) continue;
		out[key] = value;
	}
	return out;
};

/** A stable string for a value, with object keys sorted, so order never matters. */
const stable = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
};

// The length prefix keeps the name and the properties from ever running
// together into the same key.
const keyOf = (event: LogicalEvent): string =>
	`${event.name.length}:${event.name}${stable(cleanProperties(event.properties))}`;

export type PushResult = { kind: 'new'; event: LogicalEvent } | { kind: 'merged'; event: LogicalEvent };

interface OpenRow {
	event: LogicalEvent;
	time: number;
}

/**
 * Every n8n event reaches the server twice, once from RudderStack and once
 * from a PostHog SDK. This joins the pair into one row.
 *
 * A row is shown the moment its first copy arrives. When the twin arrives
 * later, `push` reports `merged` and the caller re-renders the same row with
 * both tags. No row ever waits for a twin.
 */
export class Deduper {
	private open = new Map<string, OpenRow[]>();

	push(event: LogicalEvent): PushResult {
		const key = keyOf(event);
		const parsed = Date.parse(event.ts);
		const now = Number.isNaN(parsed) ? Date.now() : parsed;

		this.evict(now);

		const transport: Transport = event.transports[0];
		const rows = this.open.get(key) ?? [];
		const index = rows.findIndex(
			(row) => !row.event.transports.includes(transport) && Math.abs(now - row.time) < MERGE_WINDOW_MS,
		);

		if (index !== -1) {
			const row = rows[index];
			row.event.transports.push(transport);
			// A row holds at most the two transports, so it can never merge again.
			rows.splice(index, 1);
			if (rows.length === 0) this.open.delete(key);
			return { kind: 'merged', event: row.event };
		}

		rows.push({ event, time: now });
		this.open.set(key, rows);
		return { kind: 'new', event };
	}

	clear(): void {
		this.open.clear();
	}

	/** Rows past the window can never merge again, so they are dropped to keep memory flat. */
	private evict(now: number): void {
		for (const [key, rows] of this.open) {
			const kept = rows.filter((row) => Math.abs(now - row.time) < MERGE_WINDOW_MS);
			if (kept.length === 0) this.open.delete(key);
			else if (kept.length !== rows.length) this.open.set(key, kept);
		}
	}
}
