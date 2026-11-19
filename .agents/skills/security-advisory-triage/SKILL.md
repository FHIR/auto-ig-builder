---
name: security-advisory-triage
description: Decide whether a published vulnerability (JDK, Ruby, Node, nginx, kernel, ...) affects build.fhir.org autobuild or the other VMs in the fhir-org-starter-project GCP project, mitigate it, and track the fix through to production. Use when someone posts an advisory link and asks "do we need to update?".
---

# Triage a security advisory for autobuild

## 1. What do we actually run?

Check the real images, not the Dockerfile or what you remember:

```bash
for i in gcr.io/fhir-org-starter-project/ig-build:latest gcr.io/fhir-org-starter-project/ci-build \
         gcr.io/fhir-org-starter-project/caddy-ratelimit:latest; do
  docker run --rm --pull always --entrypoint sh "$i" -c \
    'java -version 2>&1 | sed -n 2p; ruby -v; node -v; jekyll -v; command -v nginx' 2>&1
done
kubectl --context fhir-org get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u
```

- build.fhir.org is served by Caddy (Go), not nginx.
- Toolchains in `ig-build`/localdev are pinned in `images/ig-publisher/Dockerfile`;
  see `images/ig-publisher/README.md`.
- For CPU-specific bugs, check the node CPUs (`k8s/dev-setup.md`, node pools):
  E2 machines don't pin a CPU generation.

## 2. Does it matter here? Use the threat model

Build pods run untrusted code by design: anyone who can trigger a build
controls the IG content, templates, SUSHI input and, while the publisher runs
`jekyll build` without `--safe`, Ruby `_plugins`. The pods are locked down
(non-root, seccomp, no credentials, separate upload sidecar). So:

- A bug that only gives code execution inside the build pod adds little until
  the publisher enables Jekyll safe mode (announced for an upcoming release);
  after that, Ruby and Jekyll bugs matter more.
- Bugs that escape the pod (kernel, container runtime) or reach ci-build,
  Caddy or the trigger matter a lot.
- Client-side bugs matter too: builds talk to tx.fhir.org, ecosystem.hl7.org
  and package servers.

Say which of these applies and why; don't stop at "the version is affected".

## 3. Mitigate now if needed

Prefer a runtime setting in `triggers/ig-commit-trigger/job.json` (for example
a `JAVA_TOOL_OPTIONS` flag), shipped with a trigger deploy and tested per the
`rollout-and-test` skill. Remove it once the fixed toolchain is in production.

## 4. Track the fix

- Upstream releases reach us through the pins. `update-pins.sh` and the daily
  "Update Toolchain Pins" PR pick up new Temurin, Ruby, Node and Jekyll releases;
  run the workflow by hand to pick one up right away
  (`gh workflow run update-pins.yaml`).
- Sources ship fixes at different speeds. When a Java fix landed, Adoptium had
  the tarball a day before the `eclipse-temurin` image. Ruby's official image
  had the fixed Ruby a day after release, while Ubuntu still had none. nixpkgs
  merged both fast, but Ruby went through `staging` and both were days to
  weeks from the channels. Respins can be per-architecture (an x64-only JDK
  respin), and the pins allow that.
- Then roll out per `rollout-and-test`, including promoting localdev, since
  IG authors run it too.

## 5. Other VMs in the project, without logging in

The project also runs tx.fhir.org, tx-dev, www.fhir.org, packages2,
ecosystem.hl7.org and the validator on plain VMs that this repo doesn't
manage. To size exposure from outside:

```bash
P=fhir-org-starter-project
gcloud compute instances list --project $P            # what runs, which OS image
gcloud compute firewall-rules list --project $P \
  --filter="direction=INGRESS AND disabled=false"     # what the internet can reach
# installed packages, for VMs whose OS Config agent reports:
gcloud compute os-config inventories describe VM --project $P --location ZONE --view=full --format=json |
  jq -r '.installed_packages.aptPackage[] | "\(.packageName)=\(.version)"'
# what a public site negotiates (HTTP/2? HTTP/3?) for every name in its cert:
echo | openssl s_client -connect IP:443 -servername HOST -alpn h2,http/1.1 2>/dev/null | grep ALPN
```

Config-dependent questions (for example which nginx directives are in use)
can't be answered from outside: ask before logging in, since those VMs belong
to other maintainers. Stopped VMs on end-of-life OS images are worth flagging
for deletion.
