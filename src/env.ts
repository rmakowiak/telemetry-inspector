/**
 * The five variables that point a local n8n at this tool. The user pastes
 * them into the shell that runs n8n.
 */
export const envBlock = (port: number): string =>
	[
		'export N8N_DIAGNOSTICS_ENABLED=true',
		`export N8N_DIAGNOSTICS_CONFIG_BACKEND='stub;http://localhost:${port}'`,
		`export N8N_DIAGNOSTICS_CONFIG_FRONTEND='stub;http://localhost:${port}'`,
		'export N8N_DIAGNOSTICS_POSTHOG_API_KEY=stub',
		`export N8N_DIAGNOSTICS_POSTHOG_API_HOST=http://localhost:${port}`,
	].join('\n') + '\n';
