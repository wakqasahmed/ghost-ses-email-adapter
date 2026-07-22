ARG PACKAGE_TARBALL

FROM ghost:6.53.0-alpine

ARG PACKAGE_TARBALL

USER root

RUN apk add --no-cache patch

COPY patches/ghost-6.x-email-adapter-wiring.patch /tmp/ghost-email-adapter.patch
COPY ${PACKAGE_TARBALL} /tmp/ghost-ses-email-adapter.tgz
COPY test/integration/entrypoint.sh /usr/local/bin/ses-adapter-test-entrypoint

RUN cd /var/lib/ghost/current \
    && patch -p1 < /tmp/ghost-email-adapter.patch \
    && mkdir -p /opt/ghost-ses-email-adapter \
    && tar -xzf /tmp/ghost-ses-email-adapter.tgz --strip-components=1 -C /opt/ghost-ses-email-adapter \
    && npm install --omit=dev --prefix /opt/ghost-ses-email-adapter \
    && chmod +x /usr/local/bin/ses-adapter-test-entrypoint

ENTRYPOINT ["ses-adapter-test-entrypoint"]
