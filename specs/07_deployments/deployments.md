---
feature: 07_deployments
title: "Deployments"
status: paused
created: 2026-10-01
edited: 2026-10-01
---

# Deployments

We want a proper deployment mechanism for our karpathy app:

- Built in ansible
- Callable by just wrapper, i.e. just deploy <target>
- That works for local as well (for tests)
- That deploys from github versions
- That also works deployment into our hetzner / tailscale setup
- That also deploys a monitoring stack based. Pls suggest monitoring technologies to choose from withg pros and cons
