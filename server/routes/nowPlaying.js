const express = require('express');
const { getNowPlaying, getQueue, skipToNext } = require('../utils/spotify');
const { getLyrics } = require('../utils/lyrics');
const { getConfig } = require('../utils/config');
const { getDb } = require('../db');

const router = express.Router();
const db = getDb();
const lyricsCache = new Map();
const lyricsFailureCache = new Map();
const LYRICS_RETRY_AFTER_MS = 5 * 60 * 1000; // Don't retry failed tracks for 5 minutes

function ensureLyricsFetch(track, cacheKey) {
  if (!track || !cacheKey) return;
  if (lyricsCache.has(cacheKey)) return;
  const failedAt = lyricsFailureCache.get(cacheKey);
  if (failedAt && Date.now() - failedAt < LYRICS_RETRY_AFTER_MS) return;

  getLyrics(track.name, track.artists, track.id)
    .then(lyrics => {
      if (lyrics) {
        lyricsCache.set(cacheKey, lyrics);
        lyricsFailureCache.delete(cacheKey);
      } else {
        lyricsFailureCache.set(cacheKey, Date.now());
      }
    })
    .catch(() => {
      lyricsFailureCache.set(cacheKey, Date.now());
    });
}

// If the currently-playing track has racked up this many downvotes, skip it
// automatically. Guarded by lastAutoSkippedTrackId so we only fire skipToNext
// once per "reign" of a track, instead of once per poll while Spotify catches up.
const DOWNVOTE_SKIP_THRESHOLD = 2;
let lastAutoSkippedTrackId = null;

function maybeAutoSkipDownvoted(track) {
  if (!track?.id) return;
  if (getConfig('voting_enabled') !== 'true') return;
  if (getConfig('voting_downvote_enabled') === 'false') return;
  if (lastAutoSkippedTrackId === track.id) return;

  const row = db.prepare('SELECT COUNT(*) as count FROM votes WHERE track_id = ? AND direction = -1').get(track.id);
  if ((row?.count || 0) >= DOWNVOTE_SKIP_THRESHOLD) {
    lastAutoSkippedTrackId = track.id;
    skipToNext().catch((err) => {
      console.error('Auto-skip downvoted track failed:', err.message);
    });
  }
}

// The client polls this every 3s per open guest tab. Without caching, 5-6
// guests sitting on the page for hours turns into two Spotify calls (this
// track, plus the queue lookup below) every 3s PER TAB - by far the biggest
// source of Spotify API traffic in the whole app, unrelated to button
// presses. Cache it so the server hits Spotify at most once per window no
// matter how many guests are polling.
const NOW_PLAYING_CACHE_TTL = 2500;
let nowPlayingCache = null;
let nowPlayingCacheExpiry = 0;

// Only used to warm the lyrics cache ahead of time; doesn't need to be as
// fresh as the currently-playing track itself.
const QUEUE_FOR_LYRICS_CACHE_TTL = 15000;
let queueForLyricsCache = null;
let queueForLyricsCacheExpiry = 0;

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (nowPlayingCache && nowPlayingCacheExpiry > now) {
      maybeAutoSkipDownvoted(nowPlayingCache.track);
      return res.json(nowPlayingCache);
    }

    const nowPlaying = await getNowPlaying();
    maybeAutoSkipDownvoted(nowPlaying);

    if (nowPlaying) {
      const cacheKey = nowPlaying.id;
      if (lyricsCache.has(cacheKey)) {
        nowPlaying.lyrics = lyricsCache.get(cacheKey);
      } else {
        ensureLyricsFetch(nowPlaying, cacheKey);
      }
    }

    // Pre-fetch lyrics for the next song(s) in queue so they're ready when the track changes
    try {
      if (!queueForLyricsCache || queueForLyricsCacheExpiry <= now) {
        queueForLyricsCache = await getQueue();
        queueForLyricsCacheExpiry = now + QUEUE_FOR_LYRICS_CACHE_TTL;
      }
      const queue = queueForLyricsCache?.queue;
      if (queue?.length > 0) {
        for (let i = 0; i < Math.min(queue.length, 2); i++) {
          const next = queue[i];
          ensureLyricsFetch(next, next.id);
        }
      }
    } catch {
      // Non-critical; continue with response
    }

    const payload = { track: nowPlaying };
    nowPlayingCache = payload;
    nowPlayingCacheExpiry = now + NOW_PLAYING_CACHE_TTL;

    res.json(payload);
  } catch (error) {
    console.error('Now playing error:', error);
    res.json({ track: null });
  }
});

module.exports = router;

