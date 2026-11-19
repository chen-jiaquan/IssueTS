import http from './http'

export const getSummary = () => http.get('/home/summary')
export const getAlerts = () => http.get('/home/alerts')

export const listNotices = () => http.get('/notices')
export const createNotice = (data) => http.post('/notices', data)
export const updateNotice = (id, data) => http.put(`/notices/${id}`, data)
export const deleteNotice = (id) => http.delete(`/notices/${id}`)

export const listTodos = () => http.get('/todos')
export const createTodo = (data) => http.post('/todos', data)
export const updateTodo = (id, data) => http.put(`/todos/${id}`, data)
export const deleteTodo = (id) => http.delete(`/todos/${id}`)
