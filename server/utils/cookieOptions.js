// Cookies set here (fingerprint_id, oauth state) need different settings
// depending on deployment shape:
//  - same-origin over plain HTTP (this repo's docker-compose default):
//    secure must be false or browsers refuse to store the cookie at all.
//  - cross-site over HTTPS (frontend on Vercel, API on Render): the cookie
//    is sent on a cross-origin fetch, which browsers only allow when
//    SameSite=None, and SameSite=None requires Secure.
// COOKIE_SECURE (already used by sessionMiddleware.js) is the single knob:
// set it 'true' only when actually served over HTTPS.
function getCrossOriginCookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true';
  return {
    secure,
    sameSite: secure ? 'none' : 'lax'
  };
}

module.exports = { getCrossOriginCookieOptions };
