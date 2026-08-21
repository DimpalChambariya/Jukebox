const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getConfig } = require('../utils/config');
const { getGuestAuthRequirements, sendAuthRequiredResponse } = require('../utils/guest-auth');
const { getTrack, addToQueue, getQueue, parseSpotifyUrl } = require('../utils/spotify');
const youtube = require('../utils/youtube');
const { requireAdminSession } = require('../middleware/adminSession');

const router = express.Router();

router.post('/submit', async (req, res) => {
  const db = getDb();
  const prequeueEnabled = getConfig('prequeue_enabled') === 'true';

  if (!prequeueEnabled) {
    return res.status(503).json({ error: 'Prequeue is currently disabled.' });
  }

  const fingerprintId = req.body.fingerprint_id || req.cookies.fingerprint_id;
  let provider = req.body.provider === 'youtube' ? 'youtube' : 'spotify';
  let trackId = req.body.track_id;

  if (!fingerprintId) return res.status(400).json({ error: 'Missing fingerprint' });

  const fingerprint = db.prepare('SELECT * FROM fingerprints WHERE id = ?').get(fingerprintId);
  if (!fingerprint) return res.status(400).json({ error: 'Could not fingerprint your device.' });

  const authReq = getGuestAuthRequirements(fingerprint);
  if (authReq.authRequired) return sendAuthRequiredResponse(res, authReq);

  const requireUsername = getConfig('require_username') === 'true';
  if (requireUsername && !fingerprint.username) {
    return res.status(400).json({ error: 'Username is required. Please refresh the page and enter your username.' });
  }

  if (!trackId && req.body.track_url) {
    const youtubeId = youtube.parseYouTubeUrl(req.body.track_url);
    provider = youtubeId ? 'youtube' : 'spotify';
    trackId = youtubeId || parseSpotifyUrl(req.body.track_url);
    if (!trackId) return res.status(400).json({ error: 'Unrecognised link. Paste a Spotify or YouTube track URL.' });
  }

  if (!trackId) return res.status(400).json({ error: 'Missing track ID or URL' });

  const sourceEnabled = provider === 'youtube'
    ? getConfig('youtube_enabled') === 'true'
    : getConfig('spotify_enabled') !== 'false';
  if (!sourceEnabled) {
    return res.status(503).json({ error: `${provider === 'youtube' ? 'YouTube Music' : 'Spotify'} is currently disabled.` });
  }

  try {
    const trackInfo = provider === 'youtube' ? await youtube.getTrack(trackId) : await getTrack(trackId);

    const maxDuration = parseInt(getConfig('max_song_duration') || '0');
    if (maxDuration > 0 && trackInfo.duration_ms > maxDuration * 1000) {
      return res.status(403).json({ error: 'Song is too long.' });
    }

    if (provider === 'youtube') {
      const inYtQueue = db.prepare("SELECT 1 FROM yt_queue WHERE video_id = ? AND status IN ('queued', 'playing')").get(trackId);
      if (inYtQueue) return res.status(409).json({ error: 'This song is already in the queue.' });
    } else {
      try {
        const currentQueue = await getQueue();
        const isDup = currentQueue.queue.some(t => t.id === trackId) ||
          (currentQueue.currently_playing && currentQueue.currently_playing.id === trackId);
        if (isDup) return res.status(409).json({ error: 'This song is already in the queue.' });
      } catch (e) { /* ignore */ }
    }

    const existingPending = db.prepare("SELECT * FROM prequeue WHERE track_id = ? AND status = 'pending'").get(trackId);
    if (existingPending) return res.status(409).json({ error: 'This song is already pending approval.' });

    const prequeueId = crypto.randomBytes(8).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO prequeue (id, fingerprint_id, track_id, track_name, artist_name, album_art, provider, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(prequeueId, fingerprintId, trackId, trackInfo.name, trackInfo.artists, trackInfo.album_art || null, provider, now);

    res.json({ success: true, prequeue_id: prequeueId, message: 'Track submitted for approval' });
  } catch (error) {
    console.error('Prequeue error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit track' });
  }
});

router.post('/approve/:prequeueId', requireAdminSession, async (req, res) => {
  const db = getDb();
  const { prequeueId } = req.params;

  try {
    const prequeue = db.prepare('SELECT * FROM prequeue WHERE id = ?').get(prequeueId);
    if (!prequeue) return res.status(404).json({ error: 'Prequeue entry not found' });
    if (prequeue.status !== 'pending') return res.status(400).json({ error: 'Track already processed' });

    if (prequeue.provider === 'youtube') {
      const trackInfo = await youtube.getTrack(prequeue.track_id);
      db.prepare(`
        INSERT INTO yt_queue (video_id, track_name, artist_name, album_art, duration_ms, fingerprint_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(trackInfo.id, trackInfo.name, trackInfo.artists, trackInfo.album_art || null, trackInfo.duration_ms || null, prequeue.fingerprint_id);
    } else {
      const trackInfo = await getTrack(prequeue.track_id);
      await addToQueue(trackInfo.uri);
    }

    db.prepare('UPDATE prequeue SET status = ?, approved_by = ? WHERE id = ?').run('approved', req.body.approved_by || 'admin', prequeueId);

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO queue_attempts (fingerprint_id, track_id, track_name, artist_name, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(prequeue.fingerprint_id, prequeue.track_id, prequeue.track_name, prequeue.artist_name, 'success', now);

    res.json({ success: true, message: `Approved: ${prequeue.track_name}` });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: error.message || 'Failed to approve track' });
  }
});

router.post('/decline/:prequeueId', requireAdminSession, async (req, res) => {
  const db = getDb();
  const { prequeueId } = req.params;

  try {
    const prequeue = db.prepare('SELECT * FROM prequeue WHERE id = ?').get(prequeueId);
    if (!prequeue) return res.status(404).json({ error: 'Prequeue entry not found' });
    if (prequeue.status !== 'pending') return res.status(400).json({ error: 'Track already processed' });

    db.prepare('UPDATE prequeue SET status = ?, approved_by = ? WHERE id = ?').run('declined', req.body.approved_by || 'admin', prequeueId);

    res.json({ success: true, message: `Declined: ${prequeue.track_name}` });
  } catch (error) {
    console.error('Decline error:', error);
    res.status(500).json({ error: error.message || 'Failed to decline track' });
  }
});

router.get('/pending', requireAdminSession, (req, res) => {
  const db = getDb();
  try {
    const pending = db.prepare("SELECT * FROM prequeue WHERE status = 'pending' ORDER BY created_at DESC").all();
    res.json({ pending });
  } catch (error) {
    console.error('Pending error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

module.exports = router;
