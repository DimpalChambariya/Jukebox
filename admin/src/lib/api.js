import axios from 'axios'
import { installDemoMock } from '@demo/installMock.js'

// Empty string keeps relative /api/... calls (same-origin: local dev via the
// Vite proxy, or Docker where one server serves both the API and this app).
// Set VITE_API_URL when the frontend is hosted separately from the API (e.g.
// this app on Vercel, the API on Render).
axios.defaults.baseURL = import.meta.env.VITE_API_URL || ''
axios.defaults.withCredentials = true
installDemoMock(axios)

/** Set from App.jsx so 401 clears login UI */
export const authHandlers = {
  onUnauthorized: null
}

axios.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status !== 401) return Promise.reject(err)
    const url = err.config?.url || ''
    if (url.includes('/api/admin/login') || url.includes('/api/admin/session')) {
      return Promise.reject(err)
    }
    if (
      url.includes('/api/admin/') ||
      (url.includes('/api/config') && !url.includes('/public')) ||
      url.includes('/api/prequeue/') ||
      url.includes('/api/auth/disconnect')
    ) {
      authHandlers.onUnauthorized?.()
    }
    return Promise.reject(err)
  }
)

export default axios
