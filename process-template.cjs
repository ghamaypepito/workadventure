const fs = require('fs');

const indexPath = 'play/dist/public/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

const PLAY_URL = 'https://vings-workplace.vercel.app';
const PUSHER_URL = 'https://play-production-7ae3.up.railway.app';
const BACK_URL = 'https://back-production-76cc.up.railway.app';
const MAP_STORAGE_URL = 'https://map-storage-production.up.railway.app';

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
    WOKA_SPEED: 3,
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
    MATRIX_PUBLIC_URI: undefined,
    MATRIX_ADMIN_USER: undefined,
    MATRIX_DOMAIN: undefined,
    ENABLE_CHAT: false,
    ENABLE_CHAT_ONLINE_LIST: false,
    ENABLE_CHAT_DISCONNECTED_LIST: false,
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
const windowEnvJs = `window.env = ${JSON.stringify(windowEnv)};\nwindow.capabilities = {};`;

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

fs.writeFileSync(indexPath, html);
console.log('index.html template variables substituted successfully.');
console.log('PUSHER_URL set to:', PUSHER_URL);
