# Notes for coding agents

Record durable, non-sensitive lessons about operating or changing this repo as
skills under `.agents/skills/` (or by updating an existing one), not in an
agent's private per-machine memory, so they travel with the repo and other
maintainers and agents can use them. Keep procedures in the developer docs
(`k8s/dev-setup.md` and the component READMEs) and have skills point to them
rather than repeat them. Secrets, tokens and personal details stay out of both.

Skills:

- `.agents/skills/rollout-and-test/SKILL.md`: read before shipping any change
  to the build pipeline (job template, images, trigger, ci-build).
- `.agents/skills/security-advisory-triage/SKILL.md`: when asked whether a
  published vulnerability affects autobuild or the project's other VMs.
