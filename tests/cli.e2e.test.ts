import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const tmpLog = () => join(mkdtempSync(join(tmpdir(), 'ti-e2e-')), 'events.jsonl');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the capture server to answer, rather than sleeping a guessed
 * amount. A fixed sleep makes this test flaky on a busy machine.
 */
const waitForPort = async (port: number, attempts = 60): Promise<void> => {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`);
			if (res.ok) return;
		} catch {
			// Not up yet.
		}
		await wait(100);
	}
	throw new Error(`the capture server never answered on port ${port}`);
};

describe('the binary', () => {
	it('is built', () => {
		expect(existsSync(cli)).toBe(true);
	});

	it('prints the environment block and exits', () => {
		const out = execFileSync('node', [cli, '--env', '--port', '19081'], { encoding: 'utf8' });
		expect(out).toContain('N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
	});

	it('prints the usage for --help', () => {
		const out = execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
		expect(out).toContain('--headless');
	});

	it('captures a posted event to the log file in headless mode', async () => {
		const log = tmpLog();
		const port = 19311;
		const child = spawn('node', [cli, '--headless', '--port', String(port), '--log', log], { stdio: 'ignore' });
		try {
			await waitForPort(port);
			await fetch(`http://127.0.0.1:${port}/v1/track`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ event: 'E2E event', properties: { ok: true } }),
			});
			await wait(150);
			const lines = readFileSync(log, 'utf8').trim().split('\n');
			expect(JSON.parse(lines[0]).body.event).toBe('E2E event');
		} finally {
			child.kill();
		}
	});

	it('attaches to a running capture instead of failing on the port', async () => {
		const log = tmpLog();
		const port = 19312;
		const owner = spawn('node', [cli, '--headless', '--port', String(port), '--log', log], { stdio: 'ignore' });
		try {
			await waitForPort(port);
			const out = execFileSync('node', [cli, '--print-log-path', '--port', String(port)], { encoding: 'utf8' });
			// The second process learned the owner's log path over /health.
			expect(out.trim()).toBe(log);
		} finally {
			owner.kill();
		}
	});

	it('refuses a port held by another program', async () => {
		const { createServer } = await import('node:http');
		const other = createServer((_req, res) => res.end('not me'));
		await new Promise<void>((resolve) => other.listen(19313, '127.0.0.1', resolve));
		try {
			execFileSync('node', [cli, '--port', '19313', '--print-log-path'], { encoding: 'utf8', stdio: 'pipe' });
			throw new Error('the command should have failed');
		} catch (error) {
			expect(String((error as { stderr?: Buffer }).stderr ?? '')).toContain('taken by another program');
		} finally {
			other.close();
		}
	});
});
