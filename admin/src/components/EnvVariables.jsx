import { useState, useEffect } from 'react'
import axios from '@/lib/api'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'

const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

function EnvVariables() {
  const [vars, setVars] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [messageType, setMessageType] = useState('success')

  useEffect(() => { loadEnv() }, [])

  const loadEnv = async () => {
    try {
      const res = await axios.get('/api/admin/env')
      const list = res.data.vars || []
      setVars(list)
      const next = {}
      list.forEach((v) => {
        next[v.key] = v.secret ? '' : (v.value ?? '')
      })
      setDrafts(next)
    } catch (e) {
      console.error(e)
      setMessage('Failed to load environment variables')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (text, type = 'success') => {
    setMessage(text)
    setMessageType(type)
    setTimeout(() => setMessage(null), 4000)
  }

  const applyResponse = (data) => {
    const list = data.vars || []
    setVars(list)
    const next = {}
    list.forEach((v) => {
      next[v.key] = v.secret ? '' : (v.value ?? '')
    })
    setDrafts(next)
    const restartNote = data.needsRestart
      ? ' Restart the server for some changes to take full effect.'
      : ''
    showMessage(`Environment variables saved.${restartNote}`)
  }

  const saveOne = async (key) => {
    const meta = vars.find((v) => v.key === key)
    if (!meta) return
    try {
      const value = drafts[key] ?? ''
      // Clearing a non-secret with empty field removes it; secrets need explicit Clear
      const updates =
        !meta.secret && String(value).trim() === '' && meta.isSet
          ? { [key]: null }
          : { [key]: value }
      const res = await axios.put('/api/admin/env', { updates })
      applyResponse(res.data)
    } catch (e) {
      alert('Failed to update: ' + (e.response?.data?.error || e.message))
    }
  }

  const clearSecret = async (key) => {
    if (!window.confirm(`Clear ${key} from .env?`)) return
    try {
      const res = await axios.put('/api/admin/env', { updates: { [key]: null } })
      applyResponse(res.data)
    } catch (e) {
      alert('Failed to clear: ' + (e.response?.data?.error || e.message))
    }
  }

  const saveAll = async () => {
    try {
      setSaving(true)
      const updates = {}
      vars.forEach((meta) => {
        const value = drafts[meta.key] ?? ''
        if (meta.secret) {
          if (String(value).trim() !== '') updates[meta.key] = value
        } else if (!String(value).trim() && meta.isSet) {
          updates[meta.key] = null
        } else {
          updates[meta.key] = value
        }
      })
      const res = await axios.put('/api/admin/env', { updates })
      applyResponse(res.data)
    } catch (e) {
      showMessage('Failed to save environment variables', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading environment variables...
        </CardContent>
      </Card>
    )
  }

  if (isDemoMode) {
    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold mb-2">Environment Variables</h2>
          <p className="text-sm text-muted-foreground">
            Environment editing is disabled in demo mode. Deploy your own instance to configure Spotify, OAuth, and server settings via <code className="text-xs">.env</code>.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-2 z-40 flex justify-end">
        <Button
          onClick={saveAll}
          disabled={saving}
          className="min-h-[44px] px-5 sm:min-h-9 sm:px-4"
        >
          {saving ? 'Saving…' : 'Save All'}
        </Button>
      </div>

      {message && (
        <div
          className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-center border-b px-6 py-3 pt-safe pl-safe pr-safe text-sm shadow-md ${
            messageType === 'success'
              ? 'bg-primary/95 text-primary-foreground border-primary/30'
              : 'bg-destructive/95 text-destructive-foreground border-destructive/30'
          }`}
          style={{ animation: 'slideDown 0.25s ease-out' }}
        >
          {message}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold mb-1">Environment Variables</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Edit values stored in your <code className="text-xs">.env</code> file. Changes update the running process immediately when possible; keys marked restart require a server restart.
          </p>

          {vars.map((meta) => (
            <div
              key={meta.key}
              className="flex flex-col sm:flex-row sm:items-center gap-4 py-3 border-b last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{meta.label}</div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{meta.key}</p>
                {meta.help && (
                  <p className="text-xs text-muted-foreground mt-1">{meta.help}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-1">
                  {meta.isSet ? (
                    <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      Set
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Not set
                    </span>
                  )}
                  {meta.needsRestart && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Restart required
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <Input
                  type={meta.secret ? 'password' : 'text'}
                  value={drafts[meta.key] ?? ''}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [meta.key]: e.target.value }))
                  }
                  placeholder={
                    meta.secret
                      ? meta.isSet
                        ? '•••••••• (leave blank to keep)'
                        : 'Not set'
                      : ''
                  }
                  autoComplete="off"
                  className="w-full sm:w-64"
                />
                <Button size="sm" onClick={() => saveOne(meta.key)}>
                  Save
                </Button>
                {meta.secret && meta.isSet && (
                  <Button size="sm" variant="outline" onClick={() => clearSecret(meta.key)}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default EnvVariables
