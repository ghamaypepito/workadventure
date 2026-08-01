const fs = require('fs');

const indexPath = 'play/dist/public/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

const PLAY_URL = 'https://vings-workplace.vercel.app';
const PUSHER_URL = 'https://play-production-7ae3.up.railway.app';
const BACK_URL = 'https://back-production-76cc.up.railway.app';
const MAP_STORAGE_URL = 'https://map-storage-production.up.railway.app';
// Short deployment label shown at the top-left of the persistent top bar (see TopBar.svelte),
// to visually distinguish this deployment from other WorkAdventure instances built off the
// same repo (e.g. pxlcode-workplace). Deliberately a separate global, not a field on windowEnv
// below - that object is validated against a strict schema (EnvironmentVariable.ts) and an
// unrecognized field there would need touching that schema for no functional reason.
const OFFICE_NAME = 'ConnectiumAI Office';

// Inject window.env config (replaces server-side Mustache {{{ script }}} block)
const windowEnv = {
    DEBUG_MODE: false,
    PUSHER_URL: PUSHER_URL,
    FRONT_URL: PLAY_URL,
    ADMIN_URL: undefined,
    UPLOADER_URL: BACK_URL,
    ICON_URL: 'https://icon.horse/icon',
    SKIP_RENDER_OPTIMIZATIONS: false,
    DISABLE_NOTIFICATIONS: false,
    JITSI_URL: undefined,
    JITSI_PRIVATE_MODE: false,
    ENABLE_MAP_EDITOR: true,
    PUBLIC_MAP_STORAGE_PREFIX: MAP_STORAGE_URL,
    MAX_USERNAME_LENGTH: 16,
    MAX_PER_GROUP: 4,
    MAX_DISPLAYED_VIDEOS: 15,
    LIVEKIT_PIXEL_DENSITY: 1,
    NODE_ENV: 'production',
    CONTACT_URL: undefined,
    POSTHOG_API_KEY: undefined,
    POSTHOG_URL: undefined,
    DISABLE_ANONYMOUS: false,
    ENABLE_OPENID: false,
    OPID_PROFILE_SCREEN_PROVIDER: undefined,
    ENABLE_CHAT_UPLOAD: false,
    FALLBACK_LOCALE: undefined,
    OPID_WOKA_NAME_POLICY: undefined,
    ENABLE_REPORT_ISSUES_MENU: false,
    REPORT_ISSUES_URL: undefined,
    CLIENT_DISCONNECTION_RETENTION_MS: 10000,
    SENTRY_DSN_FRONT: undefined,
    SENTRY_DSN_PUSHER: undefined,
    SENTRY_ENVIRONMENT: undefined,
    SENTRY_RELEASE: undefined,
    SENTRY_TRACES_SAMPLE_RATE: undefined,
    WOKA_SPEED: 20,
    FEATURE_FLAG_BROADCAST_AREAS: true,
    KLAXOON_ENABLED: false,
    KLAXOON_CLIENT_ID: undefined,
    YOUTUBE_ENABLED: true,
    GOOGLE_DRIVE_ENABLED: false,
    GOOGLE_DOCS_ENABLED: false,
    GOOGLE_SHEETS_ENABLED: false,
    GOOGLE_SLIDES_ENABLED: false,
    ERASER_ENABLED: false,
    MINIMUM_DISTANCE: 64,
    GOOGLE_DRIVE_PICKER_CLIENT_ID: undefined,
    GOOGLE_DRIVE_PICKER_APP_ID: undefined,
    EXCALIDRAW_ENABLED: true,
    EXCALIDRAW_DOMAINS: ['excalidraw.com'],
    CARDS_ENABLED: false,
    TLDRAW_ENABLED: false,
    EMBEDLY_KEY: undefined,
    MATRIX_PUBLIC_URI: 'https://matrix.connectiumai.com',
    MATRIX_ADMIN_USER: undefined,
    MATRIX_DOMAIN: 'connectiumai.com',
    ENABLE_CHAT: true,
    ENABLE_CHAT_ONLINE_LIST: true,
    ENABLE_CHAT_DISCONNECTED_LIST: true,
    ENABLE_SAY: true,
    ENABLE_ISSUE_REPORT: false,
    GRPC_MAX_MESSAGE_SIZE: 4194304,
    TURN_CREDENTIALS_RENEWAL_TIME: 270,
    BACKGROUND_TRANSFORMER_ENGINE: undefined,
    DEFAULT_WOKA_NAME: undefined,
    DEFAULT_WOKA_TEXTURE: undefined,
    SKIP_CAMERA_PAGE: false,
    BYPASS_PWA: true,
    PROVIDE_DEFAULT_WOKA_NAME: undefined,
    PROVIDE_DEFAULT_WOKA_TEXTURE: undefined,
    ENABLE_TUTORIAL: false,
};

// The play service injects both window.env and window.capabilities into the same <script> block.
// On Vercel (static SPA), we must bake both in. window.capabilities = {} mirrors no-admin-API behavior.
const windowEnvJs = `window.env = ${JSON.stringify(
    windowEnv,
)};\nwindow.capabilities = {};\nwindow.__waOfficeName = ${JSON.stringify(OFFICE_NAME)};`;

// Replace the triple-stash {{{ script }}} block (the template already has a <script> wrapper)
html = html.replace(/\{\{\{[^}]*script[^}]*\}\}\}/g, windowEnvJs);

// Set meta variables
html = html.replace(/\{\{ title \}\}/g, 'WorkAdventure - Vings Workplace');
html = html.replace(/\{\{ description \}\}/g, 'A collaborative virtual office presented as a 16-bit RPG video game');
html = html.replace(/\{\{ author \}\}/g, 'WorkAdventure');
html = html.replace(/\{\{ provider \}\}/g, 'WorkAdventure');
html = html.replace(/\{\{ themeColor \}\}/g, '#000000');
html = html.replace(/\{\{ url \}\}/g, PLAY_URL);
html = html.replace(/\{\{ cardImage \}\}/g, '');
html = html.replace(/\{\{ msApplicationTileImage \}\}/g, '');

// Remove optional conditional blocks
html = html.replace(/\{\{#favIcons\}\}[\s\S]*?\{\{\/favIcons\}\}/g, '');
html = html.replace(/\{\{#posthogApiKey\}\}[\s\S]*?\{\{\/posthogApiKey\}\}/g, '');
html = html.replace(/\{\{#posthogUrl\}\}[\s\S]*?\{\{\/posthogUrl\}\}/g, '');
html = html.replace(/\{\{#logRocketId\}\}[\s\S]*?\{\{\/logRocketId\}\}/g, '');
html = html.replace(/\{\{#googleDrivePickerClientId\}\}[\s\S]*?\{\{\/googleDrivePickerClientId\}\}/g, '');

// Strip any remaining template variables
html = html.replace(/\{\{\{[^}]+\}\}\}/g, '');
html = html.replace(/\{\{[^}]+\}\}/g, '');

// Inject a script that unregisters all service workers immediately on load.
// Without a backend to manage cache manifests, the SW update loop fires on every deploy.
const swUnregisterScript = `<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(r) { r.unregister(); });
  });
}
</script>`;
html = html.replace('</head>', swUnregisterScript + '</head>');

// SSO gate: full-screen overlay shown before the game boots. Reads the wa_user cookie
// (set by /api/auth/*-callback) to detect an existing session, or a guest bypass in
// sessionStorage. On authenticated login, pre-fills localStorage.playerName so the
// WorkAdventure name-entry screen is skipped for that field. Also handles the
// "pending approval" status set by the admin approve/deny system.
const ssoGateScript = `<script>
(function () {
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function showGate() {
    const overlay = document.createElement('div');
    overlay.id = 'sso-gate-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:2rem;text-align:center;';
    overlay.innerHTML =
      '<h1 style="font-size:1.8rem;margin-bottom:0.5rem;">Sign in to continue</h1>' +
      '<p style="color:#94a3b8;margin-bottom:2rem;">Sign in with your work account before creating your character.</p>' +
      '<div style="display:flex;flex-direction:column;gap:0.75rem;width:100%;max-width:320px;">' +
      '<a href="/api/auth/google?returnTo=' + encodeURIComponent(window.location.href) + '" style="background:#fff;color:#1f2937;padding:0.75rem 1rem;border-radius:8px;text-decoration:none;font-weight:600;">Sign in with Google</a>' +
      '<a href="/api/auth/microsoft?returnTo=' + encodeURIComponent(window.location.href) + '" style="background:#2564cf;color:#fff;padding:0.75rem 1rem;border-radius:8px;text-decoration:none;font-weight:600;">Sign in with Microsoft</a>' +
      '<button id="sso-gate-guest" style="background:transparent;color:#94a3b8;border:1px solid #334155;padding:0.75rem 1rem;border-radius:8px;font-weight:600;cursor:pointer;">Continue as guest</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('sso-gate-guest').addEventListener('click', function () {
      sessionStorage.setItem('sso_gate_guest', '1');
      overlay.remove();
    });
  }

  function showPendingScreen(user) {
    const overlay = document.createElement('div');
    overlay.id = 'sso-gate-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:2rem;text-align:center;';
    overlay.innerHTML =
      '<h1 style="font-size:1.8rem;margin-bottom:0.5rem;">Waiting for approval</h1>' +
      '<p style="color:#94a3b8;max-width:400px;">Hi ' + (user.name || '') + ', your request to join has been sent to an admin. ' +
      'You will be able to enter once approved. Try refreshing this page later.</p>' +
      '<a href="/api/auth/logout" style="margin-top:2rem;color:#64748b;text-decoration:underline;font-size:0.85rem;">Sign out</a>';
    document.body.appendChild(overlay);
  }

  const userCookie = getCookie('wa_user');
  if (userCookie) {
    try {
      const user = JSON.parse(userCookie);
      window.__waIsAdmin = user.isAdmin === true;
      if (user.status === 'pending') {
        showPendingScreen(user);
        return;
      }
      if (user.name) localStorage.setItem('playerName', user.name);
    } catch (e) {}
    return;
  }

  if (sessionStorage.getItem('sso_gate_guest') === '1') {
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showGate);
  } else {
    showGate();
  }
})();
</script>`;
html = html.replace('</head>', ssoGateScript + '</head>');

// Session supersession poll: while signed in (wa_user cookie present), periodically check
// whether this session is still the active one for its email. /api/auth/session-status
// already clears the wa_session/wa_user cookies server-side the moment it detects another
// device has signed in with the same email - this just notices that and reloads so the
// SSO gate reappears, instead of leaving a silently-logged-out session sitting in the game.
const sessionPollScript = `<script>
(function () {
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function pollSessionStatus() {
    if (!getCookie('wa_user')) return;
    fetch('/api/auth/session-status', { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.authenticated) {
          window.location.reload();
        }
      })
      .catch(function () {});
  }

  setInterval(pollSessionStatus, 30000);
})();
</script>`;
html = html.replace('</head>', sessionPollScript + '</head>');

fs.writeFileSync(indexPath, html);
console.log('index.html template variables substituted successfully.');
console.log('PUSHER_URL set to:', PUSHER_URL);
