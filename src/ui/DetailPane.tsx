import { Box, Text } from 'ink';
import { cleanProperties } from '../dedupe.js';
import type { LogicalEvent } from '../types.js';
import { formatProperties, formatTime } from './format.js';

export interface DetailPaneProps {
	event: LogicalEvent | null;
	raw: boolean;
	width: number;
}

export const DetailPane = ({ event, raw, width }: DetailPaneProps) => {
	if (event === null) {
		return <Text dimColor>Nothing selected.</Text>;
	}

	if (raw) {
		return (
			<Box flexDirection="column" width={width}>
				<Text bold>{event.name}</Text>
				<Text dimColor>raw request</Text>
				<Text>{JSON.stringify(event.raw, null, 2)}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width}>
			<Text bold color="cyan">
				{event.name}
			</Text>
			<Text dimColor>
				ts {formatTime(event.ts)}
				{'  '}
				{event.origin}
			</Text>
			<Text dimColor>via {event.transports.join(' + ')}</Text>
			<Text> </Text>
			<Text>{formatProperties(cleanProperties(event.properties))}</Text>
		</Box>
	);
};
