import type { LogicalEvent, Origin, RawRecord, Transport } from './types.js';

/** Paths that carry no event: flag polls, asset loads and stray browser calls. */
const NO_EVENT = [/^\/flags/, /^\/decide/, /^\/array\//, /^\/static\//, /^\/favicon\.ico$/, /^\/$/];

/** RudderStack paths that are not `track` calls but are still worth a row. */
const NAMED_PATHS: Record<string, string> = {
	'/v1/page': '$page',
	'/v1/identify': '$identify',
	'/v1/group': '$group',
	'/v1/alias': '$alias',
};

const pathname = (path: string): string => path.split('?')[0] ?? path;

/**
 * Event identity. A timestamp is not enough: two requests can arrive in the
 * same millisecond, and a duplicate id makes the list drop rows. A counter
 * that rises for the life of the process cannot collide.
 */
let sequence = 0;
const nextId = (): string => `e${++sequence}`;

/**
 * posthog-js can send `data=<base64 of the JSON>` as a form body instead of
 * JSON. Returns null when the string is not that shape or does not decode.
 */
const decodeFormBase64 = (raw: string): unknown => {
	if (!raw.startsWith('data=')) return null;
	try {
		const encoded = decodeURIComponent(raw.slice('data='.length).replace(/\+/g, ' '));
		return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
	} catch {
		return null;
	}
};

const asObject = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

/**
 * The path alone tells the transport apart: RudderStack owns `/v1/*`, the
 * PostHog SDKs own `/e/` and `/batch/`.
 */
const transportOf = (path: string): Transport => (pathname(path).startsWith('/v1/') ? 'rudder' : 'posthog');

const originOf = (item: Record<string, unknown>, record: RawRecord): Origin => {
	const props = asObject(item.properties) ?? {};
	const lib = props.$lib;
	if (lib === 'posthog-node' || props.$is_server === true) return 'backend';
	if (lib === 'web') return 'frontend';

	const context = asObject(item.context);
	const library = context ? asObject(context.library) : null;
	if (library && typeof library.name === 'string' && library.name.includes('JavaScript')) return 'frontend';

	// A RudderStack backend call carries no library block at all.
	return pathname(record.path) === '/v1/batch' ? 'backend' : 'unknown';
};

const timestampOf = (item: Record<string, unknown>, record: RawRecord): string => {
	for (const key of ['timestamp', 'originalTimestamp', 'sentAt']) {
		const value = item[key];
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return record.ts;
};

/**
 * One raw HTTP request becomes zero or more logical events. Nothing is ever
 * dropped: a body this function cannot read still produces an `<unparsed>`
 * row, so a broken payload is visible instead of silent.
 */
export const normalize = (record: RawRecord): LogicalEvent[] => {
	const route = pathname(record.path);
	if (NO_EVENT.some((pattern) => pattern.test(route))) return [];

	let body: unknown = record.body;
	if (typeof body === 'string') {
		const decoded = decodeFormBase64(body);
		if (decoded !== null) {
			body = decoded;
		} else {
			try {
				body = JSON.parse(body);
			} catch {
				return [unparsed(record, body)];
			}
		}
	}

	const container = asObject(body);
	if (container === null) return Array.isArray(body) ? fromItems(body, record) : [];

	const batch = container.batch;
	return fromItems(Array.isArray(batch) ? batch : [container], record);
};

const unparsed = (record: RawRecord, raw: unknown): LogicalEvent => ({
	id: nextId(),
	name: '<unparsed>',
	ts: record.ts,
	transports: [transportOf(record.path)],
	origin: 'unknown',
	properties: { raw },
	raw: record,
});

const fromItems = (items: unknown[], record: RawRecord): LogicalEvent[] => {
	const route = pathname(record.path);
	const fallbackName = NAMED_PATHS[route];
	const events: LogicalEvent[] = [];

	items.forEach((entry) => {
		const item = asObject(entry);
		if (item === null) return;

		const name = typeof item.event === 'string' && item.event.length > 0 ? item.event : fallbackName;
		if (name === undefined) return;

		events.push({
			id: nextId(),
			name,
			ts: timestampOf(item, record),
			transports: [transportOf(record.path)],
			origin: originOf(item, record),
			properties: asObject(item.properties) ?? {},
			raw: record,
		});
	});

	return events;
};
