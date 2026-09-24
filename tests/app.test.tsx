import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { EventStore } from '../src/store.js';
import { App } from '../src/ui/App.js';
import type { RawRecord } from '../src/types.js';

const track = (name: string, props: Record<string, unknown> = {}): RawRecord => ({
	ts: new Date().toISOString(),
	method: 'POST',
	path: '/v1/track',
	body: { event: name, properties: { ...props, $lib: 'web' } },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

const mount = (store: EventStore) =>
	render(
		<App store={store} port={19081} role="owner" warning={null} columns={120} rows={24} log="/tmp/events.jsonl" />,
	);

describe('App', () => {
	it('shows the setup block until the first event arrives', async () => {
		const store = new EventStore();
		const { lastFrame } = mount(store);
		expect(lastFrame()).toContain('N8N_DIAGNOSTICS_ENABLED');
		store.add(track('Report opened'));
		await tick();
		expect(lastFrame()).toContain('Report opened');
	});

	it('filters when the user types after f', async () => {
		const store = new EventStore();
		store.add(track('Report opened'));
		store.add(track('Export finished'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('f');
		await tick();
		stdin.write('export');
		await tick();
		expect(lastFrame()).toContain('Export finished');
		expect(lastFrame()).not.toContain('Report opened');
	});

	it('drops the filter on escape', async () => {
		const store = new EventStore();
		store.add(track('Report opened'));
		store.add(track('Export finished'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('f');
		stdin.write('export');
		await tick();
		stdin.write('');
		await tick();
		expect(lastFrame()).toContain('Report opened');
	});

	it('pauses and resumes with p', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('p');
		await tick();
		expect(lastFrame()).toContain('PAUSED');
		stdin.write('p');
		await tick();
		expect(lastFrame()).toContain('REC');
	});

	it('holds the list still while paused and catches up on resume', async () => {
		const store = new EventStore();
		store.add(track('First'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('p');
		await tick();
		store.add(track('While paused'));
		await tick();
		expect(lastFrame()).not.toContain('While paused');
		stdin.write('p');
		await tick();
		expect(lastFrame()).toContain('While paused');
	});

	it('shows the $ events only after .', async () => {
		const store = new EventStore();
		store.add(track('$pageleave'));
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		expect(lastFrame()).not.toContain('$pageleave');
		stdin.write('.');
		await tick();
		expect(lastFrame()).toContain('$pageleave');
	});

	it('switches the detail pane to the raw request with tab', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		expect(lastFrame()).not.toContain('/v1/track');
		stdin.write('\t');
		await tick();
		expect(lastFrame()).toContain('/v1/track');
	});

	it('opens the help with ?', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('?');
		await tick();
		expect(lastFrame()).toContain('filter');
	});

	it('moves the selection with j and k', async () => {
		const store = new EventStore();
		store.add(track('First'));
		store.add(track('Second'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		// The newest row is selected, so k moves up to the first one.
		stdin.write('k');
		await tick();
		const frame = lastFrame() ?? '';
		const selectedLine = frame.split('\n').find((line) => line.trimStart().startsWith('>')) ?? '';
		expect(selectedLine).toContain('First');
	});

	it('empties the list with c', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('c');
		await tick();
		expect(lastFrame()).toContain('No events yet');
	});

	it('opens the setup panel with s, even once events are flowing', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		// The empty state is gone, so the block has to be reachable by key.
		expect(lastFrame()).not.toContain('N8N_DIAGNOSTICS_ENABLED');
		stdin.write('s');
		await tick();
		expect(lastFrame()).toContain('N8N_DIAGNOSTICS_ENABLED');
		expect(lastFrame()).toContain('/tmp/events.jsonl');
	});

	it('closes the setup panel on the next key', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		stdin.write('s');
		await tick();
		stdin.write('s');
		await tick();
		expect(lastFrame()).not.toContain('N8N_DIAGNOSTICS_ENABLED');
	});

	it('names the setup key in the footer and in the help', async () => {
		const store = new EventStore();
		store.add(track('A'));
		const { stdin, lastFrame } = mount(store);
		await tick();
		expect(lastFrame()).toContain('[s]etup');
		stdin.write('?');
		await tick();
		expect(lastFrame()).toContain('the environment block');
	});

	it('falls back to one column on a narrow terminal', async () => {
		const store = new EventStore();
		store.add(track('A', { reason: 'narrow' }));
		const { lastFrame } = render(
			<App store={store} port={19081} role="owner" warning={null} columns={70} rows={24} log="/tmp/events.jsonl" />,
		);
		await tick();
		const frame = lastFrame() ?? '';
		expect(frame).toContain('A');
		// The detail opens under the selected row instead of beside it.
		expect(frame).toContain('narrow');
	});
});
