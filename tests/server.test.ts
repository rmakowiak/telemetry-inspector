import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { LogWriter } from '../src/logfile.js';
import { probeHealth, startServer } from '../src/server.js';
import type { CaptureServer } from '../src/server.js';

const started: CaptureServer[] = [];

const startOnFreePort = async () => {
	const d = mkdtempSync(join(tmpdir(), 'ti-srv-'));
	const log = new LogWriter(join(d, 'events.jsonl'));
	log.truncate();
	const server = await startServer({ port: 0, log, cacheDir: d });
	started.push(server);
	return { server, log };
};

afterEach(async () => {
	while (started.length > 0) await started.pop()?.close();
});

describe('the capture server', () => {
	it('records a posted event and answers 200', async () => {
		const { server, log } = await startOnFreePort();
		const res = await fetch(`http://127.0.0.1:${server.port}/v1/track`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ event: 'A', properties: {} }),
		});
		expect(res.status).toBe(200);
		expect(log.readAll()).toHaveLength(1);
		expect(log.readAll()[0].body).toMatchObject({ event: 'A' });
	});

	it('decodes a gzip body announced by the header', async () => {
		const { server, log } = await startOnFreePort();
		await fetch(`http://127.0.0.1:${server.port}/v1/batch`, {
			method: 'POST',
			headers: { 'content-encoding': 'gzip', 'content-type': 'application/json' },
			body: gzipSync(Buffer.from(JSON.stringify({ batch: [{ event: 'G' }] }))),
		});
		expect(log.readAll()[0].body).toMatchObject({ batch: [{ event: 'G' }] });
	});

	it('decodes a gzip body that announces nothing, as posthog-js sends it', async () => {
		const { server, log } = await startOnFreePort();
		await fetch(`http://127.0.0.1:${server.port}/e/?compression=gzip-js`, {
			method: 'POST',
			body: gzipSync(Buffer.from(JSON.stringify({ batch: [{ event: 'Sniffed' }] }))),
		});
		expect(log.readAll()[0].body).toMatchObject({ batch: [{ event: 'Sniffed' }] });
	});

	it('answers a flag poll with empty flags', async () => {
		const { server } = await startOnFreePort();
		const res = await fetch(`http://127.0.0.1:${server.port}/flags/?v=2`, { method: 'POST', body: '{}' });
		expect(await res.json()).toMatchObject({ featureFlags: {} });
	});

	it('answers the remote config with JavaScript', async () => {
		const { server } = await startOnFreePort();
		const res = await fetch(`http://127.0.0.1:${server.port}/array/stub/config.js`);
		expect(res.headers.get('content-type')).toContain('javascript');
		expect(await res.text()).toContain('_POSTHOG_REMOTE_CONFIG');
	});

	it('answers a browser preflight so the frontend is never blocked', async () => {
		const { server } = await startOnFreePort();
		const res = await fetch(`http://127.0.0.1:${server.port}/e/`, { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('answers health with the log path', async () => {
		const { server, log } = await startOnFreePort();
		const health = await probeHealth(server.port);
		expect(health?.tool).toBe('telemetry-inspector');
		expect(health?.log).toBe(log.path);
	});

	it('returns null from probeHealth when nothing listens', async () => {
		expect(await probeHealth(1)).toBeNull();
	});

	it('tells subscribers about each record', async () => {
		const { server } = await startOnFreePort();
		const seen: string[] = [];
		server.onRecord((r) => seen.push(r.path));
		await fetch(`http://127.0.0.1:${server.port}/v1/track`, { method: 'POST', body: '{"event":"A"}' });
		expect(seen).toEqual(['/v1/track']);
	});

	it('does not record its own health check', async () => {
		const { server, log } = await startOnFreePort();
		await probeHealth(server.port);
		expect(log.readAll()).toHaveLength(0);
	});

	it('rejects with EADDRINUSE when the port is taken', async () => {
		const { server } = await startOnFreePort();
		const d = mkdtempSync(join(tmpdir(), 'ti-srv2-'));
		const log2 = new LogWriter(join(d, 'events.jsonl'));
		await expect(startServer({ port: server.port, log: log2, cacheDir: d })).rejects.toMatchObject({
			code: 'EADDRINUSE',
		});
	});
});
