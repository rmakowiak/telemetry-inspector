import { defineConfig } from 'tsup';

// Some bundled dependencies are CommonJS and call `require()` at load time.
// An ES module has no `require`, so the bundle defines one from `node:module`
// before any of that code runs.
const REQUIRE_SHIM = [
	'import { createRequire as __createRequire } from "node:module";',
	'const require = __createRequire(import.meta.url);',
].join('\n');

export default defineConfig({
	entry: ['src/cli.tsx'],
	format: ['esm'],
	target: 'node20',
	outDir: 'dist',
	clean: true,
	splitting: false,
	// Everything is bundled into one file, so `npx` from a git URL needs no
	// install step on the machine that runs it.
	noExternal: [/.*/],
	banner: { js: `#!/usr/bin/env node\n${REQUIRE_SHIM}` },
	esbuildOptions(options) {
		options.alias = {
			...options.alias,
			'react-devtools-core': './stubs/react-devtools-core.js',
		};
	},
});
