import { Box, Text } from 'ink';
import { envBlock } from '../env.js';

export interface SetupPanelProps {
	port: number;
	log: string;
}

/**
 * The same block the empty state shows, reachable at any time with `s`.
 *
 * Without this the instructions disappear the moment the first event lands,
 * which is exactly when a person wants to check them for a second instance.
 */
export const SetupPanel = ({ port, log }: SetupPanelProps) => (
	<Box flexDirection="column">
		<Text bold>Point an n8n at this capture</Text>
		<Text dimColor>Paste this into the shell that runs n8n, then restart the n8n backend:</Text>
		<Text> </Text>
		<Text color="green">{envBlock(port).trimEnd()}</Text>
		<Text> </Text>
		<Text dimColor>Raw log, one JSON line per request, for grep and jq and for agents:</Text>
		<Text color="cyan">{log}</Text>
		<Text> </Text>
		<Text dimColor>Press any key to go back.</Text>
	</Box>
);
