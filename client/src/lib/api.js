import axios from 'axios'
import { installDemoMock } from '@demo/installMock.js'

// Empty string keeps relative /api/... calls (same-origin: local dev via the
// Vite proxy, or Docker where one server serves both the API and this app).
// Set VITE_API_URL when the frontend is hosted separately from the API (e.g.
// this app on Vercel, the API on Render).
axios.defaults.baseURL = import.meta.env.VITE_API_URL || ''
axios.defaults.withCredentials = true
installDemoMock(axios)

export default axios
