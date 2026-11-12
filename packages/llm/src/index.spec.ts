import childProcess from 'node:child_process'
import http from 'node:http'
import https from 'node:https'

const anthropic = vi.hoisted(() => ({
  loaded: vi.fn(),
  query: vi.fn(),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  anthropic.loaded()
  return {
    query: anthropic.query,
    tool: anthropic.tool,
    createSdkMcpServer: anthropic.createSdkMcpServer,
  }
})

type Facade = typeof import('./index.js')

async function loadFacade(): Promise<Facade> {
  vi.resetModules()
  return import('./index.js')
}

beforeEach(() => {
  anthropic.loaded.mockClear()
  anthropic.query.mockClear()
})

describe('фасад @video-meetings/llm: выбор реализации', () => {
  it('LLM_PROVIDER=local — query, tool, createSdkMcpServer из @video-meetings/llm-sdk', async () => {
    vi.stubEnv('LLM_PROVIDER', 'local')

    const facade = await loadFacade()
    const local = await import('@video-meetings/llm-sdk')

    expect(facade.query).toBe(local.query)
    expect(facade.tool).toBe(local.tool)
    expect(facade.createSdkMcpServer).toBe(local.createSdkMcpServer)
    expect(anthropic.loaded).not.toHaveBeenCalled()
  })

  it('без LLM_PROVIDER по умолчанию local', async () => {
    vi.stubEnv('LLM_PROVIDER', undefined)

    const facade = await loadFacade()
    const local = await import('@video-meetings/llm-sdk')

    expect(facade.query).toBe(local.query)
    expect(anthropic.loaded).not.toHaveBeenCalled()
  })

  it('LLM_PROVIDER=anthropic — query, tool, createSdkMcpServer из @anthropic-ai/claude-agent-sdk', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')

    const facade = await loadFacade()

    expect(facade.query).toBe(anthropic.query)
    expect(facade.tool).toBe(anthropic.tool)
    expect(facade.createSdkMcpServer).toBe(anthropic.createSdkMcpServer)
  })

  it('неизвестный LLM_PROVIDER — ошибка с допустимыми значениями', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')

    await expect(loadFacade()).rejects.toThrow(
      'LLM_PROVIDER must be "local" or "anthropic", got "openai"',
    )
  })

  it('сообщает выбранный провайдер', async () => {
    vi.stubEnv('LLM_PROVIDER', 'local')
    expect((await loadFacade()).provider).toBe('local')

    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    expect((await loadFacade()).provider).toBe('anthropic')
  })
})

describe('фасад @video-meetings/llm: при LLM_PROVIDER=local нет запросов к Anthropic', () => {
  const ANTHROPIC_HOSTS = /(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/

  function hostOf(input: unknown): string {
    if (typeof input === 'string') return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    if (input instanceof Request) return new URL(input.url).hostname
    if (input && typeof input === 'object') {
      const options = input as { hostname?: string; host?: string }
      return options.hostname ?? options.host ?? ''
    }
    return ''
  }

  it('query() ходит только в OLLAMA_URL', async () => {
    vi.stubEnv('LLM_PROVIDER', 'local')
    vi.stubEnv('OLLAMA_URL', 'http://192.168.100.204:11434')
    vi.stubEnv('OLLAMA_MODEL', 'qwen3:14b')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')

    const hosts: string[] = []
    const fetchMock = vi.fn((input: string | URL | Request) => {
      hosts.push(hostOf(input))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'qwen3:14b',
            created_at: '2026-11-12T10:00:00Z',
            message: { role: 'assistant', content: 'ok' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const httpRequest = vi.spyOn(http, 'request')
    const httpsRequest = vi.spyOn(https, 'request')
    const spawn = vi.spyOn(childProcess, 'spawn')

    const { query } = await loadFacade()
    const types: string[] = []
    for await (const message of query({ prompt: 'hi' })) types.push(message.type)

    expect(types).toEqual(['system', 'assistant', 'result'])
    expect(hosts).toEqual(['192.168.100.204'])
    expect(hosts.filter((host) => ANTHROPIC_HOSTS.test(host))).toEqual([])
    for (const call of [...httpRequest.mock.calls, ...httpsRequest.mock.calls]) {
      expect(hostOf(call[0])).not.toMatch(ANTHROPIC_HOSTS)
    }
    expect(spawn).not.toHaveBeenCalled()
    expect(anthropic.loaded).not.toHaveBeenCalled()
    expect(anthropic.query).not.toHaveBeenCalled()
  })
})
