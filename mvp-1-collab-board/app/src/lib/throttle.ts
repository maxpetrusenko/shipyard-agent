export const throttle = <T extends unknown[]>(fn: (...args: T) => void, waitMs: number) => {
  let lastCall = 0
  let timeout: number | null = null
  let trailingArgs: T | null = null

  const invoke = (args: T) => {
    lastCall = Date.now()
    fn(...args)
  }

  return (...args: T) => {
    const now = Date.now()
    const elapsed = now - lastCall

    if (elapsed >= waitMs) {
      if (timeout) {
        window.clearTimeout(timeout)
        timeout = null
      }
      invoke(args)
      return
    }

    trailingArgs = args
    if (!timeout) {
      timeout = window.setTimeout(() => {
        timeout = null
        if (trailingArgs) {
          invoke(trailingArgs)
          trailingArgs = null
        }
      }, waitMs - elapsed)
    }
  }
}
