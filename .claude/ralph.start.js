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

// RALPH_ACTIVE=1 включает Stop-хук (.claude/hooks/stop.js) во вложенных сессиях
execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, {
  stdio: 'inherit',
  env: { ...process.env, RALPH_ACTIVE: '1' },
})
