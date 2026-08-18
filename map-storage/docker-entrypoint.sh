#!/bin/sh
set -e

# A Railway (or any Docker) volume mounted at $STORAGE_DIRECTORY can arrive with different
# ownership than the image's own baked-in "chown node:node" from build time - the mount itself
# determines ownership at container start, not the image layer. That left this app (which runs
# as the unprivileged "node" user, never root) unable to write to its own map storage, silently
# losing every upload with "EACCES: permission denied" until someone happened to notice maps had
# stopped saving. Running as root here just long enough to re-assert ownership on every container
# start - before dropping to "node" via gosu for the real process - means this self-heals on any
# future remount instead of depending on it being fixed by hand again.
if [ -n "$STORAGE_DIRECTORY" ] && [ -d "$STORAGE_DIRECTORY" ]; then
    chown -R node:node "$STORAGE_DIRECTORY"
fi

exec gosu node "$@"
