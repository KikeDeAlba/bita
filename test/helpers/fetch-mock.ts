export interface MockRoute {
  method?: string
  match: string | RegExp
  status?: number
  body?: unknown
  text?: string
  headers?: Record<string, string>
  times?: number
}

export interface RecordedCall {
  method: string
  url: string
  body: unknown
  headers: Headers
  at: number
}

export interface FetchMock {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
  clock: { now: () => number; sleep: (ms: number) => Promise<void>; elapsed: () => number }
}

export function createFetchMock(routes: MockRoute[]): FetchMock {
  const calls: RecordedCall[] = []
  const remaining = routes.map((route) => ({ route, left: route.times ?? Number.POSITIVE_INFINITY }))

  let virtualNow = 1_700_000_000_000
  const now = (): number => virtualNow
  const sleep = async (ms: number): Promise<void> => {
    virtualNow += ms
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const rawBody = init?.body
    calls.push({
      method,
      url,
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
      headers: new Headers((init?.headers ?? {}) as Record<string, string>),
      at: virtualNow,
    })

    const entry = remaining.find(
      (candidate) =>
        candidate.left > 0 &&
        (candidate.route.method ?? 'GET') === method &&
        (typeof candidate.route.match === 'string'
          ? url.includes(candidate.route.match)
          : candidate.route.match.test(url)),
    )

    if (!entry) {
      return new Response(JSON.stringify({ error: `no route for ${method} ${url}` }), { status: 599 })
    }

    entry.left -= 1
    const route = entry.route
    const payload = route.text ?? (route.body === undefined ? '' : JSON.stringify(route.body))
    return new Response(payload, {
      status: route.status ?? 200,
      headers: route.headers ?? {},
    })
  }) as typeof fetch

  return {
    fetchImpl,
    calls,
    clock: { now, sleep, elapsed: () => virtualNow },
  }
}
