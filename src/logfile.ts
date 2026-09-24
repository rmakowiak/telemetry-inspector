import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { RawRecord } from './types.js';

/** How often a viewer looks for new lines. Invisible to a person, cheap for the disk. */
const POLL_MS = 200;

/**
 * The raw log. One JSON line per HTTP request, nothing stripped and nothing
 * merged. This file is the interface for agents, so its shape is a promise:
 * `{ ts, method, path, body }`.
 */
export class LogWriter {
	constructor(readonly path: string) {}

	/** Starts a fresh session. The owner calls this, a viewer never does. */
	truncate(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, '');
	}

	append(record: RawRecord): void {
		mkdirSync(dirname(this.path), { recursive: true });
		appendFileSync(this.path, `${JSON.stringify(record)}\n`);
	}

	/**
	 * Empties the log. The file is removed and remade rather than truncated in
	 * place, so its inode changes. A viewer watches the inode to notice, which
	 * a size check cannot do: a clear followed at once by a similar line leaves
	 * the size unchanged between two polls.
	 */
	clear(): void {
		rmSync(this.path, { force: true });
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, '');
	}

	readAll(): RawRecord[] {
		if (!existsSync(this.path)) return [];
		return parseLines(readFileSync(this.path, 'utf8'));
	}
}

const parseLines = (text: string): RawRecord[] => {
	const out: RawRecord[] = [];
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		try {
			out.push(JSON.parse(line) as RawRecord);
		} catch {
			// A half-written or corrupt line is skipped, never thrown.
		}
	}
	return out;
};

/**
 * Follows a log file: delivers what it already holds, then every line that is
 * appended after. Returns a function that stops following.
 *
 * A timer is used rather than `fs.watch`, because `fs.watch` misses appends on
 * some platforms and a 200 millisecond poll costs nothing.
 */
export const tailFile = (path: string, onRecord: (record: RawRecord) => void): (() => void) => {
	let offset = 0;
	let partial = '';
	let inode: number | null = null;
	let stopped = false;

	const read = (): void => {
		if (stopped || !existsSync(path)) return;

		const stat = statSync(path);
		const size = stat.size;
		// The owner emptied the log, so start again from the top.
		if (size < offset || (inode !== null && stat.ino !== inode)) {
			offset = 0;
			partial = '';
		}
		inode = stat.ino;
		if (size === offset) return;

		const fd = openSync(path, 'r');
		try {
			const buffer = Buffer.alloc(size - offset);
			const read = readSync(fd, buffer, 0, buffer.length, offset);
			offset += read;
			const chunk = partial + buffer.subarray(0, read).toString('utf8');
			const lines = chunk.split('\n');
			// The last piece may be half a line that is still being written.
			partial = lines.pop() ?? '';
			for (const record of parseLines(lines.join('\n'))) onRecord(record);
		} finally {
			closeSync(fd);
		}
	};

	read();
	const timer = setInterval(read, POLL_MS);
	timer.unref?.();

	return () => {
		stopped = true;
		clearInterval(timer);
	};
};
