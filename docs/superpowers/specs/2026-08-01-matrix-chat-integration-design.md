# Real Matrix chat integration — design

Date: 2026-08-01
Scope: `pxlcode-workplace-backend` and `vings-workplace-backend` Railway projects (shared
Matrix homeserver), plus front-end config changes on both `pxlcode-workplace` and `master`
branches.

## Background

The wave/ping toast and hover-preview popup's "Message" / quick-reply buttons (added in the
2026-07-31 office-ux-fixes batch) correctly detect that no `chatID` is resolvable and show
"Can't message - unavailable" — but investigation found this isn't a bug in that code. It's
because Matrix chat has never been connected in this deployment:

- `gameManager.getChatConnection()` (`play/src/front/Phaser/Game/GameManager.ts`) falls back to
  `VoidChatConnection` (a stub where every method throws or no-ops) whenever no Matrix homeserver
  URL is configured.
- `process-template.cjs` ships `MATRIX_PUBLIC_URI: undefined`, `MATRIX_DOMAIN: undefined`,
  `ENABLE_OPENID: false` for both branches today.
- `Room.ts:204` additionally gates `isMatrixChatEnabled` on `ENABLE_OPENID`, which also governs
  WorkAdventure's broader native login/admin system (`ConnectionManager.ts`'s
  `loadOpenIDScreen`/`logout` redirects, the "Sign in" prompt in `MenuStore.ts`).
- The actual Matrix login path the front-end code uses (`MatrixClientWrapper.ts`) requires a
  genuine `matrixLoginToken`, which only comes from Synapse's own SSO-redirect flow
  (`/_matrix/client/v3/login/sso/redirect` → OIDC provider → Synapse → pusher's
  `/matrix-callback`). There is no valid shortcut around this in the existing client code — a
  homeserver must actually be present and must actually authenticate the user itself.

This spec covers deploying a real Synapse homeserver and wiring it to both existing deployments'
already-built (but currently dead) Matrix integration code, plus bridging it with this
deployment's custom SSO gate so the extra login hop is invisible to the user in the common case.

## A. Synapse deployment

- One shared Synapse instance for both deployments, at `matrix.connectiumai.com`. Both
  `pxlcode-workplace-backend` and `vings-workplace-backend`'s `play` (pusher) services point at
  the same homeserver — one Matrix community across both front-ends, consistent with them
  already sharing the same LiveKit Cloud project from earlier session work.
- New Railway service in `vings-workplace-backend` (the project that owns the
  `office.connectiumai.com` domain, the natural home for a `matrix.connectiumai.com` subdomain),
  running the stock `matrixdotorg/synapse:v1.140.0` image already referenced in this repo's
  `docker-compose.yaml`.
- New Railway Postgres service in the same project, replacing the dev `sqlite3` database entry in
  `homeserver.template.yaml`.
- `pxlcode-workplace-backend`'s `play` (pusher) service gets the same `MATRIX_API_URI` (Synapse's
  internal Railway URL) and `MATRIX_DOMAIN`/`MATRIX_ADMIN_USER`/`MATRIX_ADMIN_PASSWORD` env vars
  as `vings-workplace-backend`'s, so both deployments' pusher services talk to the one homeserver.
- DNS: a CNAME for `matrix.connectiumai.com` pointing at the new Railway service, added by the
  user (they confirmed DNS access for `connectiumai.com`).

### `homeserver.template.yaml` changes (dev → production)

Starting from the existing template, for production:

- `server_name` / `public_baseurl`: `matrix.workadventure.localhost` → `matrix.connectiumai.com`.
- `database`: `sqlite3` block → `psycopg2` pointed at the new Railway Postgres service
  (`PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` env vars, standard Railway Postgres
  connection vars, substituted via the same `envsubst` mechanism `start.sh` already uses).
- `oidc_providers`: remove the `oidc-server-mock` entry (that's the local dev-only mock server at
  `http://oidc.workadventure.localhost`); add two real providers instead — see Section B.
- `jwt_config`: remove entirely. It's not the code path the front-end actually uses (see
  Background) and leaving a working JWT login mechanism enabled with a static secret when it's
  unused is unnecessary attack surface.
- **Security-critical, dev-only settings that must NOT ship to production:**
  - `enable_registration: true` + `enable_registration_without_verification: true` — as shipped,
    this lets anyone create a Matrix account with zero verification, register as anyone, and read
    the user directory. Set `enable_registration: false`. Accounts are only ever created via the
    OIDC login flow (Synapse auto-provisions a Matrix account on first successful OIDC login when
    `user_mapping_provider` is configured, which it already is) or via the existing admin-API path
    `matrixProvider.ts` already uses server-side.
  - `allow_guest_access: true` / `turn_allow_guests: true` — set `false`. Per Section C, guest
    game users never get a Matrix identity in this design; there's no scenario needing anonymous
    Matrix guest access.
  - `room_list_publication_rules: [{action: allow}]` (labeled "Development server only" in the
    template's own comment) — remove; use Synapse's default (private) room-listing behavior.
  - `auto_join_rooms` pointing at `#exampleroom:example.com` — remove, it's a dev placeholder.
- `sso.client_whitelist`: `http://pusher.workadventure.localhost/`, `http://play.workadventure.localhost/`
  → the real pusher/play URLs for both deployments (`https://play-production-*.up.railway.app`
  for each project — the OIDC redirect flow bounces through pusher, and this whitelist is what
  Synapse checks before allowing an SSO redirect target).
- `start.sh`: remove the "wait for the OIDC mock server" loop entirely (there is no mock server in
  production) — the script becomes: render the template via `envsubst`, run
  `synapse.app.homeserver --generate-config`, `chmod`, then hand off to Synapse's own start
  command. The `register_new_matrix_user` admin-bootstrap line (creating `MATRIX_ADMIN_USER`) is
  kept — that admin account is what `matrixProvider.ts` already uses server-side for its own admin
  API calls (room creation, etc.), independent of regular users' OIDC login.

## B. OIDC providers on Synapse (Google + Microsoft)

Two `oidc_providers` entries, mirroring the two options the existing custom SSO gate already
offers:

- **Google**: `idp_id: google`, using Synapse's built-in Google OIDC support
  (`issuer: https://accounts.google.com`). New (or extended) Google Cloud Console OAuth 2.0
  Client with an added authorized redirect URI:
  `https://matrix.connectiumai.com/_synapse/client/oidc/callback`.
- **Microsoft**: `idp_id: microsoft`, generic OIDC provider pointed at Azure AD's issuer
  (`https://login.microsoftonline.com/<tenant>/v2.0`). New (or extended) Azure AD App
  Registration with the same style of added redirect URI.
- `user_mapping_provider` on both: `localpart_template: "{{ user.email.split('@')[0] }}"`,
  `email_template: "{{ user.email }}"` — same pattern the existing mock-provider entry uses, so a
  user's Matrix ID is deterministically derived from their email (matches
  `matrixProvider.getBareMatrixIdFromEmail(email)`, already used server-side, staying consistent).

**Automatic trigger, not a visible second login:** right after the custom SSO gate script
(`process-template.cjs`'s `ssoGateScript`) confirms a Google/Microsoft login succeeded (the
`wa_user` cookie is set), the front-end calls `connectionManager.loadOpenIDScreen(false)`
(`ConnectionManager.ts`, already-existing method — `manuallyTriggered: false` since this isn't a
user-initiated click) once, before the game finishes booting. This redirects through pusher's
existing `/login-screen` → Synapse's `/login/sso/redirect` → the matching OIDC provider. Because
the user is typically already signed into Google/Microsoft in their browser (they just used it
seconds ago for the app's own SSO gate), this redirect usually auto-completes without requiring
another explicit login click — Synapse's own session cookie takes over on return visits, so this
only re-happens when Synapse's own session expires, not on every app load.

**Which Google/Microsoft app to use — user's call:** the design supports either reusing the exact
same OAuth app registrations the custom SSO gate already uses (simplest — one set of credentials,
users see the same "Sign in with Google/Microsoft — Connectium" consent screen, just with an
extra redirect URI added) or creating separate registrations specifically for Synapse. Since the
user confirmed they can manage the existing registrations, the plan defaults to **reusing the
existing apps** (fewer moving parts, one place to manage), with the option to split them later if
there's a reason to (e.g. different consent-screen branding for the Matrix-specific hop).

## C. Guest users

No change from the current behavior: guests (the "Continue as guest" path in the custom SSO gate)
never have an email, so `loadOpenIDScreen` is never triggered for them and they never get a
Matrix identity. Message/quick-reply continue showing "Can't message - unavailable" for guests —
this is already correctly handled by the existing 2026-07-31 batch's code (`resolveChatID()`
returning `undefined`), no changes needed there.

## D. Front-end config changes

`process-template.cjs`, both branches:

- `ENABLE_OPENID: true` (unlocks `Room.ts`'s `isMatrixChatEnabled` and the auto-trigger described
  in Section B; the "Sign in" prompt this also gates in `MenuStore.ts` is guarded on
  `!userIsConnected`, which becomes `true` automatically once the OIDC bridge completes for a
  logged-in user — so it should not visibly appear for already-authenticated users in the normal
  case).
- `MATRIX_PUBLIC_URI: 'https://matrix.connectiumai.com'`
- `MATRIX_DOMAIN` (used by front-end code paths that construct Matrix IDs directly, if any beyond
  what the server round-trip already provides): `'connectiumai.com'` — matches the `server_name`
  in Section A (kept as `connectiumai.com`, not the `matrix.` subdomain, per Matrix's convention
  that `server_name` is the domain part of user IDs like `@user:connectiumai.com`, distinct from
  the `public_baseurl` where the server is actually reachable — **flagged as a decision the
  implementer should double check against Synapse's actual `server_name` docs before finalizing**,
  since getting this backwards changes everyone's permanent Matrix ID).

## E. Backend (pusher) config changes

Both `pxlcode-workplace-backend` and `vings-workplace-backend`'s `play` service, new env vars:

- `MATRIX_API_URI`: Synapse's internal Railway URL (e.g.
  `http://synapse.railway.internal:8008/` — Railway's private networking, so this traffic never
  leaves Railway's internal network).
- `MATRIX_ADMIN_USER` / `MATRIX_ADMIN_PASSWORD`: the admin account `matrixProvider.ts` already
  expects, bootstrapped by `start.sh`'s `register_new_matrix_user` call.
- `MATRIX_DOMAIN`: same value as Section D.
- `OPENID_CLIENT_ID` (or `OPID_CLIENT_ID`): pusher's own `ENABLE_OPENID` check
  (`play/src/pusher/enums/EnvironmentVariable.ts:208`) is `!!env.OPENID_CLIENT_ID || !!env.OPID_CLIENT_ID`
  — needs *some* truthy value set for pusher's own `ENABLE_OPENID` to match the front-end's. Since
  this deployment isn't using WorkAdventure's stock OIDC-for-room-permissions system (only the
  Matrix-login side of the OIDC machinery), the exact value here needs verification against what
  `openIDClient`/`AuthenticateController.ts` actually validates it against at runtime — **flagged
  for the implementer to verify** rather than guessed here, since setting this incorrectly could
  either silently no-op (safe but broken) or attempt to validate against a nonexistent OIDC
  client (breaking pusher's `/login-screen` handling entirely).

## Error handling

- If Synapse is unreachable or an OIDC redirect fails, `loadOpenIDScreen`'s redirect chain already
  has existing error handling in `AuthenticateController.ts`/`ConnectionManager.ts` (this is
  stock WorkAdventure code, not something this spec adds) — worth a smoke test but not new design.
- If a user's Google/Microsoft login succeeds for the app's own SSO gate but the subsequent
  Synapse OIDC hop fails (e.g. they deny consent on the second, Matrix-specific prompt, or Synapse
  is down), the user should still be able to use the app normally — just without chat. This means
  `loadOpenIDScreen`'s trigger must not block or gate the main game-loading flow; it fires
  asynchronously and any failure there should be caught and logged (Sentry), not surfaced as a
  blocking error to the user.
- `resolveChatID()` returning `undefined` (in `WaveReceivedToast.svelte`/`PingReceivedToast.svelte`/
  `PersonHoverPreview.svelte`, from the 2026-07-31 batch) already handles the "chat still isn't
  available for this person" case correctly — no changes needed to that code. It now also covers
  a transient case (their Matrix OIDC hop hasn't completed yet) in addition to the guest case.

## Testing

- No automated test coverage is planned for the Synapse deployment itself (infrastructure, not
  application code) — verified via manual smoke test post-deploy: complete Google/Microsoft login
  on the live site, confirm a Matrix account was created (checkable via Synapse's admin API using
  `MATRIX_ADMIN_USER`), confirm `userIsConnected` becomes `true`, confirm Message/quick-reply on a
  wave toast actually delivers a message end-to-end between two real accounts.
- Guest flow regression check: confirm guests still see "Can't message - unavailable" (unchanged)
  and are not blocked or slowed by the OIDC-trigger logic added for SSO users.

## Out of scope

- Federation with other Matrix homeservers (this is a private, single-server deployment for this
  organization only — no interest in talking to matrix.org or other public servers).
- Migrating the existing "proximity chat" system (WebSocket-based, works today, unrelated to
  Matrix) to Matrix — they remain two separate systems serving different purposes (in-the-moment
  proximity conversation vs. persistent direct messages).
- Mobile push notifications for Matrix messages, end-to-end encryption configuration review
  (Synapse ships with e2ee support by default; whether to require/encourage it for this
  deployment is a follow-up decision, not blocking initial rollout).
