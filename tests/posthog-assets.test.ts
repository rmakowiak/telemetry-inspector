import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	flagsResponse,
	loadArrayJs,
	remoteConfigJs,
	remoteConfigJson,
	resetArrayJsCache,
} from '../src/posthog-assets.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ti-cache-'));

beforeEach(() => resetArrayJsCache());

describe('loadArrayJs', () => {
	it('fetches once and then serves the cache', async () => {
		const d = dir();
		const fetchImpl = vi.fn(async () => new Response('REAL BUNDLE', { status: 200 })) as unknown as typeof fetch;
		const first = await loadArrayJs(d, fetchImpl);
		expect(first.body).toBe('REAL BUNDLE');
		expect(first.stale).toBe(false);
		const second = await loadArrayJs(d, fetchImpl);
		expect(second.body).toBe('REAL BUNDLE');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('serves a stale cache when the network fails', async () => {
		const d = dir();
		writeFileSync(join(d, 'array.full.js'), 'CACHED');
		const fetchImpl = vi.fn(async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const r = await loadArrayJs(d, fetchImpl);
		expect(r.body).toBe('CACHED');
		expect(r.stale).toBe(false);
	});

	it('falls back to a no-op shim with no cache and no network', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const r = await loadArrayJs(dir(), fetchImpl);
		expect(r.stale).toBe(true);
		expect(r.body).toContain('posthog');
	});

	it('treats a non-200 answer as a failure', async () => {
		const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
		const r = await loadArrayJs(dir(), fetchImpl);
		expect(r.stale).toBe(true);
	});
});

describe('the static answers', () => {
	it('answers flags with empty flags in the v2 shape', () => {
		expect(flagsResponse()).toEqual({
			flags: {},
			featureFlags: {},
			featureFlagPayloads: {},
			errorsWhileComputingFlags: false,
			quotaLimited: null,
		});
	});

	it('answers the remote config as JavaScript, not JSON', () => {
		expect(remoteConfigJs()).toContain('_POSTHOG_REMOTE_CONFIG');
	});

	it('answers the remote config as JSON for the non-js path', () => {
		expect(remoteConfigJson()).toMatchObject({ siteApps: [] });
	});
});
