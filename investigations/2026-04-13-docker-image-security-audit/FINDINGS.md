# Docker Image Security Audit: hl7fhir/ig-publisher-base

## Summary

Trivy scan of the published `hl7fhir/ig-publisher-base:latest` image (last pushed
May 31, 2024) revealed **1,075 HIGH and 26 CRITICAL** vulnerabilities across the OS
layer, Ruby gems, and Node.js packages. The image was built on a deprecated,
frozen base (`openjdk:23-slim-bookworm`) with EOL components throughout.

## Published Image State (hl7fhir/ig-publisher-base:latest)

| Component | Version | Status |
|-----------|---------|--------|
| Base image | `openjdk:23-slim-bookworm` | Deprecated since July 2022; image frozen, no patches |
| Java | OpenJDK 23 | Non-LTS, EOL March 2025 |
| Node.js | 20.13.1 | EOL April 30, 2026; 2 HIGH CVEs (worker permission bypass, HTTP/2 DoS) |
| Ruby | 3.1.2 (Debian Bookworm) | EOL March 2025 |
| Debian | 12.5 (Bookworm) | 1,088 HIGH+CRITICAL OS-level vulns in frozen image |
| rexml gem | 3.2.8 | 6 CVEs including ReDoS targeting Ruby 3.1 |
| webrick gem | 1.8.1 | 1 CVE (HTTP request smuggling) |
| pip install zulip | unpinned | Supply chain risk; CI image has SSH keys |

### Trivy Scan: Published Image

```
hl7fhir/ig-publisher-base:latest (debian 12.5)
  OS packages:   1,088 HIGH+CRITICAL
  Ruby gems:     11 HIGH
  Node.js pkgs:  2 HIGH
  TOTAL:         1,101 (1,075 HIGH + 26 CRITICAL)
```

## Additional Issues

- **Docker Hub image tag `openjdk:23-slim-bookworm` no longer exists** on Docker Hub;
  the image cannot be rebuilt from the current Dockerfile without changes.
- **At the time of the audit**, the GitHub Actions workflow triggered on `main` while the
  default branch was `master`, so automated rebuilds never fired. The repo has since been
  updated to publish candidate tags from `master` and requires a separate manual promotion
  step before `latest` is overwritten.
- **3 unmerged Dependabot PRs** (Nov 2025) for rexml, webrick, google-protobuf.
- `ADD` used instead of `COPY` (Dockerfile best practice violation).
- `apt-get clean` instead of `rm -rf /var/lib/apt/lists/*` (less effective).
- No `--no-install-recommends` on apt-get (larger attack surface + image size).
- Shell-form ENTRYPOINT (no proper signal handling).
- `python3-requests` installed via apt but unused (venv has its own).

## Current Repo Status

The findings above describe the published `hl7fhir/ig-publisher-base:latest` image that was
audited on April 13, 2026. The repository has since changed in two important ways:

- The main Dockerfile under `images/ig-publisher/Dockerfile` now rebuilds cleanly from
  `eclipse-temurin:21-jdk-noble` and produces locally verified `localdev` and `ci` images
  with 0 HIGH / 0 CRITICAL findings in Trivy 0.67.2.
- The release automation now publishes immutable `candidate-<sha>` tags from `master`
  and uses a separate manual promotion workflow before `latest` is updated in GHCR or
  Docker Hub.

This means the repo now contains a fix path, but the published `latest` tags remain as-is
until a tested candidate is explicitly promoted.
