// PreToolUse hook for the qa-reviewer subagent.
// Allows file writes ONLY to <project>/reports/*.md. Everything else is blocked (exit 2).
const path = require('path');

const PROJECT = path.resolve(__dirname, '..', '..');
const REPORTS = path.join(PROJECT, 'reports') + path.sep;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    deny('hook: не удалось разобрать входные данные, запись заблокирована');
  }
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};

  // Shell and notebook tools can modify anything: never allowed for the reviewer.
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'NotebookEdit' || tool === 'Edit') {
    deny(`qa-reviewer — только чтение: инструмент ${tool} запрещён. Писать можно только отчёт в reports/*.md через Write.`);
  }

  if (tool === 'Write') {
    const target = path.resolve(PROJECT, String(ti.file_path || ''));
    const ok = target.toLowerCase().startsWith(REPORTS.toLowerCase()) && target.toLowerCase().endsWith('.md');
    if (!ok) {
      deny(`qa-reviewer может писать только в ${REPORTS}*.md. Заблокировано: ${target}`);
    }
  }
  process.exit(0);
});

function deny(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}
