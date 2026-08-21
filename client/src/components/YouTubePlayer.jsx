import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import axios from '@/lib/api'

const POLL_NEXT_MS = 3000
const REPORT_PROGRESS_MS = 2000

let apiPromise = null

// YouTube Music has no remote-control API, so the display page is the player.
function loadIframeApi() {
  if (apiPromise) return apiPromise
  apiPromise = new Promise(resolve => {
    if (window.YT?.Player) return resolve(window.YT)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiPromise
}

function YouTubePlayer({ enabled = true }) {
  const [started, setStarted] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [error, setError] = useState('')
  const mountRef = useRef(null)
  const playerRef = useRef(null)
  const currentRef = useRef(null)

  useEffect(() => {
    if (!enabled || !started) return
    let cancelled = false
    let nextTimer = null
    let reportTimer = null

    const report = () => {
      const player = playerRef.current
      const current = currentRef.current
      if (!player || !current || typeof player.getCurrentTime !== 'function') return
      axios.post('/api/queue/yt/progress', {
        row_id: current.row_id,
        position_ms: Math.round(player.getCurrentTime() * 1000),
        duration_ms: Math.round(player.getDuration() * 1000),
        is_playing: player.getPlayerState?.() === window.YT?.PlayerState?.PLAYING
      }).catch(() => {})
    }

    const finish = (skipped = false) => {
      const current = currentRef.current
      currentRef.current = null
      if (!current) return
      axios.post('/api/queue/yt/ended', { row_id: current.row_id, skipped }).catch(() => {})
    }

    const pollNext = async () => {
      if (cancelled || currentRef.current) return
      try {
        const { data } = await axios.get('/api/queue/yt/next')
        if (cancelled || !data.track || currentRef.current) {
          setWaiting(!data?.track)
          return
        }
        const player = playerRef.current
        if (typeof player?.loadVideoById !== 'function') return
        currentRef.current = data.track
        setWaiting(false)
        setError('')
        player.loadVideoById(data.track.id)
        player.playVideo?.()
      } catch {
        // display keeps polling; a transient failure just delays the next track
      }
    }

    loadIframeApi().then(YT => {
      if (cancelled) return
      playerRef.current = new YT.Player(mountRef.current, {
        height: '100%',
        width: '100%',
        playerVars: { autoplay: 1, controls: 1, disablekb: 1, playsinline: 1 },
        events: {
          onReady: event => {
            playerRef.current = event.target
            pollNext()
          },
          onStateChange: event => {
            if (event.data === YT.PlayerState.ENDED) {
              finish(false)
              pollNext()
            }
          },
          onError: event => {
            // Unplayable or region-blocked video: drop it rather than stall the queue
            setError(`Video unavailable (code ${event.data}); skipping`)
            finish(true)
            pollNext()
          }
        }
      })

      nextTimer = setInterval(pollNext, POLL_NEXT_MS)
      reportTimer = setInterval(report, REPORT_PROGRESS_MS)
    })

    return () => {
      cancelled = true
      clearInterval(nextTimer)
      clearInterval(reportTimer)
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [enabled, started])

  if (!enabled) return null

  if (!started) {
    return (
      <button
        type="button"
        onClick={() => setStarted(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg"
      >
        <Play className="h-4 w-4" />
        Start YouTube playback
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-56 rounded-lg overflow-hidden bg-black/80 shadow-lg">
      <div className="aspect-video">
        <div ref={mountRef} className="h-full w-full" />
      </div>
      <div className="px-2 py-1 text-[11px] text-white/60">
        {error || (waiting ? 'YouTube ready - queue is empty' : 'Playing from YouTube Music')}
      </div>
    </div>
  )
}

export default YouTubePlayer
