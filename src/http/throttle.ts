export type Throttle = <T>(task: () => Promise<T>) => Promise<T>

export interface ThrottleOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export function createThrottle(minIntervalMs: number, options: ThrottleOptions = {}): Throttle {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep

  let tail: Promise<unknown> = Promise.resolve()
  let lastStartedAt = Number.NEGATIVE_INFINITY

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const waitMs = minIntervalMs - (now() - lastStartedAt)
      if (waitMs > 0) await sleep(waitMs)
      lastStartedAt = now()
      return task()
    }

    const result = tail.then(run, run)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
