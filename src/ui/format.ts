import { cleanProperties } from '../dedupe.js';
import type { LogicalEvent } from '../types.js';

/** Local time of day. The date is never useful in a live session. */
export const formatTime = (iso: string): string => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '--:--:--';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const truncate = (text: string, width: number): string => {
	if (width <= 0) return '';
	if (text.length <= width) return text;
	if (width === 1) return '.';
	return `${text.slice(0, width - 1)}…`;
};

const short = (value: unknown): string => {
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return String(value);
	if (typeof value === 'object') return Array.isArray(value) ? `[${value.length}]` : '{…}';
	return String(value);
};

/** The `key=value` tail of a list row, cut to fit the space it is given. */
export const summarize = (event: LogicalEvent, width: number): string => {
	if (width <= 0) return '';
	const parts: string[] = [];
	for (const [key, value] of Object.entries(cleanProperties(event.properties))) {
		parts.push(`${key}=${short(value)}`);
		if (parts.join(' ').length > width) break;
	}
	return truncate(parts.join(' '), width);
};

/** A readable multi-line view of the properties, for the detail pane. */
export const formatProperties = (properties: Record<string, unknown>): string =>
	Object.keys(properties).length === 0 ? '(no properties)' : JSON.stringify(properties, null, 2);
