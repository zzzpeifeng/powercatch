/**
 * 节流 composable
 * @param fn 需要节流的函数
 * @param interval 间隔毫秒数
 * @returns 节流后的函数
 */
export function useThrottle<T extends (...args: any[]) => any>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastTime = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    const now = Date.now()

    if (now - lastTime >= interval) {
      lastTime = now
      fn(...args)
    } else {
      // 保证最后一次调用也能执行
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        lastTime = Date.now()
        fn(...args)
        timer = null
      }, interval - (now - lastTime))
    }
  }
}
