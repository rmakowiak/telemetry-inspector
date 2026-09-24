import { Box, Text } from 'ink';
import type { LogicalEvent } from '../types.js';
import { formatTime, summarize, truncate } from './format.js';

export interface EventListProps {
	events: LogicalEvent[];
	selectedIndex: number;
	width: number;
	height: number;
}

/** Keeps the selected row on screen without the view jumping around it. */
const windowOf = (total: number, selected: number, height: number): [number, number] => {
	if (total <= height) return [0, total];
	let start = selected - Math.floor(height / 2);
	start = Math.max(0, Math.min(start, total - height));
	return [start, start + height];
};

export const EventList = ({ events, selectedIndex, width, height }: EventListProps) => {
	if (events.length === 0) {
		return <Text dimColor>Nothing matches the filter.</Text>;
	}

	const [start, end] = windowOf(events.length, selectedIndex, Math.max(1, height));
	// Two characters for the marker and the space, then the time and a space.
	const rest = Math.max(10, width - 11);
	const nameWidth = Math.max(10, Math.min(38, Math.floor(rest * 0.6)));
	const propsWidth = Math.max(0, rest - nameWidth - 1);

	return (
		<Box flexDirection="column" width={width} flexShrink={0}>
			{events.slice(start, end).map((event, offset) => {
				const index = start + offset;
				const selected = index === selectedIndex;
				const onlyOneTransport = event.transports.length < 2;
				return (
					// One row is one line. Truncating rather than wrapping keeps the
					// row count on screen equal to the row count in the list.
					<Text key={event.id} wrap="truncate">
						<Text color="cyan">{selected ? '>' : ' '}</Text>
						<Text dimColor>{formatTime(event.ts)}</Text>
						{' '}
						<Text bold={selected} color={onlyOneTransport ? 'yellow' : undefined}>
							{truncate(event.name, nameWidth).padEnd(nameWidth)}
						</Text>
						{' '}
						<Text dimColor>{summarize(event, propsWidth)}</Text>
					</Text>
				);
			})}
		</Box>
	);
};
