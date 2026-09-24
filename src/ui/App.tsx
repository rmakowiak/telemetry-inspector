import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { copyToClipboard } from '../clipboard.js';
import type { EventStore } from '../store.js';
import type { LogicalEvent, Role } from '../types.js';
import { DetailPane } from './DetailPane.js';
import { EmptyState } from './EmptyState.js';
import { EventList } from './EventList.js';
import { SetupPanel } from './SetupPanel.js';
import { StatusBar } from './StatusBar.js';

/** Below this the two panes get too narrow to read, so the layout collapses. */
const WIDE_ENOUGH = 100;

const KEYS = [
	'j / k or arrows   move the selection',
	'g / G             first and last event',
	'f                 filter, escape clears it',
	'p                 pause the view, capture keeps running',
	'c                 empty the list and the log file',
	'y                 copy the selected event as JSON',
	'tab               show the raw request',
	'.                 show or hide the $ lifecycle events',
	's                 the environment block that points n8n at this capture',
	'?                 close this help',
	'q                 quit',
];

export interface AppProps {
	store: EventStore;
	port: number;
	role: Role;
	warning: string | null;
	columns?: number;
	rows?: number;
	/** The raw log path, shown in the setup panel. */
	log?: string;
	onClear?: () => void;
	onQuit?: () => void;
}

export const App = ({ store, port, role, warning, columns, rows, log, onClear, onQuit }: AppProps) => {
	const { exit } = useApp();
	const [version, setVersion] = useState(store.version);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [follow, setFollow] = useState(true);
	const [paused, setPaused] = useState(false);
	const [filter, setFilter] = useState('');
	const [filtering, setFiltering] = useState(false);
	const [showLifecycle, setShowLifecycle] = useState(false);
	const [raw, setRaw] = useState(false);
	const [help, setHelp] = useState(false);
	const [setup, setSetup] = useState(false);

	const width = columns ?? process.stdout.columns ?? 100;
	const height = rows ?? process.stdout.rows ?? 24;
	const wide = width >= WIDE_ENOUGH;

	useEffect(() => {
		// While paused the store keeps filling, the view simply stops reading it.
		if (paused) return;
		setVersion(store.version);
		return store.subscribe(() => setVersion(store.version));
	}, [store, paused]);

	const events = useMemo(
		() => store.visible({ filter, showLifecycle }),
		// `version` is the dependency that matters: it changes on every store edit.
		[store, filter, showLifecycle, version],
	);

	const selectedIndex = useMemo(() => {
		if (follow || selectedId === null) return Math.max(0, events.length - 1);
		const found = events.findIndex((event) => event.id === selectedId);
		return found === -1 ? Math.max(0, events.length - 1) : found;
	}, [events, follow, selectedId]);

	const selected: LogicalEvent | null = events[selectedIndex] ?? null;

	const move = (delta: number): void => {
		if (events.length === 0) return;
		const next = Math.min(events.length - 1, Math.max(0, selectedIndex + delta));
		setSelectedId(events[next]?.id ?? null);
		setFollow(next === events.length - 1);
	};

	useInput((input, key) => {
		if (filtering) {
			if (key.escape) {
				setFilter('');
				setFiltering(false);
			} else if (key.return) {
				setFiltering(false);
			} else if (key.backspace || key.delete) {
				setFilter((current) => current.slice(0, -1));
			} else if (input !== '' && !key.ctrl && !key.meta) {
				setFilter((current) => current + input);
			}
			return;
		}

		if (help) {
			setHelp(false);
			return;
		}

		if (setup) {
			setSetup(false);
			return;
		}

		if (input === 'q' || (key.ctrl && input === 'c')) {
			onQuit?.();
			exit();
			return;
		}
		if (input === 'j' || key.downArrow) move(1);
		else if (input === 'k' || key.upArrow) move(-1);
		else if (input === 'g') {
			setSelectedId(events[0]?.id ?? null);
			setFollow(events.length <= 1);
		} else if (input === 'G') setFollow(true);
		else if (input === 'f') setFiltering(true);
		else if (input === 'p') setPaused((current) => !current);
		else if (input === 'c') {
			store.clear();
			onClear?.();
			setSelectedId(null);
			setFollow(true);
		} else if (input === 'y' && selected !== null) copyToClipboard(JSON.stringify(selected.raw, null, 2));
		else if (key.tab) setRaw((current) => !current);
		else if (input === '.') setShowLifecycle((current) => !current);
		else if (input === 's') setSetup(true);
		else if (input === '?') setHelp(true);
	});

	const footer = filtering
		? `filter: ${filter}█  (enter keeps it, escape clears it)`
		: `[f]ilter${filter === '' ? '' : ` "${filter}"`}  [p]ause  [c]lear  [y]ank  [tab] raw  [.] ${showLifecycle ? 'hide' : 'show'} $  [s]etup  [?] keys  [q]uit`;

	if (help) {
		return (
			<Box flexDirection="column">
				<StatusBar count={store.count} paused={paused} port={port} role={role} warning={warning} />
				<Text> </Text>
				{KEYS.map((line) => (
					<Text key={line}>{line}</Text>
				))}
				<Text> </Text>
				<Text dimColor>Press any key to go back.</Text>
			</Box>
		);
	}

	if (setup) {
		return (
			<Box flexDirection="column">
				<StatusBar count={store.count} paused={paused} port={port} role={role} warning={warning} />
				<Text> </Text>
				<SetupPanel port={port} log={log ?? '(unknown)'} />
			</Box>
		);
	}

	if (store.count === 0) {
		return (
			<Box flexDirection="column">
				<StatusBar count={0} paused={paused} port={port} role={role} warning={warning} />
				<Text> </Text>
				<EmptyState port={port} />
			</Box>
		);
	}

	// Three lines of chrome: the status bar, the blank line and the footer.
	// In one column the detail pane sits under the list, so they share the room.
	const body = Math.max(6, height - 4);
	const listHeight = wide ? body : Math.max(3, Math.floor(body / 2));
	const listWidth = Math.max(40, Math.floor(width * 0.56));
	// One column for the divider that the detail pane draws as its left border.
	const detailWidth = Math.max(20, width - listWidth - 1);

	return (
		<Box flexDirection="column">
			<StatusBar count={store.count} paused={paused} port={port} role={role} warning={warning} />
			{wide ? (
				<Box width={width}>
					<Box width={listWidth} flexDirection="column" flexShrink={0}>
						<EventList
							events={events}
							selectedIndex={selectedIndex}
							width={listWidth}
							height={listHeight}
						/>
					</Box>
					<Box
						flexDirection="column"
						width={detailWidth}
						flexShrink={0}
						paddingLeft={1}
						borderStyle="single"
						borderColor="gray"
						borderTop={false}
						borderRight={false}
						borderBottom={false}
					>
						<DetailPane event={selected} raw={raw} width={detailWidth - 2} />
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					<EventList events={events} selectedIndex={selectedIndex} width={width} height={listHeight} />
					<Text> </Text>
					<DetailPane event={selected} raw={raw} width={width} />
				</Box>
			)}
			<Text dimColor>{footer}</Text>
		</Box>
	);
};
