import http from './http'

export const getPivot = (params) => http.get('/stats/pivot', { params })

export const getLoadMatrix = (params) => http.get('/stats/load-matrix', { params })

export const exportPivot = async (params = {}, charts = []) => {
  const res = await fetch('/api/stats/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ filters: params, charts }),
  })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
