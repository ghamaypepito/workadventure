# Guest entry and removal — local trial

Guests select an online office member, supply an optional message, and wait before opening a map connection. Only the selected signed-in member can approve or decline. Administrators can remove approved guests; removal ends that visit without banning future entry requests. Refreshing preserves pending requests.

The frontend obtains a short-lived visit credential. The gateway independently checks its hash, approval and expiry in Redis before admitting a connection, and rechecks every five seconds. Removal closes the map connection and cleans up room membership. Signed-in members receive a separate credential tied to their active signed-in session. Redis errors deny admission and end monitored connections; this dependency must be tested before enabling the feature.

Requests expire after ten minutes; approved guest visits last eight hours. The existing admission script polls status and handles the user-facing exit. Compare-and-set updates prevent concurrent heartbeats from undoing removal. Stale visits are hidden after 45 seconds; records older than a day are pruned when lists are read.

## Configuration and rollout

The feature is off by default. Set GUEST_ADMISSION_ROOM to the canonical office URL on both the Vercel API and Railway gateway only after a preview trial. Protection covers all map paths on the configured origin, including old aliases. Both services must use the same Redis database. Deploy the gateway and frontend with the switch off first; coordinate enablement to avoid denying clients that have not loaded the new frontend. Existing connected clients are not retroactively enrolled in the new gateway checks.

Before production, verify signed-in member entry, guest approval/decline, refresh while pending, removal while connected, rejection of reuse of the removed pass, and a fresh guest request in separate browser sessions. Verify room and media membership disappear after removal. Test Redis interruption and recovery. Do not enable this on live users until those checks pass.

## Validation

28 targeted automated tests pass (14 API/script checks and 14 frontend/gateway checks). Targeted TypeScript lint passes. Frontend production build passes. Full frontend typecheck is blocked by existing XML tilesets with .tsx extensions; gateway typecheck reports an existing LocalAdmin.ts redirectUrl error. No real Redis integration or two-browser acceptance trial has been completed.

No production deployment, live-user removal, or resumption of diagnostics was performed.
