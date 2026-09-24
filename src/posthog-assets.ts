import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The n8n frontend does not only post data to the configured API host. It also
 * loads the posthog-js library itself from that host, as
 * `<script src="{api_host}/static/array.js">`. Answering that with our generic
 * JSON body turns `capture()` into a silent no-op forever, so this one asset
 * has to be the real library.
 */
const ARRAY_JS_URL = 'https://cdn.jsdelivr.net/npm/posthog-js@1/dist/array.full.js';
const CACHE_FILE = 'array.full.js';

/** Keeps the library in memory once it is known, so a page reload is free. */
let memory: string | null = null;

const SHIM = `// telemetry-inspector could not reach the posthog-js CDN and has no cached
// copy, so this is a no-op stand-in. Events will NOT be captured from the
// browser until you run this tool once with a network connection.
(function () {
  var noop = function () {};
  var api = { init: noop, capture: noop, identify: noop, register: noop, reset: noop,
    onFeatureFlags: noop, isFeatureEnabled: function () { return false; },
    getFeatureFlag: function () {}, group: noop, setPersonProperties: noop, debug: noop };
  window.posthog = window.posthog || api;
})();
`;

export interface ArrayJsResult {
	body: string;
	/** True when the body is the no-op shim, which the status bar warns about. */
	stale: boolean;
}

export const loadArrayJs = async (cacheDir: string, fetchImpl: typeof fetch = fetch): Promise<ArrayJsResult> => {
	if (memory !== null) return { body: memory, stale: false };

	const cached = join(cacheDir, CACHE_FILE);
	if (existsSync(cached)) {
		memory = readFileSync(cached, 'utf8');
		return { body: memory, stale: false };
	}

	try {
		const response = await fetchImpl(ARRAY_JS_URL);
		if (!response.ok) throw new Error(`the CDN answered ${response.status}`);
		const body = await response.text();
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(cached, body);
		memory = body;
		return { body, stale: false };
	} catch {
		return { body: SHIM, stale: true };
	}
};

/** Only the tests need this. It keeps one run from leaking into the next. */
export const resetArrayJsCache = (): void => {
	memory = null;
};

/**
 * Feature flags are always empty. This tool shows what n8n would send. It does
 * not replicate the evaluation PostHog does on its own side.
 */
export const flagsResponse = () => ({
	flags: {},
	featureFlags: {},
	featureFlagPayloads: {},
	errorsWhileComputingFlags: false,
	quotaLimited: null,
});

const REMOTE_CONFIG = { supportedCompression: ['gzip-js'], siteApps: [], captureDeadClicks: false };

export const remoteConfigJson = () => REMOTE_CONFIG;

/**
 * posthog-js asks for `/array/<token>/config.js` and expects JavaScript that
 * assigns the configuration, not JSON. A JSON answer makes the script tag fail
 * to parse.
 */
export const remoteConfigJs = (): string =>
	`window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {};\n` +
	`window._POSTHOG_REMOTE_CONFIG['stub'] = { config: ${JSON.stringify(REMOTE_CONFIG)}, siteApps: [] };\n`;
