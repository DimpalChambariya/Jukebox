import { useState, useEffect, useRef } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Minus, Plus, Volume2, VolumeX } from 'lucide-react'
import axios from '@/lib/api'

function formatDuration(ms) {
  if (!ms || !Number.isFinite(ms)) return '0:00'
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
}

function NowPlaying({ track }) {
  const [progress, setProgress] = useState(0)
  const [controlsEnabled, setControlsEnabled] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [controlError, setControlError] = useState('')
  const [volumePercent, setVolumePercent] = useState(null)
  const [editingVolume, setEditingVolume] = useState(false)
  const [volumeInput, setVolumeInput] = useState('')
  const [mutedVolume, setMutedVolume] = useState(null)
  const lastReceivedRef = useRef(null)
  const trackRef = useRef(null)

  useEffect(() => {
    axios.get('/api/config/public')
      .then(res => setControlsEnabled(!!res.data?.playback_controls_enabled))
      .catch(() => setControlsEnabled(false))
    axios.get('/api/playback/state')
      .then(res => {
        const v = res.data?.state?.volume_percent
        if (v !== null && v !== undefined) setVolumePercent(v)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!controlError) return
    const timer = setTimeout(() => setControlError(''), 4000)
    return () => clearTimeout(timer)
  }, [controlError])

  // Guards against double-taps client-side; the server also rate-limits and
  // serializes these calls so a burst of guests can't hammer Spotify at once.
  const sendControl = async (action, request) => {
    if (pendingAction) return
    setPendingAction(action)
    setControlError('')
    try {
      await request()
    } catch (error) {
      setControlError(error.response?.data?.error || 'Something went wrong.')
    } finally {
      setPendingAction(null)
    }
  }

  const handlePrevious = () => sendControl('previous', () => axios.post('/api/playback/previous'))
  const handleNext = () => sendControl('next', () => axios.post('/api/playback/next'))
  const handlePlayPause = () => sendControl('play-pause', () =>
    axios.post(track?.is_playing ? '/api/playback/pause' : '/api/playback/play')
  )
  const handleVolumeDown = () => {
    setMutedVolume(null)
    sendControl('volume-down', () =>
      axios.post('/api/playback/volume/down').then(res => {
        if (res.data?.volume_percent !== undefined) setVolumePercent(res.data.volume_percent)
      })
    )
  }
  const handleVolumeUp = () => {
    setMutedVolume(null)
    sendControl('volume-up', () =>
      axios.post('/api/playback/volume/up').then(res => {
        if (res.data?.volume_percent !== undefined) setVolumePercent(res.data.volume_percent)
      })
    )
  }
  const setExactVolume = (value) => sendControl('volume-set', () =>
    axios.post('/api/playback/volume', { volume: value }).then(res => {
      if (res.data?.volume_percent !== undefined) setVolumePercent(res.data.volume_percent)
    })
  )

  const handleVolumeClick = () => {
    if (pendingAction) return
    setVolumeInput(volumePercent === null ? '' : String(volumePercent))
    setEditingVolume(true)
  }
  const submitVolumeInput = () => {
    setEditingVolume(false)
    const parsed = Math.round(Number(volumeInput))
    if (!Number.isFinite(parsed)) return
    setMutedVolume(null)
    setExactVolume(Math.min(100, Math.max(0, parsed)))
  }
  const handleVolumeInputKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur()
    if (e.key === 'Escape') setEditingVolume(false)
  }

  const handleMuteToggle = () => {
    if (mutedVolume !== null) {
      const restore = mutedVolume
      setMutedVolume(null)
      setExactVolume(restore)
    } else {
      setMutedVolume(volumePercent ?? 0)
      setExactVolume(0)
    }
  }

  useEffect(() => {
    trackRef.current = track
    lastReceivedRef.current = Date.now()
    if (track?.duration_ms) {
      setProgress(((track.progress_ms ?? 0) / track.duration_ms) * 100)
    } else {
      setProgress(0)
    }
  }, [track])

  useEffect(() => {
    if (!track?.is_playing) return
    const timer = setInterval(() => {
      const t = trackRef.current
      const since = lastReceivedRef.current
      if (!t?.duration_ms || !since) return
      const currentMs = (t.progress_ms ?? 0) + (Date.now() - since)
      setProgress(Math.min((currentMs / t.duration_ms) * 100, 100))
    }, 500)
    return () => clearInterval(timer)
  }, [track?.id, track?.is_playing])

  const elapsedMs = track && lastReceivedRef.current
    ? Math.min((track.progress_ms ?? 0) + (Date.now() - lastReceivedRef.current), track.duration_ms ?? 0)
    : 0

  if (!track) {
    return (
      <div className="mb-6 rounded-xl border bg-card overflow-hidden">
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
          <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
            <Music className="h-8 w-8 opacity-30" />
          </div>
          <p className="text-sm font-medium">Nothing playing</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-xl border bg-card overflow-hidden">
      <div className="flex gap-3 sm:gap-4 p-3 sm:p-4">
        {track.album_art ? (
          <img src={track.album_art} alt={track.album} className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Music className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          {track.is_playing ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
              </span>
              Playing
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              <Pause className="h-2.5 w-2.5" />
              Paused
            </span>
          )}

          <div>
            <div className="font-semibold truncate">{track.name}</div>
            <div className="text-sm text-muted-foreground truncate">{track.artists}</div>
          </div>

          <div className="space-y-1">
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(Math.max(progress, 0), 100)}%`,
                  backgroundColor: track.is_playing ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)'
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>{formatDuration(elapsedMs)}</span>
              <span>{formatDuration(track.duration_ms)}</span>
            </div>
          </div>
        </div>
      </div>

      {controlsEnabled && (
        <div className="flex flex-col items-center gap-3 px-3 sm:px-4 pb-3 sm:pb-4 border-t pt-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleVolumeDown}
              disabled={!!pendingAction}
              aria-label="Volume down"
              className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            {editingVolume ? (
              <input
                type="number"
                min="0"
                max="100"
                autoFocus
                value={volumeInput}
                onChange={(e) => setVolumeInput(e.target.value)}
                onBlur={submitVolumeInput}
                onKeyDown={handleVolumeInputKeyDown}
                className="w-12 text-center text-sm font-mono tabular-nums bg-transparent border-b border-primary outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={handleVolumeClick}
                disabled={!!pendingAction}
                aria-label="Set exact volume"
                className="w-10 text-center text-sm font-mono tabular-nums text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {volumePercent === null ? '--' : volumePercent}
              </button>
            )}
            <button
              type="button"
              onClick={handleVolumeUp}
              disabled={!!pendingAction}
              aria-label="Volume up"
              className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleMuteToggle}
              disabled={!!pendingAction}
              aria-label={mutedVolume !== null ? 'Unmute' : 'Mute'}
              className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              {mutedVolume !== null ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={!!pendingAction}
              aria-label="Previous track"
              className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!!pendingAction}
              aria-label={track.is_playing ? 'Pause' : 'Play'}
              className="h-11 w-11 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              {track.is_playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!!pendingAction}
              aria-label="Next track"
              className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {controlError && (
        <div className="px-3 sm:px-4 pb-3 text-xs text-destructive">{controlError}</div>
      )}
    </div>
  )
}

export default NowPlaying
