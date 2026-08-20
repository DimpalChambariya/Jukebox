const express = require('express');
const { getDb } = require('../db');
const { getConfig } = require('../utils/config');
const { skipToNext, skipToPrevious, resumePlayback, pausePlayback, adjustVolume, setVolume, getPlaybackState } = require('../utils/spotify');

const router = express.Router();
const db = getDb();

function requireFingerprint(req, res) {
  const fingerprintId = req.cookies.fingerprint_id;
  if (!fingerprintId) {
    res.status(400).json({ error: 'Missing device fingerprint. Please refresh the page.' });
    return null;
  }
  const fingerprint = db.prepare('SELECT status FROM fingerprints WHERE id = ?').get(fingerprintId);
  if (fingerprint?.status === 'blocked') {
    res.status(403).json({ error: 'This device has been blocked by the host.' });
    return null;
  }
  return fingerprintId;
}

function playbackControlsEnabled() {
  return getConfig('playback_controls_enabled') !== 'false';
}

function handleControlError(error, res) {
  console.error('Playback control error:', error.message);
  const status = /no active spotify device/i.test(error.message) ? 404 : 500;
  res.status(status).json({ error: error.message || 'Playback control failed' });
}

// Every request here is funneled through utils/spotify.js's shared queue,
// which serializes calls to Spotify and spaces them out (~1/sec). That's
// what stops a room full of guests tapping at once from looking like a
// burst of automated traffic to Spotify - not a per-person cap. Nobody in
// the room is rate-limited individually.

router.post('/next', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  try {
    await skipToNext();
    res.json({ ok: true });
  } catch (error) {
    handleControlError(error, res);
  }
});

router.post('/previous', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  try {
    await skipToPrevious();
    res.json({ ok: true });
  } catch (error) {
    handleControlError(error, res);
  }
});

router.post('/play', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  try {
    await resumePlayback();
    res.json({ ok: true });
  } catch (error) {
    handleControlError(error, res);
  }
});

router.post('/pause', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  try {
    await pausePlayback();
    res.json({ ok: true });
  } catch (error) {
    handleControlError(error, res);
  }
});

const VOLUME_STEP = 2;

router.post('/volume/:direction(up|down)', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  try {
    const delta = req.params.direction === 'up' ? VOLUME_STEP : -VOLUME_STEP;
    const volume_percent = await adjustVolume(delta);
    res.json({ ok: true, volume_percent });
  } catch (error) {
    handleControlError(error, res);
  }
});

// Set an exact volume (0-100) - used by the editable volume field and mute/unmute.
router.post('/volume', async (req, res) => {
  const fingerprintId = requireFingerprint(req, res);
  if (!fingerprintId) return;
  if (!playbackControlsEnabled()) {
    return res.status(403).json({ error: 'Playback controls are disabled.' });
  }
  const requested = Number(req.body?.volume);
  if (!Number.isFinite(requested)) {
    return res.status(400).json({ error: 'volume must be a number between 0 and 100.' });
  }
  try {
    const volume_percent = await setVolume(requested);
    res.json({ ok: true, volume_percent });
  } catch (error) {
    handleControlError(error, res);
  }
});

router.get('/state', async (req, res) => {
  try {
    const state = await getPlaybackState();
    res.json({ state });
  } catch (error) {
    res.json({ state: null });
  }
});

module.exports = router;
