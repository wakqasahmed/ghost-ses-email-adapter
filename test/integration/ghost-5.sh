#!/usr/bin/env bash

set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly run_id="${RANDOM}${RANDOM}"
readonly container_name="ses-adapter-test-ghost-5-${run_id}"
readonly image_name="ses-adapter-test-ghost-5:${run_id}"
readonly temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ses-adapter-test-ghost-5-XXXXXX")"

cleanup() {
    docker rm --force --volumes "$container_name" >/dev/null 2>&1 || true
    docker image rm --force "$image_name" >/dev/null 2>&1 || true
    rm -rf "$temp_dir"
}

trap cleanup EXIT INT TERM

build_context="$temp_dir/build-context"
mkdir -p "$build_context/patches" "$build_context/test/integration"
cp "$repo_root/patches/ghost-5.x-email-adapter-wiring.patch" "$build_context/patches/"
cp "$repo_root/test/integration/entrypoint.sh" "$build_context/test/integration/"

npm pack --silent --pack-destination "$build_context" "$repo_root" >/dev/null
package_tarball="$(find "$build_context" -maxdepth 1 -name 'ghost-ses-email-adapter-*.tgz' -printf '%f\n' -quit)"

if [[ -z "$package_tarball" ]]; then
    echo 'npm pack did not produce the adapter tarball.' >&2
    exit 1
fi

cp "$repo_root/test/integration/Dockerfile.ghost-5" "$build_context/Dockerfile"

docker build \
    --quiet \
    --tag "$image_name" \
    --build-arg "PACKAGE_TARBALL=$package_tarball" \
    --file "$build_context/Dockerfile" \
    "$build_context" >/dev/null

docker run --detach --name "$container_name" \
    --tmpfs /var/lib/ghost/content:uid=1000,gid=1000,mode=0755 \
    --env NODE_ENV=production \
    --env url=http://127.0.0.1:2368 \
    --env database__client=sqlite3 \
    --env database__connection__filename=/var/lib/ghost/content/data/ghost.db \
    --env adapters__email__active=ses \
    --env adapters__email__ses__region=eu-west-1 \
    --env adapters__email__ses__fromEmail=news@example.test \
    --env adapters__email__ses__accessKeyId=AKIAFAKEINTEGRATIONTEST \
    --env adapters__email__ses__secretAccessKey=fake-integration-test-secret \
    "$image_name" >/dev/null

for _ in $(seq 1 60); do
    if docker logs "$container_name" 2>&1 | grep -q 'Ghost is running'; then
        docker exec -i "$container_name" node - <<'NODE'
const assert = require('node:assert/strict');
const root = '/var/lib/ghost/current';
const sendingServicePath = require.resolve(`${root}/core/server/services/email-service/SendingService`);
const wrapperPath = require.resolve(`${root}/core/server/services/email-service/EmailServiceWrapper`);
const SendingService = require(sendingServicePath);

let emailProvider;
let maximumRecipients;

class ObservedSendingService extends SendingService {
    constructor(dependencies) {
        super(dependencies);
        emailProvider = dependencies.emailProvider;
        maximumRecipients = this.getMaximumRecipients();
    }
}

require.cache[sendingServicePath].exports = ObservedSendingService;
delete require.cache[wrapperPath];

const EmailServiceWrapper = require(wrapperPath);
const emailServiceWrapper = new EmailServiceWrapper();

emailServiceWrapper.init();

assert.equal(emailProvider.constructor.name, 'SESEmailProvider');
assert.equal(maximumRecipients, 50);

console.log(`EMAIL_PROVIDER=${emailProvider.constructor.name}`);
NODE
        exit 0
    fi

    sleep 1
done

docker logs "$container_name" >&2
echo 'Ghost did not report a successful boot within 60 seconds.' >&2
exit 1
