import http from './http'

export const getPivot = (params) => http.get('/stats/pivot', { params })

export const exportPivot = async (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/stats/export?${qs}`, {
    headers: { Authorization: `Bearer ${sessionStorage.getItem('access_token')}` },
  })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
