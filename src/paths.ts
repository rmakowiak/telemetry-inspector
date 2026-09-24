import { homedir } from 'node:os';
import { join } from 'node:path';

export const cacheDir = (): string => join(homedir(), '.cache', 'telemetry-inspector');

export const defaultLogPath = (port: number): string => join(cacheDir(), `events-${port}.jsonl`);
