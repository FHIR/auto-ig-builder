# Solution: Updated Dockerfile and Staged Publish Workflow

## Changes Applied

### Base Image
`openjdk:23-slim-bookworm` (deprecated, frozen) -> `eclipse-temurin:21-jdk-noble`
- Eclipse Temurin: actively maintained by Adoptium, 1B+ Docker Hub pulls
- Java 21 LTS (supported through Dec 2029); IG Publisher requires Java 17+
- Ubuntu Noble 24.04 LTS base (apt-get compatible, no command changes needed)
- Multi-arch: amd64 + arm64

### Multi-Stage Build for Gem Compilation
Added a `gem-builder` throwaway stage that installs `build-essential`, `ruby-dev`,
`libffi-dev` and compiles native gem extensions. The runtime `base` stage only has
`ruby` and `libffi8` — no compiler toolchain, no `linux-libc-dev` kernel headers.

This eliminated CVE-2026-23112 (linux-libc-dev, unfixed upstream) by removing the
package entirely from the runtime image.

### Node.js
`v20.13.1` (EOL April 2026, 6 CVEs) -> `v22.22.2` (LTS through April 2027)

### npm Bundled picomatch Patch
npm 10.9.7 bundles picomatch 4.0.3 (CVE-2026-33671: ReDoS via crafted extglob).
Surgically replaced with 4.0.4 from the npm registry. This is an npm-internal
dependency (only used for glob resolution within npm itself), but patching it
gets the trivy scan to zero.

### Dockerfile Best Practices
- `ADD` -> `COPY` (avoids unexpected URL/tar extraction behavior)
- Added `--no-install-recommends` to all apt-get install commands
- `apt-get clean` -> `rm -rf /var/lib/apt/lists/*` (proper Docker cache cleanup)
- Added `--no-cache-dir` to pip install (no pip cache in image layers)
- Shell-form ENTRYPOINT -> exec-form with `/bin/sh -c` wrapper (preserves
  `|| touch /scratch/done` failure signal for CI sidecar)
- Removed unused `python3-requests` from CI apt-get (venv installs its own)
- `userdel ubuntu` before creating fhiruser (Noble has default ubuntu user at UID 1000)

### Release Workflow
- `.github/workflows/localdev.yaml` now triggers from `master` and publishes immutable
  `candidate-<sha>` tags instead of overwriting `latest` on every image change
- `.github/workflows/promote-localdev.yaml` provides a separate manual promotion step
  that retags a tested candidate to `latest` in GHCR and Docker Hub without rebuilding
- This preserves a stable `latest` while giving testers a concrete image digest to validate

## Results

### Trivy Scan Comparison

| Image | HIGH | CRITICAL | Size |
|-------|------|----------|------|
| **Old** `hl7fhir/ig-publisher-base:latest` | 1,075 | 26 | 1.19 GB |
| **New** `localdev` build from source | 0 | 0 | 824 MB |
| **New** `ci` build from source | 0 | 0 | 908 MB |

These zero-count results are from local builds of the updated Dockerfile scanned with
Trivy 0.67.2. They do not imply that the public `latest` tags have already been replaced.

### Component Versions

| Component | Old | New |
|-----------|-----|-----|
| Java | OpenJDK 23 (EOL) | Temurin 21.0.10 LTS |
| Node.js | 20.13.1 (EOL) | 22.22.2 LTS |
| Ruby | 3.1.2 (EOL) | 3.2.3 |
| Jekyll | 4.3.3 | 4.4.1 |
| SUSHI | (installed at runtime) | v3.18.1 |
| npm | 10.x | 10.9.7 (picomatch patched) |

### Functional Verification

Built a minimal SUSHI-based IG end-to-end in the localdev image:
- SUSHI: compiled FSH -> FHIR StructureDefinition
- IG Publisher: validated resources, generated HTML, ran Jekyll
- Result: 584 HTML pages, 9,018 links checked, 0 broken links, 0 invalid XHTML
- Build time: ~2 minutes, peak memory 729 MB

## Stages Preserved

All three Dockerfile stages are maintained:

| Stage | Target | Published As | Purpose |
|-------|--------|-------------|---------|
| `gem-builder` | (throwaway) | — | Compile native Ruby gems |
| `base` -> `localdev` | `candidate-<sha>` automatically, `latest` via promotion | Docker Hub + GHCR | Local development |
| `base` -> `ci` | GCR CI image | GCR | Automated K8s builds |

## Remaining Work

- [ ] Publish and test a candidate tag from `master`
- [ ] Promote a tested candidate to `latest` using `.github/workflows/promote-localdev.yaml`
- [ ] Modernize workflow: `docker/build-push-action@v6`, GHA caching, SHA-pinned actions
- [ ] Pin Python dependencies with hashes (`pip-compile --generate-hashes`)
- [ ] Merge or close stale Dependabot PRs (no longer relevant after base image change)
- [ ] Consider adding trivy scan as a CI step to prevent regression
