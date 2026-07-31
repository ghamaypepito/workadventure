FROM matrixdotorg/synapse:v1.140.0

# homeserver.template.yaml is baked into the image and copied onto the persistent /data volume
# at boot (see start.sh) - this means updating the template just means rebuilding/redeploying
# this image, while /data itself (signing key, media store, homeserver.yaml, sqlite state if
# ever used) survives across deploys via the Railway volume mounted there.
COPY homeserver.template.yaml /homeserver.template.yaml
COPY start.sh /start-custom.sh
RUN chmod +x /start-custom.sh

ENTRYPOINT ["/start-custom.sh"]
