# Remove a guest from the Admin Dashboard

## Agreed behavior

Admins can remove an individual guest from the map using the Admin Dashboard. Removal ends that guest's current map and media session. Guests can rejoin later through the existing entry flow. There is no permanent account, device, or IP ban and no new admission requirement.

## Existing implementation

The dashboard at play/public/admin/index.html manages approved accounts and administrator roles. Its existing revoke endpoint changes account access; it is not a guest disconnect operation and must not be reused here. Guest admission gating has been removed in play/public/scripts/admission-script.html. The pusher maintains live logical sockets in PusherRoom, while dashboard authorization uses requireAdmin in the Vercel API. These are separate services.

## Proposed implementation

Add a Guests section to the dashboard, with live guest name, map, a short session identifier to distinguish duplicate names, and Remove from map. Refresh the list periodically while visible and after removal. The confirmation identifies the guest and explains that they may rejoin. Display a clear empty state and request failures without falsely claiming removal succeeded.

Add authenticated server-to-server listing and removal endpoints behind the existing pusher admin-token middleware. The browser calls same-origin dashboard API routes protected by requireAdmin; only that API supplies the server credential. Restrict operations to the configured office map. Reject non-POST mutations and cross-origin mutation requests. Never expose the infrastructure token to the browser.

Use a server-issued visit identifier for each logical guest connection. Preserve it during transport reconnection, and assign a new identifier on an explicit new visit. Identify guest versus member from verified server-side authentication, not display names or the editable wa_user cookie. Where the current SSO bridge lacks an authoritative guest/member distinction, propagate a verified classification before enabling removal; unknown sessions are not removable. Do not interpret absence of a client identity-registration record alone as proof of guest status.

On removal, re-check the visit and guest classification server-side. Terminate only the selected logical connection, release its backend room/space membership, and stop its media. Send a dedicated removal event so the client tears down its media and displays a removed notice with a Rejoin button instead of automatically reconnecting. Old reconnect attempts must not revive the removed visit. Rejoin creates a fresh visit using the existing entry flow. Do not reuse permanent-ban behavior or disconnect every connection sharing a name.

## Verification

Test authorization, cross-origin rejection, protected member/unknown sessions, duplicate names, stale selections, idempotent removal, reconnect rejection for the removed visit, and explicit rejoin with a fresh visit. Verify with two guests plus a member: remove one guest, confirm its map and media end, confirm the other participants remain connected, then rejoin successfully. Test request failures and dashboard rendering of untrusted names.

## Rollout

Build and test before production rollout. The gateway, dashboard API, and frontend must support the feature together; keep the control unavailable until the server capability is present. A gateway deployment may interrupt live connections, so deployment timing must be agreed before release. This change does not resume the paused diagnostics automation.
