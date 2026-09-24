import { Box, Text } from 'ink';
import type { Role } from '../types.js';

export interface StatusBarProps {
	count: number;
	paused: boolean;
	port: number;
	role: Role;
	warning: string | null;
}

export const StatusBar = ({ count, paused, port, role, warning }: StatusBarProps) => (
	<Box flexDirection="column">
		<Box>
			<Text bold color="cyan">
				telemetry-inspector{' '}
			</Text>
			<Text color={paused ? 'yellow' : 'green'}>{paused ? 'PAUSED' : 'REC'}</Text>
			<Text dimColor>
				{'  '}
				{count} {count === 1 ? 'event' : 'events'}
				{'  :'}
				{port}
				{role === 'viewer' ? '  viewer' : ''}
			</Text>
		</Box>
		{warning === null ? null : <Text color="yellow">warning: {warning}</Text>}
	</Box>
);
