#!/bin/bash
apt update
apt-get install -y gettext-base sudo wget

set -e
#set -x

# The template lives in the image (baked in by the Dockerfile), but /data is a persistent
# Railway volume that starts empty on first boot and otherwise survives across deploys (so the
# generated signing key, media store, and homeserver.yaml aren't lost on every redeploy). Copy
# the current image's template onto the volume on every boot so config changes from a new image
# take effect, without touching anything else already on the volume.
cp /homeserver.template.yaml /data/homeserver.template.yaml

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