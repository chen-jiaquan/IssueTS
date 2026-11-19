import { ref, onMounted, onUnmounted } from 'vue'

// 断点：<640 手机 / 640~1023 平板 / >=1024 桌面
const isMobile = ref(false)
const isTablet = ref(false)
let count = 0

export function useBreakpoint() {
  const update = () => {
    const w = window.innerWidth
    isMobile.value = w < 640
    isTablet.value = w >= 640 && w < 1024
  }

  onMounted(() => {
    if (count++ === 0) window.addEventListener('resize', update, { passive: true })
    update()
  })
  onUnmounted(() => {
    if (--count === 0) window.removeEventListener('resize', update)
  })

  return { isMobile, isTablet }
}
