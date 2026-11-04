// Пишет в .claude/ralph.log строку о начале работы над Issue.
// Хук видит только первую Issue итерации, а агент может сделать несколько за одну сессию
// (см. «Красные тесты следующих Issues» в ralph.md), поэтому о каждой следующей он сообщает сам.
// Использование: node .claude/hooks/log-issue.js <номер>
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const number = process.argv[2]
if (!/^\d+$/.test(number ?? '')) {
  console.error('Использование: node .claude/hooks/log-issue.js <номер Issue>')
  process.exit(1)
}

let title = ''
try {
  title = execFileSync('gh', ['issue', 'view', number, '--json', 'title', '--jq', '.title'])
    .toString()
    .trim()
} catch {}

const logFile = path.resolve(__dirname, '..', 'ralph.log')
fs.appendFileSync(
  logFile,
  `${new Date().toISOString()} ▶️ Начата Issue #${number}${title ? `: ${title}` : ''}\n`,
)
