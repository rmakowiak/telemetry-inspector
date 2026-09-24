import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

const env = {} as NodeJS.ProcessEnv;

describe('parseArgs', () => {
	it('defaults to port 19081 and a terminal interface', () => {
		const o = parseArgs([], env, true);
		expect(o.port).toBe(19081);
		expect(o.headless).toBe(false);
		expect(o.log).toMatch(/events-19081\.jsonl$/);
	});

	it('reads --port and moves the default log path with it', () => {
		const o = parseArgs(['--port', '20000'], env, true);
		expect(o.port).toBe(20000);
		expect(o.log).toMatch(/events-20000\.jsonl$/);
	});

	it('keeps an explicit --log path', () => {
		const o = parseArgs(['--log', '/tmp/x.jsonl'], env, true);
		expect(o.log).toBe('/tmp/x.jsonl');
	});

	it('turns on headless when stdout is not a terminal', () => {
		expect(parseArgs([], env, false).headless).toBe(true);
	});

	it('reads --headless, --env and --print-log-path', () => {
		expect(parseArgs(['--headless'], env, true).headless).toBe(true);
		expect(parseArgs(['--env'], env, true).printEnv).toBe(true);
		expect(parseArgs(['--print-log-path'], env, true).printLogPath).toBe(true);
	});

	it('rejects a port that is not a number', () => {
		expect(() => parseArgs(['--port', 'abc'], env, true)).toThrow(/--port/);
	});

	it('rejects an unknown flag', () => {
		expect(() => parseArgs(['--wat'], env, true)).toThrow(/--wat/);
	});
});
