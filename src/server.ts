import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync, inflateSync } from 'node:zlib';
import type { LogWriter } from './logfile.js';
import { flagsResponse, loadArrayJs, remoteConfigJs, remoteConfigJson } from './posthog-assets.js';
import type { RawRecord } from './types.js';

export const TOOL_NAME = 'telemetry-inspector';

export interface HealthAnswer {
	tool: string;
	pid: number;
	port: number;
	log: string;
}

export interface CaptureServer {
	port: number;
	/** Set when the posthog-js bundle could not be loaded, which breaks frontend capture. */
	warning: string | null;
	onRecord(fn: (record: RawRecord) => void): void;
	close(): Promise<void>;
}

export interface StartOptions {
	port: number;
	log: LogWriter;
	cacheDir: string;
	fetchImpl?: typeof fetch;
}

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET,POST,OPTIONS',
	'access-control-allow-headers': '*',
};

const pathname = (url: string): string => url.split('?')[0] ?? url;

/**
 * Decodes a request body.
 *
 * The `content-encoding` header is checked first, then the first two bytes are
 * sniffed for the gzip magic number. The sniff is not optional: posthog-js
 * compresses with `?compression=gzip-js` and sets no `content-encoding`, so a
 * header-only check silently stores compressed bytes as text. A real capture
 * lost 20 events that way.
 */
const decodeBody = (buffer: Buffer, encoding: string | undefined): Buffer => {
	try {
		if (encoding === 'gzip') return gunzipSync(buffer);
		if (encoding === 'deflate') return inflateSync(buffer);
		if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer);
	} catch {
		// Fall through and keep the bytes as they arrived.
	}
	return buffer;
};

const readBody = (req: IncomingMessage): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});

export const startServer = async ({ port, log, cacheDir, fetchImpl }: StartOptions): Promise<CaptureServer> => {
	const listeners = new Set<(record: RawRecord) => void>();
	let warning: string | null = null;

	const send = (res: ServerResponse, status: number, type: string, body: string): void => {
		res.writeHead(status, { 'content-type': type, ...CORS });
		res.end(body);
	};

	const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const url = req.url ?? '/';
		const route = pathname(url);

		if (req.method === 'OPTIONS') {
			res.writeHead(204, CORS);
			res.end();
			return;
		}

		if (route === '/health') {
			const answer: HealthAnswer = { tool: TOOL_NAME, pid: process.pid, port: actualPort, log: log.path };
			send(res, 200, 'application/json', JSON.stringify(answer));
			return;
		}

		// The frontend loads the posthog-js library from the configured host.
		// Anything but the real library makes capture() a silent no-op.
		if (route.startsWith('/static/')) {
			const asset = await loadArrayJs(cacheDir, fetchImpl);
			if (asset.stale) warning = 'posthog-js bundle unavailable, frontend events will not be captured';
			send(res, 200, 'application/javascript; charset=utf-8', asset.body);
			return;
		}

		if (route.startsWith('/array/')) {
			if (route.endsWith('.js')) {
				send(res, 200, 'application/javascript; charset=utf-8', remoteConfigJs());
			} else {
				send(res, 200, 'application/json', JSON.stringify(remoteConfigJson()));
			}
			return;
		}

		if (route.startsWith('/flags') || route.startsWith('/decide')) {
			// The body is drained so the client is never left waiting.
			await readBody(req);
			send(res, 200, 'application/json', JSON.stringify(flagsResponse()));
			return;
		}

		const raw = decodeBody(await readBody(req), req.headers['content-encoding']).toString('utf8');
		let body: unknown = raw;
		if (raw !== '') {
			try {
				body = JSON.parse(raw);
			} catch {
				// Not JSON. The raw string is kept, and normalize turns it into an
				// <unparsed> row rather than dropping the request.
			}
		}

		const record: RawRecord = { ts: new Date().toISOString(), method: req.method ?? 'GET', path: url, body };
		log.append(record);
		for (const fn of listeners) fn(record);

		send(res, 200, 'application/json', '{"status":1}');
	};

	const server: Server = createServer((req, res) => {
		handle(req, res).catch(() => {
			if (!res.headersSent) send(res, 500, 'application/json', '{"status":0}');
			else res.end();
		});
	});

	let actualPort = port;

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			const address = server.address();
			if (address !== null && typeof address === 'object') actualPort = address.port;
			server.removeListener('error', reject);
			resolve();
		});
	});

	return {
		get port() {
			return actualPort;
		},
		get warning() {
			return warning;
		},
		onRecord(fn) {
			listeners.add(fn);
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			}),
	};
};

/**
 * Asks a port whether this tool is listening there. Returns null when nothing
 * answers or when the answer comes from some other program.
 */
export const probeHealth = async (port: number, timeoutMs = 700): Promise<HealthAnswer | null> => {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) return null;
		const answer = (await response.json()) as HealthAnswer;
		return answer.tool === TOOL_NAME ? answer : null;
	} catch {
		return null;
	}
};
