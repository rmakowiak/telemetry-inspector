import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { DetailPane } from '../src/ui/DetailPane.js';
import { EmptyState } from '../src/ui/EmptyState.js';
import { EventList } from '../src/ui/EventList.js';
import { SetupPanel } from '../src/ui/SetupPanel.js';
import { StatusBar } from '../src/ui/StatusBar.js';
import { formatTime, summarize } from '../src/ui/format.js';
import type { LogicalEvent } from '../src/types.js';

const event: LogicalEvent = {
	id: '1',
	name: 'Report opened',
	ts: '2026-09-24T09:14:07.221Z',
	transports: ['rudder', 'posthog'],
	origin: 'frontend',
	properties: { report_kind: 'summary', duration_ms: 1234, instance_id: 'i', $lib: 'web' },
	raw: {
		ts: '2026-09-24T09:14:07.221Z',
		method: 'POST',
		path: '/v1/track',
		body: { event: 'Report opened' },
	},
};

describe('format', () => {
	it('prints the local time of day', () => {
		expect(formatTime('2026-09-24T09:14:07.221Z')).toMatch(/^\d\d:\d\d:\d\d$/);
	});

	it('summarizes the properties without the boilerplate', () => {
		const s = summarize(event, 80);
		expect(s).toContain('report_kind=summary');
		expect(s).not.toContain('instance_id');
	});

	it('never exceeds the width it is given', () => {
		expect(summarize(event, 12).length).toBeLessThanOrEqual(12);
	});

	it('returns nothing when there is no room', () => {
		expect(summarize(event, 0)).toBe('');
	});
});

describe('EmptyState', () => {
	it('shows the setup block so a first run needs no documentation', () => {
		const { lastFrame } = render(<EmptyState port={19081} />);
		expect(lastFrame()).toContain('N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
		expect(lastFrame()).toContain('No events yet');
	});
});

describe('StatusBar', () => {
	it('shows the count, the port and the recording state', () => {
		const { lastFrame } = render(<StatusBar count={127} paused={false} port={19081} role="owner" warning={null} />);
		expect(lastFrame()).toContain('127');
		expect(lastFrame()).toContain('19081');
		expect(lastFrame()).toContain('REC');
	});

	it('shows PAUSED instead of REC when paused', () => {
		const { lastFrame } = render(<StatusBar count={1} paused port={19081} role="owner" warning={null} />);
		expect(lastFrame()).toContain('PAUSED');
	});

	it('names the viewer role, because a viewer cannot stop the capture', () => {
		const { lastFrame } = render(<StatusBar count={1} paused={false} port={19081} role="viewer" warning={null} />);
		expect(lastFrame()).toContain('viewer');
	});

	it('shows a warning when one is given', () => {
		const { lastFrame } = render(
			<StatusBar count={0} paused={false} port={19081} role="owner" warning="offline" />,
		);
		expect(lastFrame()).toContain('offline');
	});
});

describe('EventList', () => {
	it('marks the selected row', () => {
		const { lastFrame } = render(<EventList events={[event]} selectedIndex={0} width={60} height={5} />);
		expect(lastFrame()).toContain('Report opened');
		expect(lastFrame()).toContain('>');
	});

	it('shows only the rows that fit the height, around the selection', () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ ...event, id: String(i), name: `Event${i}` }));
		const { lastFrame } = render(<EventList events={many} selectedIndex={19} width={60} height={3} />);
		expect(lastFrame()).toContain('Event19');
		expect(lastFrame()).not.toContain('Event0 ');
	});

	it('says so when the filter matched nothing', () => {
		const { lastFrame } = render(<EventList events={[]} selectedIndex={0} width={60} height={5} />);
		expect(lastFrame()).toContain('Nothing matches');
	});
});

describe('DetailPane', () => {
	it('shows both transports and hides the boilerplate', () => {
		const { lastFrame } = render(<DetailPane event={event} raw={false} width={44} />);
		expect(lastFrame()).toContain('rudder + posthog');
		expect(lastFrame()).toContain('report_kind');
		expect(lastFrame()).not.toContain('instance_id');
	});

	it('shows the whole raw request in raw mode', () => {
		const { lastFrame } = render(<DetailPane event={event} raw width={44} />);
		expect(lastFrame()).toContain('/v1/track');
	});

	it('says so when nothing is selected', () => {
		const { lastFrame } = render(<DetailPane event={null} raw={false} width={44} />);
		expect(lastFrame()).toContain('Nothing selected');
	});
});

describe('SetupPanel', () => {
	it('shows the five exports for the port it is given', () => {
		const { lastFrame } = render(<SetupPanel port={19081} log="/tmp/events.jsonl" />);
		const frame = lastFrame() ?? '';
		expect(frame).toContain('export N8N_DIAGNOSTICS_ENABLED=true');
		expect(frame).toContain("export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'");
		expect(frame).toContain('export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
	});

	it('says what to do with the block', () => {
		const { lastFrame } = render(<SetupPanel port={19081} log="/tmp/events.jsonl" />);
		expect(lastFrame()).toContain('restart the n8n backend');
	});

	it('shows the log path, so an agent can be pointed at it', () => {
		const { lastFrame } = render(<SetupPanel port={19081} log="/tmp/events.jsonl" />);
		expect(lastFrame()).toContain('/tmp/events.jsonl');
	});
});
