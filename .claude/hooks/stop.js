const { execSync } = require('child_process')
const fs = require('fs')

// Цикл включается только запуском через .claude/ralph.start.js (он выставляет RALPH_ACTIVE=1,
// переменная наследуется вложенными сессиями claude -p). В обычных сессиях хук ничего не делает.
// Флага в ralph.config.json нет: файл отслеживается git, и локальная правка конфликтовала бы
// с обновлениями из main.
if (process.env.RALPH_ACTIVE !== '1') {
  process.exit(0)
}

// cwd хука наследуется от сессии: если агент сделал `cd apps/web`, относительные пути ломаются.
// Поэтому всегда работаем из корня репозитория (файл лежит в <root>/.claude/hooks).
process.chdir(require('path').resolve(__dirname, '..', '..'))

// Вывод Stop-хука Claude Code перехватывает и в терминал не показывает, поэтому всё пишем
// ещё и в .claude/ralph.log (следить: tail -f .claude/ralph.log).
const logFile = '.claude/ralph.log'
const log = (msg) => {
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  console.log(msg)
}
// Вывод вложенной сессии claude -p уходит в тот же файл
const nestedStdio = () => {
  const fd = fs.openSync(logFile, 'a')
  return ['inherit', fd, fd]
}

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'))

// Счётчик итераций
const counterFile = '.claude/ralph.iterations.json'
let counter = { count: 0 }
if (fs.existsSync(counterFile)) {
  counter = JSON.parse(fs.readFileSync(counterFile, 'utf8'))
}

// Проверяем лимит
if (counter.count >= config.maxIterations) {
  log(`⛔ Достигнут лимит итераций (${config.maxIterations}). Ralph останавливается.`)
  fs.writeFileSync(counterFile, JSON.stringify({ count: 0 }))
  process.exit(0)
}

// Проверяем открытые Issues
const output = execSync(
  `gh issue list --milestone "${config.milestone}" --state open --json number,title`,
).toString()
const issues = JSON.parse(output)

if (issues.length > 0) {
  // Увеличиваем счётчик
  counter.count++
  fs.writeFileSync(counterFile, JSON.stringify(counter))

  // gh отдаёт новые Issues первыми, а по правилам ralph.md берётся наименьший номер
  const next = issues.sort((a, b) => a.number - b.number)[0]
  log(`🔄 Итерация ${counter.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`)

  const prompt = config.prompt
    .replace('{milestone}', config.milestone)
    .replace('{branch}', config.branch)
  execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, { stdio: nestedStdio() })
} else {
  // Milestone закрыт — сбрасываем счётчик и создаём PR
  log(`✅ Milestone завершён. Создаём PR.`)
  fs.writeFileSync(counterFile, JSON.stringify({ count: 0 }))
  // Если PR для ветки уже есть (повторный запуск после сбоя ревью), берём его, а не создаём новый
  let prUrl = ''
  try {
    prUrl = execSync(
      `gh pr view ${config.branch} --json url,state --jq 'select(.state=="OPEN").url'`,
    )
      .toString()
      .trim()
  } catch {}
  if (prUrl) {
    log(`PR уже существует: ${prUrl}`)
  } else {
    // Описание PR: закрытые Issues milestone (Closes #N) и список коммитов ветки
    const closed = JSON.parse(
      execSync(
        `gh issue list --milestone "${config.milestone}" --state closed --limit 100 --json number,title`,
      ).toString(),
    )
    const commits = execSync(`git log origin/main..${config.branch} --pretty=format:"- %s"`)
      .toString()
      .trim()
    const body = [
      '## Что сделано',
      `Milestone: ${config.milestone}`,
      '',
      '## Закрытые Issues',
      ...closed.map((i) => `Closes #${i.number} — ${i.title}`),
      '',
      '## Коммиты',
      commits,
      '',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ].join('\n')
    const bodyFile = require('path').join(require('os').tmpdir(), `ralph-pr-body-${process.pid}.md`)
    fs.writeFileSync(bodyFile, body)
    prUrl = execSync(
      `gh pr create --title "feat: ${config.milestone}" --body-file "${bodyFile}" --base main --head ${config.branch}`,
    )
      .toString()
      .trim()
    fs.rmSync(bodyFile, { force: true })
    log(`PR создан: ${prUrl}`)
  }

  log('🔍 Запускаем финальное ревью через Opus...')
  const reviewPrompt =
    `Сделай детальное code review PR ${prUrl}. Проверь архитектуру, безопасность, производительность и соответствие PRD. ` +
    `Опубликуй результат в PR одним отзывом с inline-комментариями: ` +
    `gh api repos/{owner}/{repo}/pulls/<номер>/reviews --input <json-файл> (event COMMENT). ` +
    `Если публикация не удалась, выведи причину и сохрани текст ревью в .pr-review.json. ` +
    `После 502 сначала проверь список отзывов, чтобы не создать дубль.`
  try {
    // Ревью-сессия заканчивается своим Stop-событием. Без отключения RALPH_ACTIVE хук сработал бы
    // в ней снова: milestone закрыт → «PR уже существует» → ещё одно ревью, и так по цепочке.
    // Цикл итераций держится на рекурсии хука, а ревью — финальный шаг, ему хук не нужен.
    const { RALPH_ACTIVE, ...reviewEnv } = process.env
    execSync(`claude -p "${reviewPrompt}" --model claude-opus-5-5`, {
      stdio: nestedStdio(),
      env: reviewEnv,
    })
  } catch (e) {
    log(`⚠️ Ревью не выполнено: ${e.message}`)
  }
}
