import { render } from 'ink';
import { DEFAULT_PORT, parseArgs } from './args.js';
import { envBlock } from './env.js';
import { LogWriter, tailFile } from './logfile.js';
import { cacheDir } from './paths.js';
import { probeHealth, startServer } from './server.js';
import { EventStore } from './store.js';
import type { CaptureServer } from './server.js';
import type { Role } from './types.js';
import { App } from './ui/App.js';

const USAGE = `telemetry-inspector - watch the PostHog events your local n8n sends.

Usage: telemetry-inspector [options]

  --port <n>         capture port (default ${DEFAULT_PORT})
  --log <path>       log file (default ~/.cache/telemetry-inspector/events-<port>.jsonl)
  --headless         capture with no interface, for agents and CI
  --env              print the n8n environment block and exit
  --print-log-path   print the log file path and exit
  --help             print this text

Start it, paste the block it shows into the shell that runs n8n, restart the
n8n backend, and events appear as they are sent.

A second run on the same port opens a second view of the same capture.
`;

const fail = (message: string): never => {
	process.stderr.write(`${message}\n`);
	process.exit(1);
};

const main = async (): Promise<void> => {
	let options;
	try {
		options = parseArgs(process.argv.slice(2), process.env, Boolean(process.stdout.isTTY));
	} catch (error) {
		return fail(`${(error as Error).message}\nRun with --help for the options.`);
	}

	if (options.help) {
		process.stdout.write(USAGE);
		return;
	}

	if (options.printEnv) {
		process.stdout.write(envBlock(options.port));
		return;
	}

	let role: Role = 'owner';
	let logPath = options.log;
	let server: CaptureServer | null = null;

	try {
		const log = new LogWriter(options.log);
		log.truncate();
		server = await startServer({ port: options.port, log, cacheDir: cacheDir() });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
			return fail(`Could not start on port ${options.port}: ${(error as Error).message}`);
		}

		// Somebody is on the port. When it is this tool, watch its capture
		// instead of competing with it.
		const health = await probeHealth(options.port);
		if (health === null) {
			return fail(
				`Port ${options.port} is taken by another program.\n` +
					`Pass --port <n> to use a different one.`,
			);
		}
		role = 'viewer';
		logPath = health.log;
	}

	if (options.printLogPath) {
		process.stdout.write(`${logPath}\n`);
		await server?.close();
		return;
	}

	const store = new EventStore();
	let stopTail: (() => void) | null = null;

	if (server !== null) {
		server.onRecord((record) => store.add(record));
	} else {
		stopTail = tailFile(logPath, (record) => store.add(record));
	}

	if (options.headless) {
		process.stdout.write(`${logPath}\n`);
		process.stdout.write(
			role === 'owner'
				? `telemetry-inspector is capturing on port ${options.port}. Press control-c to stop.\n`
				: `telemetry-inspector is watching the capture on port ${options.port}.\n`,
		);
		process.stdout.write(`Run with --env to print the block that points n8n at port ${options.port}.\n`);
		const stop = async (): Promise<void> => {
			stopTail?.();
			await server?.close();
			process.exit(0);
		};
		process.on('SIGINT', stop);
		process.on('SIGTERM', stop);
		return;
	}

	const ownerLog = server === null ? null : new LogWriter(logPath);

	const instance = render(
		<App
			store={store}
			port={server?.port ?? options.port}
			role={role}
			warning={server?.warning ?? null}
			log={logPath}
			onClear={() => ownerLog?.clear()}
			onQuit={() => {
				stopTail?.();
				void server?.close();
			}}
		/>,
	);

	await instance.waitUntilExit();
	stopTail?.();
	await server?.close();
};

main().catch((error: unknown) => fail(String(error)));
