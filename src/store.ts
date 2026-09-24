import { Deduper, cleanProperties } from './dedupe.js';
import { normalize } from './normalize.js';
import type { LogicalEvent, RawRecord } from './types.js';

export const DEFAULT_MAX_EVENTS = 2000;

export interface VisibleOptions {
	filter: string;
	showLifecycle: boolean;
}

/**
 * The rows the interface renders. Both roles feed it: the owner from its own
 * HTTP server, a viewer from the lines it reads out of the log file.
 *
 * The store is capped, so a session that runs for hours never grows without
 * limit. The log file keeps everything.
 */
export class EventStore {
	private rows: LogicalEvent[] = [];
	private deduper = new Deduper();
	private listeners = new Set<() => void>();
	/** Rises on every change, so a React component can compare one number. */
	version = 0;

	constructor(private max: number = DEFAULT_MAX_EVENTS) {}

	add(record: RawRecord): void {
		let changed = false;

		for (const event of normalize(record)) {
			const result = this.deduper.push(event);
			// On a merge the deduper already added the transport to the row that
			// is in this list, so only a new row needs appending.
			if (result.kind === 'new') this.rows.push(result.event);
			changed = true;
		}

		if (!changed) return;
		if (this.rows.length > this.max) this.rows = this.rows.slice(this.rows.length - this.max);
		this.emit();
	}

	events(): LogicalEvent[] {
		return this.rows;
	}

	get count(): number {
		return this.rows.length;
	}

	/** The rows the list shows, after the lifecycle rule and the filter. */
	visible({ filter, showLifecycle }: VisibleOptions): LogicalEvent[] {
		const needle = filter.trim().toLowerCase();
		return this.rows.filter((event) => {
			if (!showLifecycle && event.name.startsWith('$')) return false;
			if (needle === '') return true;
			if (event.name.toLowerCase().includes(needle)) return true;
			return JSON.stringify(cleanProperties(event.properties)).toLowerCase().includes(needle);
		});
	}

	clear(): void {
		this.rows = [];
		this.deduper = new Deduper();
		this.emit();
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		this.version++;
		for (const fn of this.listeners) fn();
	}
}
