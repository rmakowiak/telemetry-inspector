import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogWriter, tailFile } from '../src/logfile.js';
import type { RawRecord } from '../src/types.js';

const rec = (n: number): RawRecord => ({
	ts: new Date().toISOString(),
	method: 'POST',
	path: '/v1/track',
	body: { event: `E${n}` },
});
const tmp = () => join(mkdtempSync(join(tmpdir(), 'ti-')), 'nested', 'events.jsonl');

describe('LogWriter', () => {
	it('creates the directory and writes one line per record', () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));
		w.append(rec(2));
		expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(2);
	});

	it('reads its own lines back', () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));
		expect(w.readAll()[0].body).toEqual({ event: 'E1' });
	});

	it('skips a line that is not JSON instead of throwing', () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));
		appendFileSync(p, 'garbage\n');
		expect(w.readAll()).toHaveLength(1);
	});

	it('returns nothing when the file does not exist yet', () => {
		expect(new LogWriter(tmp()).readAll()).toEqual([]);
	});

	it('empties the file on clear', () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));
		w.clear();
		expect(readFileSync(p, 'utf8')).toBe('');
	});

	it('reports its own path', () => {
		const p = tmp();
		expect(new LogWriter(p).path).toBe(p);
	});
});

describe('tailFile', () => {
	it('delivers the lines already in the file and then the new ones', async () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));

		const seen: RawRecord[] = [];
		const stop = tailFile(p, (r) => seen.push(r));
		await new Promise((r) => setTimeout(r, 50));
		expect(seen).toHaveLength(1);

		w.append(rec(2));
		await new Promise((r) => setTimeout(r, 400));
		expect(seen).toHaveLength(2);
		stop();
	});

	it('starts again from the top when the file is emptied', async () => {
		const p = tmp();
		const w = new LogWriter(p);
		w.truncate();
		w.append(rec(1));

		const seen: RawRecord[] = [];
		const stop = tailFile(p, (r) => seen.push(r));
		await new Promise((r) => setTimeout(r, 50));

		w.clear();
		w.append(rec(9));
		await new Promise((r) => setTimeout(r, 400));
		expect(seen).toHaveLength(2);
		expect(seen[1].body).toEqual({ event: 'E9' });
		stop();
	});
});
