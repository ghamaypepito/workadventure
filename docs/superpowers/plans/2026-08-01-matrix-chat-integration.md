# Real Matrix Chat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a real Synapse (Matrix) homeserver at `matrix.connectiumai.com`, shared by both `pxlcode-workplace-backend` and `vings-workplace-backend`, and wire it into both deployments' already-built (currently dead) Matrix chat code, so the "Message" / quick-reply features shipped in the 2026-07-31 office-ux-fixes batch actually work for Google/Microsoft-authenticated users.

**Architecture:** A new Railway service running the stock `matrixdotorg/synapse:v1.140.0` image plus a Postgres database, configured with real Google and Microsoft OIDC providers. Right after the existing custom SSO gate confirms a login, the front-end silently triggers WorkAdventure's existing native OIDC-to-Matrix bridge (`ConnectionManager.loadOpenIDScreen`), which the app already has fully built — nothing about that bridge is new code, it's just never had a working homeserver to talk to. Guests get no Matrix identity and keep seeing "Can't message - unavailable," unchanged from today.

**Tech Stack:** Railway CLI (service/database provisioning), Docker (Synapse image), YAML (`homeserver.yaml`), TypeScript (pusher env var consumption — no new pusher code, see Global Constraints), `process-template.cjs` (front-end build-time config).

## Global Constraints

- Shared homeserver: one Synapse instance for both deployments, not two.
- No new pusher application code. `AuthenticateController.ts`, `MatrixProvider.ts`, `JWTTokenManager.ts`, and `MatrixClientWrapper.ts` already implement the full OIDC-to-Matrix-login bridge — this plan only supplies the homeserver and the env vars/config those already expect. If a task in this plan seems to need new pusher code, stop and reread the spec's Background section — that's a signal something was misunderstood.
- `jwt_config` is explicitly removed from the production `homeserver.yaml` (not used by any real code path — see spec's Background section correction).
- Production `homeserver.yaml` must NOT ship with `enable_registration: true`, `enable_registration_without_verification: true`, `allow_guest_access: true`, `turn_allow_guests: true`, or the dev-only `room_list_publication_rules`/`auto_join_rooms` entries — these are the local-dev template's values and are security-inappropriate for a public deployment.
- Every code/config commit follows the existing session workflow: commit on `pxlcode-workplace`, push, cherry-pick to `master`, push, verify both live bundle hashes change — for tasks that touch front-end files. Backend/Railway-only tasks (Synapse, env vars) don't involve this branch workflow at all; they're pure `railway` CLI operations against the two backend projects.
- Two values are flagged in the spec as needing verification during implementation rather than being fully certain ahead of time: `MATRIX_DOMAIN`'s exact value (`connectiumai.com` vs `matrix.connectiumai.com`) and pusher's `OPENID_CLIENT_ID`/`OPID_CLIENT_ID` semantics. Tasks 6 and 8 below include the verification steps for these — do not skip them.

---

## Task 1: Provision Synapse + Postgres on Railway

**Files:** none (Railway infrastructure only)

**Interfaces:**
- Produces: a running Synapse container (not yet configured — Task 3 supplies real config) and a Postgres database, both in the `vings-workplace-backend` Railway project, plus their Railway-internal connection details for Task 3 to consume.

- [ ] **Step 1: Link to the `vings-workplace-backend` Railway project**

```bash
railway link -p vings-workplace-backend
```

Expected: prompts for environment (choose `production`) and confirms linking, matching the pattern already used earlier this session for `pxlcode-workplace-backend`.

- [ ] **Step 2: Add a Postgres database for Synapse**

```bash
railway add --database postgres --service synapse-postgres --json
```

Expected: JSON output confirming a new Postgres service named `synapse-postgres` was created. Note the service name — later steps reference it.

- [ ] **Step 3: Add the Synapse service from the stock Docker image**

```bash
railway add --image matrixdotorg/synapse:v1.140.0 --service synapse --json
```

Expected: JSON output confirming a new service named `synapse` was created from that image. This service has no config yet — it will fail to start correctly until Task 3 supplies `homeserver.yaml` (Synapse's default entrypoint expects `/data/homeserver.yaml`; without it, the container will log a startup error, which is expected and fine at this stage — do not troubleshoot it yet).

- [ ] **Step 4: Record Postgres connection details for Task 3**

```bash
railway variables --service synapse-postgres --kv
```

Expected: KV output including `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (Railway's standard Postgres variable names) or `DATABASE_URL`. Copy these values (or the single `DATABASE_URL`) — Task 3's `homeserver.template.yaml` database block needs them, and Task 4 sets them as variables on the `synapse` service so `envsubst` can pick them up at container start.

- [ ] **Step 5: Report status**

No commit for this task (pure infrastructure provisioning, no repo changes). Note the `synapse` and `synapse-postgres` service names and the Postgres connection details in your task report for Task 3/4 to consume.

---

## Task 2: DNS and custom domain — user checkpoint

**Files:** none

**Interfaces:**
- Consumes: the `synapse` service from Task 1.
- Produces: a working public HTTPS endpoint at `matrix.connectiumai.com` routed to the `synapse` Railway service.

This task requires the user's action (DNS access) — it cannot be completed by an agent alone.

- [ ] **Step 1: Generate the Railway custom-domain target**

```bash
railway domain matrix.connectiumai.com --service synapse
```

Expected: Railway either confirms the domain was added and prints the CNAME target to configure (something like `<random>.up.railway.app`), or prompts you to add DNS first if it can't auto-verify. Capture the exact CNAME target value from the output.

- [ ] **Step 2: STOP — hand off to the user**

Do not proceed past this step without the user confirming DNS is live. Report back to the user (or, if this task is being run by a subagent, escalate with status `NEEDS_CONTEXT`) with this exact message:

> "Please add a CNAME record for `matrix.connectiumai.com` pointing to `<CNAME target from Step 1>` in your DNS provider for connectiumai.com. Let me know once it's added — DNS propagation is usually fast but can take up to a few hours."

- [ ] **Step 3: Verify once the user confirms DNS is added**

```bash
railway domain status matrix.connectiumai.com --service synapse
```

Expected: status showing the domain as verified/active. If it still shows pending after the user says they've added the record, wait a few minutes and retry (DNS propagation) — do not loop indefinitely; report back if it's still pending after 3 retries a few minutes apart.

---

## Task 3: Adapt `homeserver.template.yaml` and `start.sh` for production

**Files:**
- Modify: `synapse/homeserver.template.yaml`
- Modify: `synapse/start.sh`

**Interfaces:**
- Consumes: Postgres connection details from Task 1, the confirmed domain from Task 2.
- Produces: a production-ready Synapse config template, rendered via `envsubst` at container start (same mechanism the existing `start.sh` already uses) from environment variables Task 4 sets on the `synapse` Railway service.

This is a repo file change (not a Vercel-deployed file — `synapse/` isn't part of the `play/` front-end build, so no bundle-hash verification applies here; this only needs to be correct for Synapse's own container to pick up). Commit directly on `pxlcode-workplace` (the working clone's current branch) — no need to cherry-pick to `master` separately for this specific file since it's infrastructure config, not app code, but for consistency with the rest of this session's workflow, still cherry-pick it so both branches' repo history stays in sync.

- [ ] **Step 1: Read the current template**

Read `synapse/homeserver.template.yaml` and `synapse/start.sh` in full before editing (they were read during the design phase — verify nothing has changed since).

- [ ] **Step 2: Rewrite `homeserver.template.yaml` for production**

Replace the full file with:

```yaml
# Configuration file for Synapse.
#
# This is a YAML file: see [1] for a quick introduction. Note in particular
# that *indentation is important*: all the elements of a list or dictionary
# should have the same indentation.
#
# [1] https://docs.ansible.com/ansible/latest/reference_appendices/YAMLSyntax.html
#
# For more information on how to configure Synapse, including a complete accounting of
# each option, go to docs/usage/configuration/config_documentation.md or
# https://matrix-org.github.io/synapse/latest/usage/configuration/config_documentation.html
server_name: "connectiumai.com"
public_baseurl: https://matrix.connectiumai.com/
pid_file: /data/homeserver.pid
listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    resources:
      - names: [ client, federation ]
        compress: false
database:
  name: psycopg2
  args:
    user: "${PGUSER}"
    password: "${PGPASSWORD}"
    database: "${PGDATABASE}"
    host: "${PGHOST}"
    port: "${PGPORT}"
    cp_min: 5
    cp_max: 10
log_config: "/data/matrix.workadventure.localhost.log.config"
media_store_path: /data/media_store
report_stats: false
registration_shared_secret: "${REGISTRATION_SHARED_SECRET}"
macaroon_secret_key: "${MACAROON_SECRET_KEY}"
form_secret: "${FORM_SECRET}"
signing_key_path: "/data/matrix.workadventure.localhost.signing.key"
trusted_key_servers:
  - server_name: "matrix.org"
suppress_key_server_warning: true

oidc_providers:
  - idp_id: google
    idp_name: Google
    issuer: "https://accounts.google.com"
    client_id: "${GOOGLE_OIDC_CLIENT_ID}"
    client_secret: "${GOOGLE_OIDC_CLIENT_SECRET}"
    scopes: [ "openid", "email", "profile" ]
    user_profile_method: "userinfo_endpoint"
    user_mapping_provider:
      config:
        localpart_template: "{{ user.email.split('@')[0] }}"
        display_name_template: "{{ user.name }}"
        email_template: "{{ user.email }}"
  - idp_id: microsoft
    idp_name: Microsoft
    issuer: "https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/v2.0"
    client_id: "${MICROSOFT_OIDC_CLIENT_ID}"
    client_secret: "${MICROSOFT_OIDC_CLIENT_SECRET}"
    scopes: [ "openid", "email", "profile" ]
    user_profile_method: "userinfo_endpoint"
    user_mapping_provider:
      config:
        localpart_template: "{{ user.email.split('@')[0] }}"
        display_name_template: "{{ user.name }}"
        email_template: "{{ user.email }}"

sso:
  client_whitelist:
    - "${PXLCODE_PLAY_URL}"
    - "${VINGS_PLAY_URL}"

enable_registration: false
allow_guest_access: false
turn_allow_guests: false
enable_authenticated_media: false

autocreate_auto_join_rooms: false

user_directory:
  search_all_users: true

rc_login:
  address:
    per_second: 0.15
    burst_count: 10
  account:
    per_second: 0.18
    burst_count: 10
  failed_attempts:
    per_second: 0.19
    burst_count: 10
rc_room_creation:
  per_second: 10
  burst_count: 10000
```

Notes on what changed from the dev template, matching the spec's Section A:
- `server_name`/`public_baseurl` → real domain (see the spec's flagged verification item — this uses `connectiumai.com` as `server_name` per Matrix convention; verify this is correct in Task 6's Step 3 before trusting it long-term).
- `database` → Postgres via `envsubst`-substituted env vars, no more `sqlite3`.
- `report_stats: false` (was `true` in dev — no reason to report anonymous stats to matrix.org for a private deployment).
- Three dev-only secrets (`registration_shared_secret`, `macaroon_secret_key`, `form_secret`) are now `envsubst` placeholders instead of hardcoded dev values — Task 4 generates real random secrets for these.
- `jwt_config` block removed entirely (unused code path, see Global Constraints).
- `oidc_providers` replaced with real Google + Microsoft entries, using `envsubst` placeholders for the actual client IDs/secrets Task 5 supplies.
- `sso.client_whitelist` uses placeholders for both deployments' real pusher URLs instead of the `*.workadventure.localhost` dev values.
- `enable_registration`, `allow_guest_access`, `turn_allow_guests` all flipped to `false` (dev-only, security-inappropriate for production — see Background/Section A of the spec).
- `enable_registration_without_verification`, `room_list_publication_rules`, `auto_join_rooms: [#exampleroom..., #anotherexampleroom...]` removed entirely (dev-only, no production equivalent needed).
- `autocreate_auto_join_rooms: false` (was `true` paired with the removed dev auto-join list — with no real rooms to auto-join, this should be off).

- [ ] **Step 3: Rewrite `start.sh` to remove the OIDC-mock wait loop**

Replace the full file with:

```bash
#!/bin/bash
apt update
apt-get install -y gettext-base sudo wget

set -e
#set -x

# Check if all variables used in the template is defined or not
grep -o '\${[0-9A-Za-z_]*}' /data/homeserver.template.yaml | while read line
do
    line=$(echo "$line" | sed 's/^..//' | sed 's/.$//')
    if [[ -z `printenv $line` ]]; then
      echo "---------------------------------------------"
      echo "------------------- ERROR -------------------"
      echo "Environment variable $line key is not defined"
      echo "---------------------------------------------"
      exit 1
    fi
done

envsubst < /data/homeserver.template.yaml > /data/homeserver.yaml

python -m synapse.app.homeserver \
    --config-path /data/homeserver.yaml \
    --generate-config \
    --report-stats=no
sudo chmod -R 777 /data

sleep 10 && register_new_matrix_user -c /data/homeserver.yaml -u ${MATRIX_ADMIN_USER} -p ${MATRIX_ADMIN_PASSWORD} -a &
exec "/start.py"
```

The only change from the original: the entire "Waiting for OIDC mock server to be up..." loop (which polls `http://oidc.workadventure.localhost/.well-known/openid-configuration` — a local-dev-only mock server that doesn't exist in production and would make this script hang/timeout forever in Railway) is removed. `--report-stats=no` also updated to match the `report_stats: false` config change in Step 2 (the original had a mismatch — `report_stats: true` in the YAML but `--report-stats=yes` on the CLI flag; both should agree, now both say no).

- [ ] **Step 4: Verify the YAML is syntactically valid**

```bash
cd /private/tmp/vcnew && python3 -c "import yaml; yaml.safe_load(open('synapse/homeserver.template.yaml').read().replace('\${', '{{').replace('}', '}}'))" 2>&1 || echo "If python3/yaml unavailable, visually re-check indentation carefully instead"
```

(The `${` → `{{` replace is a rough trick to let a YAML parser ignore the unresolved `envsubst` placeholders without erroring on the `$` — if this environment doesn't have PyYAML available, skip the automated check and instead carefully re-read the file for indentation consistency, since that's the most common YAML error class.)

- [ ] **Step 5: Commit**

```bash
git add synapse/homeserver.template.yaml synapse/start.sh
git commit -m "Adapt Synapse config for production: real domain, Postgres, Google/Microsoft OIDC, secure defaults"
```

---

## Task 4: Set Synapse's own environment variables on Railway

**Files:** none (Railway variables only)

**Interfaces:**
- Consumes: the `${...}` placeholder names from Task 3's `homeserver.template.yaml` (`PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGHOST`, `PGPORT`, `REGISTRATION_SHARED_SECRET`, `MACAROON_SECRET_KEY`, `FORM_SECRET`, `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_OIDC_CLIENT_ID`, `MICROSOFT_OIDC_CLIENT_SECRET`, `PXLCODE_PLAY_URL`, `VINGS_PLAY_URL`, `MATRIX_ADMIN_USER`, `MATRIX_ADMIN_PASSWORD`), Postgres details from Task 1.
- Produces: a fully-configured `synapse` Railway service ready to boot (pending Task 5's real OIDC credentials).

This task is split into what can be done now (Postgres wiring, generated secrets, known URLs) and what needs Task 5's OIDC app registrations first (Google/Microsoft client IDs/secrets) — do the first half now, come back for the second half after Task 5.

- [ ] **Step 1: Link to the `synapse` service**

```bash
railway link -p vings-workplace-backend
railway service synapse
```

- [ ] **Step 2: Wire Postgres connection variables**

Using the values captured in Task 1 Step 4 (either individual `PGHOST`/`PGPORT`/etc., or derive them from `DATABASE_URL` if that's what Railway provided — parse it: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`):

```bash
railway variable set PGHOST=<value from Task 1>
railway variable set PGPORT=<value from Task 1>
railway variable set PGDATABASE=<value from Task 1>
railway variable set PGUSER=<value from Task 1>
railway variable set PGPASSWORD=<value from Task 1>
```

- [ ] **Step 3: Generate and set the three Synapse secrets**

```bash
railway variable set REGISTRATION_SHARED_SECRET=$(openssl rand -hex 32)
railway variable set MACAROON_SECRET_KEY=$(openssl rand -hex 32)
railway variable set FORM_SECRET=$(openssl rand -hex 32)
```

- [ ] **Step 4: Set the known URL and admin variables**

```bash
railway variable set PXLCODE_PLAY_URL=https://play-production-5dcd.up.railway.app
railway variable set VINGS_PLAY_URL=https://play-production-7ae3.up.railway.app
railway variable set MATRIX_ADMIN_USER=admin
railway variable set MATRIX_ADMIN_PASSWORD=$(openssl rand -hex 24)
```

(`PXLCODE_PLAY_URL`/`VINGS_PLAY_URL` values are the same pusher URLs already referenced elsewhere in this session's history for `pxlcode-workplace-backend` and `vings-workplace-backend` respectively — verify these are still current via `railway status` on each project before trusting them, since a service URL can change if a service is ever recreated.)

- [ ] **Step 5: Record the generated `MATRIX_ADMIN_PASSWORD` and `MATRIX_DOMAIN` decision**

```bash
railway variable --service synapse --kv | grep MATRIX_ADMIN_PASSWORD
```

Save this value somewhere durable in your task report — Task 7 needs the same admin credentials on the pusher services, and this password is not recoverable from Railway after generation (only re-settable).

- [ ] **Step 6: STOP — wait for Task 5 before setting Google/Microsoft variables**

The `GOOGLE_OIDC_CLIENT_ID`/`GOOGLE_OIDC_CLIENT_SECRET`/`MICROSOFT_TENANT_ID`/`MICROSOFT_OIDC_CLIENT_ID`/`MICROSOFT_OIDC_CLIENT_SECRET` variables cannot be set until Task 5 (user sets up the OIDC app registrations) provides real values. Do not guess or use placeholder values — an incorrect client secret is a security-relevant mistake, not a harmless typo. Return to this task after Task 5 completes and run Step 7.

- [ ] **Step 7 (after Task 5): Set the OIDC credentials**

```bash
railway variable set GOOGLE_OIDC_CLIENT_ID=<from Task 5>
railway variable set GOOGLE_OIDC_CLIENT_SECRET=<from Task 5>
railway variable set MICROSOFT_TENANT_ID=<from Task 5>
railway variable set MICROSOFT_OIDC_CLIENT_ID=<from Task 5>
railway variable set MICROSOFT_OIDC_CLIENT_SECRET=<from Task 5>
```

No commit for this task (pure Railway variable configuration, no repo changes).

---

## Task 5: Google and Microsoft OIDC app registrations — user checkpoint

**Files:** none

**Interfaces:**
- Produces: `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_OIDC_CLIENT_ID`, `MICROSOFT_OIDC_CLIENT_SECRET` — consumed by Task 4 Step 7 and Task 3's config.

This task requires the user's action (dashboard access to Google Cloud Console and Azure AD) — it cannot be completed by an agent. Per the spec (Section B), default to reusing the existing SSO-gate OAuth apps by adding a new redirect URI, rather than creating new ones, unless the user prefers otherwise.

- [ ] **Step 1: STOP — hand off to the user for Google**

Report back to the user (or escalate with status `NEEDS_CONTEXT`) with this exact message:

> "For Google: open the Google Cloud Console project used by the existing SSO gate's 'Sign in with Google' button, find its OAuth 2.0 Client ID, and add this Authorized redirect URI: `https://matrix.connectiumai.com/_synapse/client/oidc/callback`. Then send me the Client ID and Client Secret for that app (or confirm you'd rather create a separate app specifically for Synapse — in that case, create a new OAuth 2.0 Client ID with that same redirect URI and send me its ID/secret instead)."

- [ ] **Step 2: STOP — hand off to the user for Microsoft**

Report back to the user (or escalate with status `NEEDS_CONTEXT`) with this exact message:

> "For Microsoft: open the Azure AD App Registration used by the existing SSO gate's 'Sign in with Microsoft' button, and add this Redirect URI (platform: Web): `https://matrix.connectiumai.com/_synapse/client/oidc/callback`. Then send me the Application (client) ID, a Client Secret (create a new one if needed, under 'Certificates & secrets'), and the Directory (tenant) ID."

- [ ] **Step 3: Record the 5 values for Task 4 Step 7**

Once the user provides them, write them into your task report clearly labeled (`GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_OIDC_CLIENT_ID`, `MICROSOFT_OIDC_CLIENT_SECRET`) so Task 4 Step 7 can consume them without needing to ask the user again.

---

## Task 6: Deploy Synapse and verify it boots

**Files:** none

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a confirmed-working Synapse instance, and resolution of the `MATRIX_DOMAIN` verification flagged in the spec.

- [ ] **Step 1: Trigger a redeploy of the `synapse` service**

```bash
railway link -p vings-workplace-backend
railway service synapse
railway redeploy --yes
```

- [ ] **Step 2: Watch the deploy logs**

```bash
railway logs --service synapse
```

Expected: no "Environment variable ... key is not defined" errors (would mean Task 4 missed a variable), no YAML parse errors (would mean Task 3's template has a syntax issue), and eventually a log line indicating Synapse's HTTP listener started on port 8008. The `register_new_matrix_user` line should also succeed (creating the `MATRIX_ADMIN_USER` account) — if it errors with "User ID already taken," that's fine (means this step already ran on a prior deploy), any other error there is not fine and should be investigated.

- [ ] **Step 3: Verify the public endpoint responds, and resolve the `MATRIX_DOMAIN` question**

```bash
curl -s https://matrix.connectiumai.com/_matrix/client/versions
```

Expected: a JSON response listing supported Matrix spec versions — confirms the domain, TLS, and Synapse are all correctly connected end to end.

Then specifically resolve the flagged `server_name` question from the spec:

```bash
curl -s https://matrix.connectiumai.com/.well-known/matrix/server
curl -s https://matrix.connectiumai.com/_matrix/client/v3/login | head -c 500
```

Confirm the server genuinely identifies itself with `server_name: connectiumai.com` (as configured in Task 3) and that this is really what should appear in user IDs (`@localpart:connectiumai.com`) per Matrix's own documentation on `server_name` — if research during this step turns up that `server_name` should instead have been `matrix.connectiumai.com` to match the actual reachable domain, STOP and report this back rather than silently reconfiguring — changing `server_name` after any real user has logged in changes their permanent Matrix ID and is not safely reversible, so this must be confirmed correct before Task 9 lets real users start using it.

- [ ] **Step 4: Verify Google/Microsoft OIDC providers are recognized**

```bash
curl -s https://matrix.connectiumai.com/_matrix/client/v3/login | python3 -m json.tool
```

Expected: the response's `flows` array includes an `m.login.sso` entry, and Synapse's own admin/well-known endpoints don't report OIDC provider configuration errors (check `railway logs --service synapse` again for any OIDC-provider-related startup warnings — a misconfigured `issuer`/`client_id` typically logs a clear error at startup, not just at login time).

No commit for this task (verification only).

---

## Task 7: Configure pusher services (both backend projects) with Matrix env vars

**Files:** none (Railway variables only)

**Interfaces:**
- Consumes: `MATRIX_ADMIN_USER`/`MATRIX_ADMIN_PASSWORD` from Task 4, the confirmed `MATRIX_DOMAIN` value from Task 6, Synapse's internal Railway URL.
- Produces: both deployments' pusher services fully configured to reach the shared Synapse instance.

- [ ] **Step 1: Get Synapse's internal Railway networking address**

```bash
railway link -p vings-workplace-backend
railway service synapse
railway variable --kv | grep -i railway_private
```

Expected: a variable like `RAILWAY_PRIVATE_DOMAIN` — Railway's internal (not public-internet) hostname for the service, used for the `MATRIX_API_URI` so pusher-to-Synapse admin-API traffic never leaves Railway's private network. Construct `MATRIX_API_URI` as `http://<RAILWAY_PRIVATE_DOMAIN>:8008/`.

- [ ] **Step 2: Set variables on `vings-workplace-backend`'s `play` service**

```bash
railway service play
railway variable set MATRIX_API_URI=http://<RAILWAY_PRIVATE_DOMAIN from Step 1>:8008/
railway variable set MATRIX_ADMIN_USER=<from Task 4>
railway variable set MATRIX_ADMIN_PASSWORD=<from Task 4>
railway variable set MATRIX_DOMAIN=<confirmed value from Task 6 Step 3>
```

- [ ] **Step 3: Determine and set `OPENID_CLIENT_ID` — verification required**

Before setting this, read `play/src/pusher/services/*.ts` (specifically wherever `OPENID_CLIENT_ID`/`OPID_CLIENT_ID` is consumed beyond the boolean `ENABLE_OPENID` check already found during the design phase — search for other uses of the same env var, e.g. in an `openIDClient`-style service that might use it as an actual OAuth client ID for validating tokens against a specific admin/room-permission OIDC provider, not the Matrix-login OIDC providers configured in Task 3/5) to determine whether it needs to be a real, working OIDC client ID (in which case it likely needs its own separate app registration, since it may serve a different purpose than the Matrix-login providers) or whether any non-empty string is sufficient to flip the boolean check without the value being otherwise validated at runtime. Report findings clearly before setting a value — if the code only ever does `!!env.OPENID_CLIENT_ID`, a placeholder non-secret value is fine; if it's later used as a real credential, it needs the same care as the Matrix OIDC credentials (don't guess, ask the user via the same NEEDS_CONTEXT escalation pattern as Task 5).

```bash
railway variable set OPENID_CLIENT_ID=<value determined above>
```

- [ ] **Step 4: Repeat Steps 2-3 on `pxlcode-workplace-backend`'s `play` service**

```bash
railway link -p pxlcode-workplace-backend
railway service play
railway variable set MATRIX_API_URI=http://<same RAILWAY_PRIVATE_DOMAIN>:8008/
railway variable set MATRIX_ADMIN_USER=<from Task 4>
railway variable set MATRIX_ADMIN_PASSWORD=<from Task 4>
railway variable set MATRIX_DOMAIN=<same confirmed value>
railway variable set OPENID_CLIENT_ID=<same value as Step 3>
```

`MATRIX_API_URI` is the same value in both projects — Railway's private networking allows cross-project internal traffic within the same Railway account (verify this is actually true for this Railway account/plan tier during this step; if cross-project private networking isn't available, `MATRIX_API_URI` for `pxlcode-workplace-backend`'s `play` service will need to use Synapse's *public* URL, `https://matrix.connectiumai.com/`, instead — check `railway docs` or Railway's dashboard networking settings if uncertain, don't assume).

No commit for this task (Railway variables only).

---

## Task 8: Front-end config — `ENABLE_OPENID`, `MATRIX_PUBLIC_URI`, `MATRIX_DOMAIN`

**Files:**
- Modify: `process-template.cjs` (on both `pxlcode-workplace` and `master` branches — this file already differs per-branch, per the existing `OFFICE_NAME` pattern)

**Interfaces:**
- Consumes: the confirmed `MATRIX_DOMAIN` value from Task 6.
- Produces: front-end build config that unlocks `Room.ts`'s `isMatrixChatEnabled` check.

- [ ] **Step 1: Read the current `process-template.cjs` on `pxlcode-workplace`**

Confirm the current values of `ENABLE_OPENID: false`, `MATRIX_PUBLIC_URI: undefined`, `MATRIX_ADMIN_USER: undefined`, `MATRIX_DOMAIN: undefined` in the `windowEnv` object (these were read during the design phase — re-verify nothing changed).

- [ ] **Step 2: Update the three values**

In `process-template.cjs`'s `windowEnv` object, change:

```javascript
    ENABLE_OPENID: false,
```
to:
```javascript
    ENABLE_OPENID: true,
```

and change:
```javascript
    MATRIX_DOMAIN: undefined,
```
to:
```javascript
    MATRIX_DOMAIN: '<confirmed value from Task 6 Step 3>',
```

`MATRIX_PUBLIC_URI` is not currently a key in the `windowEnv` object at all (verify this by re-reading the file — if the design phase's earlier read was accurate, it's genuinely absent, meaning the front-end code that reads it, e.g. `MATRIX_PUBLIC_URI` in `Enum/EnvironmentVariable.ts`, currently resolves to `undefined` because no such window.env key exists rather than because it's explicitly set to `undefined`). Add it to the object:

```javascript
    MATRIX_PUBLIC_URI: 'https://matrix.connectiumai.com',
```

- [ ] **Step 3: Verify `MATRIX_PUBLIC_URI` is actually a recognized `windowEnv` key**

Before trusting Step 2's addition, check `play/src/front/Enum/EnvironmentVariable.ts` (or wherever `window.env` is schema-validated — the design phase noted `windowEnv` is validated against a strict schema, `EnvironmentVariable.ts`) to confirm `MATRIX_PUBLIC_URI` is an expected/allowed key there. If it's validated via a schema (e.g. Zod) and `MATRIX_PUBLIC_URI` isn't in that schema, adding it to `windowEnv` alone won't do anything — it needs to be a recognized key for the front-end to actually read it. Report findings; if it's missing from the schema, that's a real gap to flag back rather than silently working around.

- [ ] **Step 4: Commit and deploy to `pxlcode-workplace`**

```bash
git add process-template.cjs
git commit -m "Enable real Matrix chat: ENABLE_OPENID, MATRIX_PUBLIC_URI, MATRIX_DOMAIN"
git push origin pxlcode-workplace
```

Poll `https://pxlcode-workplace.vercel.app/` for a new `main-*.js` bundle hash, per this session's established verification pattern, before proceeding.

- [ ] **Step 5: Repeat on `master`**

Cherry-pick the same commit onto a fresh clone of `master` (following this session's established workflow), adjusting only the branch-specific values that already differ per the existing `OFFICE_NAME` pattern (the `MATRIX_DOMAIN`/`ENABLE_OPENID`/`MATRIX_PUBLIC_URI` values themselves are the same on both branches, since Task 1-7 set up one shared homeserver for both). Push to `master`, poll `https://vings-workplace.vercel.app/`/`https://office.connectiumai.com/` for the new bundle hash.

---

## Task 9: Wire the auto-trigger into the custom SSO gate

**Files:**
- Modify: `process-template.cjs` (the `ssoGateScript` template string, on both branches)

**Interfaces:**
- Consumes: `ConnectionManager.loadOpenIDScreen(manuallyTriggered: boolean, providerId?: string, providerScopes?: string[]): URL | null` (already exists, confirmed during design).
- Produces: the invisible OIDC-to-Matrix hop described in the spec's Section B, firing automatically after the custom SSO gate confirms login.

- [ ] **Step 1: Read the current `ssoGateScript` in `process-template.cjs`**

Locate the `wa_user` cookie check (`getCookie('wa_user')`) — this is where the script currently knows a login succeeded, sets `window.__waIsAdmin`, and (for a pending-approval user) shows the waiting screen.

- [ ] **Step 2: Understand how to reach `connectionManager` from this early script**

This script runs before the game/Svelte app boots, so `connectionManager` (a front-end module-level singleton, `play/src/front/Connection/ConnectionManager.ts`) is not yet available in this early inline `<script>` tag's scope. Read `GameScene.ts`'s existing chat-connection code (around the `emitPlayerChatID` call found during design, `GameScene.ts:1025-1040`) to find the right integration point — the auto-trigger likely belongs in the front-end app's own bootstrap code (e.g. alongside or near that existing `getChatConnection().then(...)` block in `GameScene.ts`), reading the same `wa_user` cookie or a value the SSO gate script already stashed (e.g. `sessionStorage`/a global) to decide whether to call `loadOpenIDScreen`, rather than trying to call `connectionManager` from the pre-boot inline script itself. Determine the correct integration point by reading `GameScene.ts` in full around that section before writing any code — do not guess a call site.

- [ ] **Step 3: Add the trigger**

Once the correct integration point is identified (per Step 2), add a call resembling:

```typescript
if (ENABLE_OPENID && !userAlreadyHasMatrixSession() /* exact check TBD from Step 2's findings */) {
    const redirectUrl = connectionManager.loadOpenIDScreen(false);
    if (redirectUrl) {
        window.location.href = redirectUrl.toString();
    }
}
```

The exact guard condition (`userAlreadyHasMatrixSession()`) needs to come from Step 2's research — the goal is: only redirect if (a) the user completed the custom SSO gate with a real email (not a guest), and (b) they don't already have a valid Matrix session in `localStorage` (avoid redirecting on every single page load once already logged into Matrix — check `localUserStore.getChatId()`/`getMatrixLoginToken()`-style existing getters, found during design, for what "already has a session" should check). Write the actual condition based on what Step 2 finds — this snippet is illustrative of the shape, not literal code to paste in.

- [ ] **Step 4: Confirm this doesn't block guests or break the non-chat flow**

Per the spec's Error Handling section: this redirect must never block a guest (no email → skip entirely) and must not turn a Synapse/OIDC failure into a blocking error for the main game flow. Trace the actual failure paths in `loadOpenIDScreen`'s caller chain and confirm they're already async/non-blocking (per the design phase's reading of `ConnectionManager.ts`, they appear to be) — if not, wrap appropriately so a chat-login failure never prevents the game from loading.

- [ ] **Step 5: Commit and deploy to both branches**

Same commit → push → poll-for-new-bundle-hash → cherry-pick to `master` → push → poll pattern as every other front-end change this session.

---

## Task 10: End-to-end verification

**Files:** none

**Interfaces:** none — this is the final acceptance check for the whole plan.

- [ ] **Step 1: Manual login test**

On the live `office.connectiumai.com`, complete a real Google or Microsoft login through the existing SSO gate. Confirm (via browser dev tools or by asking the user to confirm) that a brief additional redirect through `matrix.connectiumai.com`'s OIDC flow happens and completes automatically (or with at most one extra click, if the browser isn't already signed into the chosen provider).

- [ ] **Step 2: Confirm a Matrix account was created**

```bash
curl -s -u admin:<MATRIX_ADMIN_PASSWORD from Task 4> https://matrix.connectiumai.com/_synapse/admin/v2/users | python3 -m json.tool
```

Expected: the JSON user list includes an account matching the test login's email-derived localpart.

- [ ] **Step 3: Confirm `userIsConnected` and Matrix chat actually work in the app**

With two real (or two browser-profile) logins as different users in the same room, repeat the manual verification steps from the 2026-07-31 office-ux-fixes batch's Task 3 (wave toast reply actions) and Task 7 (hover-preview) — specifically the "Message" button and the "Will be there in a while" quick-reply — and confirm they now genuinely deliver messages instead of showing "Can't message - unavailable."

- [ ] **Step 4: Confirm guests are unaffected**

Complete the "Continue as guest" flow and confirm Message/quick-reply still correctly show "Can't message - unavailable" (unchanged, expected) and that guest login isn't slowed down or broken by the new OIDC-trigger logic.

No commit for this task (verification only). Report final results — this is the completion gate for the whole plan.

## Self-Review Notes

- **Spec coverage:** Section A (Synapse deployment) → Tasks 1, 2, 3, 6. Section B (OIDC providers + auto-trigger) → Tasks 3, 5, 9. Section C (guests unaffected) → Task 10 Step 4 (no code task needed — already correctly handled by existing 2026-07-31 batch code, per spec). Section D (front-end config) → Task 8. Section E (pusher config) → Task 7, including both of the spec's explicitly-flagged verification items (Task 6 Step 3 for `MATRIX_DOMAIN`, Task 7 Step 3 for `OPENID_CLIENT_ID`).
- **Placeholder scan:** Several steps in Tasks 7-9 say "verify before setting/writing" rather than giving a single hardcoded final answer — this is intentional, not a plan-writing shortcut: the spec itself flagged these two values as genuinely unresolved pending implementation-time research (real code reading + live testing against a Synapse instance that doesn't exist yet), and Task 9's exact trigger location depends on reading `GameScene.ts` state that could only be fully pinned down once actually looking at it in the implementation session. Each of these has a concrete research method specified (which file to read, what to grep for, what command confirms the answer), not a vague "figure it out."
- **Type consistency:** `loadOpenIDScreen(manuallyTriggered: boolean, providerId?, providerScopes?): URL | null` (Task 9) matches the signature found during the design phase's reading of `ConnectionManager.ts`. Railway service names (`synapse`, `synapse-postgres`) are used consistently from Task 1 through Task 7.
