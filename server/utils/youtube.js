const YTMusicModule = require('ytmusic-api');

const YTMusic = YTMusicModule.default || YTMusicModule;

// YouTube Music has no official API; this client emulates the web player's requests.
// Initialisation fetches page config, so it is done once and reused.
let client = null;
let initializing = null;

async function getClient() {
  if (client) return client;
  if (!initializing) {
    const instance = new YTMusic();
    initializing = instance.initialize()
      .then(() => {
        client = instance;
        return client;
      })
      .catch(error => {
        initializing = null;
        throw error;
      });
  }
  return initializing;
}

function toTrack(song) {
  const thumbnails = song.thumbnails || [];
  return {
    id: song.videoId,
    name: song.name,
    artists: song.artist?.name || 'Unknown artist',
    album: song.album?.name || '',
    album_art: thumbnails[thumbnails.length - 1]?.url || null,
    duration_ms: (song.duration || 0) * 1000,
    uri: `https://music.youtube.com/watch?v=${song.videoId}`,
    explicit: false,
    provider: 'youtube'
  };
}

async function searchTracks(query, limit = 10) {
  try {
    const yt = await getClient();
    const songs = await yt.searchSongs(query);
    return songs.filter(s => s.videoId).slice(0, limit).map(toTrack);
  } catch (error) {
    console.error('Error searching YouTube Music:', error.message);
    throw new Error(`Failed to search YouTube Music: ${error.message}`);
  }
}

async function getTrack(videoId) {
  try {
    const yt = await getClient();
    return toTrack(await yt.getSong(videoId));
  } catch (error) {
    console.error('Error getting YouTube track:', error.message);
    throw new Error('Failed to get YouTube track');
  }
}

// Accepts youtube.com/watch?v=, youtu.be/, and music.youtube.com links
function parseYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

module.exports = {
  searchTracks,
  getTrack,
  parseYouTubeUrl
};
