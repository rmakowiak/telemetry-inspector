import { spawn } from 'node:child_process';

/**
 * Copies text to the system clipboard. Does nothing when no clipboard command
 * exists, because a failed copy must never take the interface down.
 */
export const copyToClipboard = (text: string): void => {
	const command = process.platform === 'darwin' ? 'pbcopy' : 'xclip';
	const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard'];

	try {
		const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
		child.on('error', () => {});
		child.stdin.on('error', () => {});
		child.stdin.end(text);
	} catch {
		// No clipboard on this machine.
	}
};
