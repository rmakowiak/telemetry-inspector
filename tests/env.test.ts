import { expect, it } from 'vitest';
import { envBlock } from '../src/env.js';

it('prints five exports aimed at the given port', () => {
	const block = envBlock(19081);
	const lines = block.trim().split('\n');
	expect(lines).toHaveLength(5);
	expect(lines[0]).toBe('export N8N_DIAGNOSTICS_ENABLED=true');
	expect(block).toContain("export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:19081'");
	expect(block).toContain("export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:19081'");
	expect(block).toContain('export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub');
	expect(block).toContain('export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:19081');
});
