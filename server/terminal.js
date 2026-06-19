// Spawn a fresh Claude Code session in macOS Terminal.app, cd'd into a folder.
//
// Used by "Help with application questions": we prep a per-application folder (resume,
// cover letter, master bank, JD, CLAUDE.md priming) then open a real terminal running the
// `claude` CLI there, so Tyler can chat with a model that has the full context loaded.

import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';

// Single-quote a string for safe use inside a POSIX shell command (used both for the
// shell `cd` and inside the AppleScript string).
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Escape a string for embedding inside an AppleScript double-quoted literal.
function osaStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Open Terminal.app in `dir` and run the claude CLI there. Returns a promise that resolves
// true if osascript launched cleanly. The dir must come from applicationDir() (never client
// input) - callers compute it server-side.
export function openTerminalWithClaude(dir) {
  return new Promise((resolve) => {
    if (!dir) return resolve(false);
    const shellCmd = `cd ${shq(dir)} && ${shq(CLAUDE_BIN)}`;
    const script = `tell application "Terminal"\n  activate\n  do script "${osaStr(shellCmd)}"\nend tell`;
    const child = spawn('osascript', ['-e', script], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
