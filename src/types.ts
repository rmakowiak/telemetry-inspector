/** Which SDK sent this copy of the event. */
export type Transport = 'rudder' | 'posthog';

/** Which side of n8n fired it. */
export type Origin = 'frontend' | 'backend' | 'unknown';

/** One HTTP request, exactly as it arrived. This is what the log file holds. */
export interface RawRecord {
	ts: string;
	method: string;
	path: string;
	body: unknown;
}

/**
 * One event as a person thinks of it. Both transport copies of the same event
 * collapse into one of these, with both tags in `transports`.
 */
export interface LogicalEvent {
	id: string;
	name: string;
	ts: string;
	transports: Transport[];
	origin: Origin;
	properties: Record<string, unknown>;
	raw: RawRecord;
}

export interface Options {
	port: number;
	log: string;
	headless: boolean;
	printEnv: boolean;
	printLogPath: boolean;
	help: boolean;
}

/** Which role this process took: it owns the capture, or it watches another one. */
export type Role = 'owner' | 'viewer';
