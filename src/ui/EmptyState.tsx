import { Box, Text } from 'ink';
import { envBlock } from '../env.js';

/**
 * The empty state carries the setup. A first run therefore needs no
 * documentation: the block on screen is the block to paste.
 */
export const EmptyState = ({ port }: { port: number }) => (
	<Box flexDirection="column">
		<Text bold>No events yet.</Text>
		<Text dimColor>Paste this into the shell that runs n8n, then restart the backend:</Text>
		<Text> </Text>
		<Text color="green">{envBlock(port).trimEnd()}</Text>
		<Text> </Text>
		<Text dimColor>Events appear here the moment n8n sends one. Press s to see this again later.</Text>
	</Box>
);
