import { defineStore } from 'pinia'

// 三套主题：ocean 深空蓝 / paper 云白 / warm 暖砂
const VALID = ['ocean', 'paper', 'warm']

export const useThemeStore = defineStore('theme', {
  state: () => ({
    current: VALID.includes(localStorage.getItem('theme')) ? localStorage.getItem('theme') : 'ocean',
  }),
  actions: {
    // 同步 :root[data-theme]（index.html 已在首屏前应用过，这里兜底）
    init() {
      document.documentElement.dataset.theme = this.current
    },
    set(name) {
      if (!VALID.includes(name)) return
      this.current = name
      localStorage.setItem('theme', name)
      document.documentElement.dataset.theme = name
    },
  },
})
