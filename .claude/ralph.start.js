const { execSync } = require('child_process')
const fs = require('fs')

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'))

// Сбрасываем счётчик итераций
fs.writeFileSync('.claude/ralph.iterations.json', JSON.stringify({ count: 0, phaseIndex: 0 }))

// Запускаем первую итерацию
const prompt = config.prompt
  .replace('{milestone}', config.milestone)
  .replace('{branch}', config.branch)
console.log(`🚀 Запускаем Ralph для milestone: ${config.milestone}`)

// Первую итерацию запускаем мы, а не хук, поэтому и в лог её Issue записываем здесь
// (по правилам ralph.md берётся открытая Issue с наименьшим номером)
try {
  const open = JSON.parse(
    execSync(
      `gh issue list --milestone "${config.milestone}" --state open --json number`,
    ).toString(),
  )
  const first = Math.min(...open.map((i) => i.number))
  if (Number.isFinite(first)) execSync(`node .claude/hooks/log-issue.js ${first}`)
} catch {}

// RALPH_ACTIVE=1 включает Stop-хук (.claude/hooks/stop.js) во вложенных сессиях
const env = { ...process.env, RALPH_ACTIVE: '1' }
try {
  execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, { stdio: 'inherit', env })
} catch (e) {
  // Сессия, упавшая с ошибкой (обычно лимит --max-turns), не вызывает Stop-хук, и цикл
  // не продолжился бы. Запускаем хук сами: он начнёт следующую итерацию.
  const msg = `⚠️ Первая итерация прервана (код выхода ${e.status ?? 'неизвестен'}), продолжаем через Stop-хук.`
  fs.appendFileSync('.claude/ralph.log', `${new Date().toISOString()} ${msg}\n`)
  console.log(msg)
  execSync('node .claude/hooks/stop.js', { stdio: 'inherit', env })
}
