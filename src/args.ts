import { defaultLogPath } from './paths.js';
import type { Options } from './types.js';

export const DEFAULT_PORT = 19081;

const needsValue = (argv: string[], i: number, flag: string): string => {
	const value = argv[i + 1];
	if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`);
	return value;
};

/**
 * `isTTY` decides the default interface: with no terminal there is nobody to
 * render for, so the process captures headlessly.
 */
export const parseArgs = (argv: string[], _env: NodeJS.ProcessEnv, isTTY: boolean): Options => {
	let port = DEFAULT_PORT;
	let log: string | null = null;
	let headless = !isTTY;
	let printEnv = false;
	let printLogPath = false;
	let help = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--port':
			case '-p': {
				const value = needsValue(argv, i, '--port');
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
					throw new Error(`--port needs a whole number from 0 to 65535, not "${value}"`);
				}
				port = parsed;
				i++;
				break;
			}
			case '--log':
			case '-l':
				log = needsValue(argv, i, '--log');
				i++;
				break;
			case '--headless':
				headless = true;
				break;
			case '--env':
				printEnv = true;
				break;
			case '--print-log-path':
				printLogPath = true;
				break;
			case '--help':
			case '-h':
				help = true;
				break;
			default:
				throw new Error(`Unknown flag: ${arg}`);
		}
	}

	return { port, log: log ?? defaultLogPath(port), headless, printEnv, printLogPath, help };
};
