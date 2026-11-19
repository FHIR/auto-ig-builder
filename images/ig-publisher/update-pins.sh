#!/usr/bin/env bash
# Move every pin in ./Dockerfile to the newest upstream release within the
# chosen release lines, with checksums from each upstream. Prints a summary;
# review with `git diff Dockerfile`.
set -euo pipefail
cd "$(dirname "$0")"

RUBY_LINE=${RUBY_LINE:-3.4}      # official ruby image, slim Debian
DEBIAN=${DEBIAN:-trixie}
JDK_MAJOR=${JDK_MAJOR:-21}       # Eclipse Temurin
NODE_MAJOR=${NODE_MAJOR:-22}
JEKYLL_MAJOR=${JEKYLL_MAJOR:-4}
PICOMATCH_MAJOR=${PICOMATCH_MAJOR:-4}

get() { curl -fsSL --retry 3 -m 60 "$@"; }
die() { echo "update-pins: $*" >&2; exit 1; }

# Ruby: newest X.Y.Z-slim-<debian> tag and its multi-arch index digest
ruby_tag=$(get "https://hub.docker.com/v2/repositories/library/ruby/tags?name=${RUBY_LINE}.&page_size=100" |
  jq -r --arg re "^${RUBY_LINE//./\\.}\\.[0-9]+-slim-${DEBIAN}\$" '.results[].name | select(test($re))' | sort -V | tail -1)
[ -n "$ruby_tag" ] || die "no ruby ${RUBY_LINE} slim-${DEBIAN} tag"
ruby_digest=$(get "https://hub.docker.com/v2/repositories/library/ruby/tags/${ruby_tag}" | jq -r .digest)
[[ $ruby_digest == sha256:* ]] || die "no digest for ruby:${ruby_tag}"

# Temurin JDK: newest GA build per architecture (they can differ, e.g. an
# x64-only security respin)
jdk() {
  get "https://api.adoptium.net/v3/assets/latest/${JDK_MAJOR}/hotspot?image_type=jdk&os=linux&architecture=$1&vendor=eclipse" |
    jq -r '.[0] | "\(.release_name) \(.binary.package.link) \(.binary.package.checksum)"'
}
read -r jdk_amd64_rel jdk_amd64_url jdk_amd64_sha < <(jdk x64)
read -r jdk_arm64_rel jdk_arm64_url jdk_arm64_sha < <(jdk aarch64)
for v in "$jdk_amd64_sha" "$jdk_arm64_sha"; do [[ $v =~ ^[0-9a-f]{64}$ ]] || die "bad JDK checksum"; done

# Node: newest release on the major line; sums from SHASUMS256.txt
node_ver=$(get https://nodejs.org/dist/index.json | jq -r --arg p "v${NODE_MAJOR}." '[.[] | select(.version|startswith($p))][0].version')
sums=$(get "https://nodejs.org/dist/${node_ver}/SHASUMS256.txt")
node_amd64_sha=$(awk -v f="node-${node_ver}-linux-x64.tar.gz" '$2==f{print $1}' <<<"$sums")
node_arm64_sha=$(awk -v f="node-${node_ver}-linux-arm64.tar.gz" '$2==f{print $1}' <<<"$sums")
for v in "$node_amd64_sha" "$node_arm64_sha"; do [[ $v =~ ^[0-9a-f]{64}$ ]] || die "bad Node checksum"; done

# Jekyll: newest release on the major line
jekyll_ver=$(get https://rubygems.org/api/v1/versions/jekyll.json |
  jq -r --arg p "${JEKYLL_MAJOR}." '[.[] | select(.prerelease|not) | .number | select(startswith($p))][0]')

# picomatch: npm publishes sha512 only, so download, check it, and pin sha256
pm_meta=$(get https://registry.npmjs.org/picomatch)
pm_ver=$(jq -r --arg p "${PICOMATCH_MAJOR}." '[.versions | keys[] | select(startswith($p)) | select(test("-")|not)] | sort_by(split(".")|map(tonumber)) | last' <<<"$pm_meta")
pm_tmp=$(mktemp); trap 'rm -f "$pm_tmp"' EXIT
get -o "$pm_tmp" "https://registry.npmjs.org/picomatch/-/picomatch-${pm_ver}.tgz"
[ "sha512-$(openssl dgst -sha512 -binary "$pm_tmp" | base64 -w0)" = "$(jq -r --arg v "$pm_ver" '.versions[$v].dist.integrity' <<<"$pm_meta")" ] ||
  die "picomatch ${pm_ver} does not match the registry's sha512"
pm_sha=$(sha256sum "$pm_tmp" | cut -c1-64)

set_arg() { sed -i -E "s|^ARG $1=.*|ARG $1=$2|" Dockerfile; grep -q "^ARG $1=$2\$" Dockerfile || die "could not set $1"; }
set_arg RUBY_IMAGE "ruby:${ruby_tag}@${ruby_digest}"
set_arg JEKYLL_VERSION "$jekyll_ver"
set_arg JDK_URL_AMD64 "$jdk_amd64_url"
set_arg JDK_SHA256_AMD64 "$jdk_amd64_sha"
set_arg JDK_URL_ARM64 "$jdk_arm64_url"
set_arg JDK_SHA256_ARM64 "$jdk_arm64_sha"
set_arg NODE_VERSION "$node_ver"
set_arg NODE_SHA256_AMD64 "$node_amd64_sha"
set_arg NODE_SHA256_ARM64 "$node_arm64_sha"
set_arg PICOMATCH_VERSION "$pm_ver"
set_arg PICOMATCH_SHA256 "$pm_sha"

cat <<EOF
ruby       ${ruby_tag}
jekyll     ${jekyll_ver}
jdk amd64  ${jdk_amd64_rel}
jdk arm64  ${jdk_arm64_rel}
node       ${node_ver}
picomatch  ${pm_ver}
EOF
