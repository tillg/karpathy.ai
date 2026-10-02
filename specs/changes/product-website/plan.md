---
feature: product-website
title: "Plan: product website at karpathy.app"
status: applied
order: 4
created: 2026-10-02
edited: 2026-10-02
---

# Plan: product website at karpathy.app

Ordered so that each test builds on the previous step, and Pages is enabled before the workflow lands on
`main`. Steps marked **(manual)** are outward-facing and done by the maintainer, not by the agent.

## Site and its test

- [x] Set up the site test harness: `site/build.sh`, `_site/` in `.gitignore`, and `site/site.test.mjs`
      with one trivial test that runs `build.sh` and asserts `_site/` exists
  - Test first: `site/site.test.mjs` › "build assembles _site" — fails today: `site/build.sh` doesn't exist
  - Verify: `node --test site/site.test.mjs` → 1 pass; `git check-ignore _site` → prints `_site`
- [x] Wire the site test into the root `npm test` by making `site/` an npm workspace (`"test": "node
      site.test.mjs"`), leaving the root `test` script unchanged
  - Test first: none — config only
  - Verify: `npm test` → workspace suites and the site test both run and pass (site test name visible in
    the output)
- [x] Add the start page `site/index.html` (hero with logo, tagline, 3–4 feature blocks, "how it works",
      CTA to the GitHub repo, footer) with relative links only
  - Test first: `site.test.mjs` › "index.html has title, lang, viewport and repo link" and › "no
    root-absolute paths" — fail today: no `index.html`
  - Verify: `node --test site/site.test.mjs` → all pass
- [x] Make every local `href`/`src` resolve: icons copied to `_site/icons/`, favicons and
      apple-touch icon linked
  - Test first: `site.test.mjs` › "every local href/src exists in _site" — fails today: icons not copied /
    `style.css` missing
  - Verify: `node --test site/site.test.mjs` → all pass
- [x] Style the page in `site/style.css` with the app's `:root` token blocks (light + dark) copied from
      `apps/web/src/styles.css`, phone width first
  - Test first: `site.test.mjs` › "site tokens equal the app's (light and dark)" — fails today: no
    `style.css`; seen failing once more by changing one copied value
  - Verify: `node --test site/site.test.mjs` → all pass
- [x] Add `just site` (build + serve `_site/` on localhost) and check the page visually
  - Test first: none — visual check, no automatable assertion beyond the tests above
  - Verify: `just site` serves `http://localhost:<port>/` → HTTP 200; Playwright screenshots at phone
    (390 px) and desktop (1280 px) width, light and dark, saved to `tmp/site/`, read and checked: logo
    visible, hero, all feature blocks, footer at the bottom, no horizontal scroll

- [x] Say that the project ships code, not a running service: a "Run it yourself" section listing what it
      takes (a server, Tailscale, a set of secrets and keys), and an offer to host it on request via
      `mailto:till.gartner@gmail.com`
  - Test first: `site.test.mjs` › "explains self-hosting and offers hosting by mail" — fails today: no
    `#self-host` section, no mailto link
  - Verify: `node --test site/site.test.mjs` → all pass; screenshot of `#self-host` at 390 px read and checked

## Deployment

- [x] **(manual, one-time)** Enable GitHub Pages with source "GitHub Actions" (no custom domain yet, so
      the first deploy can be checked at `tillg.github.io`):
      `gh api -X POST repos/tillg/karpathy.app/pages -f build_type=workflow`
  - Test first: none — repository setting
  - Verify: `gh api repos/tillg/karpathy.app/pages --jq '.build_type'` → `workflow`
- [x] Add `.github/workflows/pages.yml` (site test → `upload-pages-artifact` of `_site` → `deploy-pages`),
      triggered by pushes to `main` on the site paths and by `workflow_dispatch`
  - Test first: none — CI config; checked mechanically instead
  - Verify: `actionlint .github/workflows/pages.yml` exits 0 (or, if actionlint isn't installed,
    `python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/pages.yml"))'`); `grep -q 'path: _site'
    .github/workflows/pages.yml`
- [x] Point the README to the website: link under the title, plus a "Website" section (source in `site/`,
      preview with `just site`, deploys on push to `main`)
  - Test first: none — docs
  - Verify: `grep -c 'https://karpathy.app' README.md` ≥ 1 and `grep -q '^## Website' README.md`
- [x] Push to `main` (after the user's go-ahead) and check the first deploy
  - Test first: none — end-to-end
  - Verify: `gh run list --workflow pages.yml -L 1 --json conclusion --jq '.[0].conclusion'` → `success`;
    `curl -s https://tillg.github.io/karpathy.app/ | grep -q '<title>.*karpathy.app'` and
    `curl -sfo /dev/null https://tillg.github.io/karpathy.app/icons/icon-512.png`
- [x] **(manual)** Set the custom domain, right before the DNS cutover (from now on `tillg.github.io/karpathy.app/`
      redirects to `karpathy.app`): `gh api -X PUT repos/tillg/karpathy.app/pages -f cname=karpathy.app`
  - Test first: none — repository setting
  - Verify: `gh api repos/tillg/karpathy.app/pages --jq '.cname'` → `karpathy.app`

## Domain cutover

- [x] **(manual)** At GoDaddy: unpublish the Website Builder site; replace the apex A records with
      `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; set `www` to CNAME
      `tillg.github.io`; leave `app.karpathy.app` untouched. Verify the domain in the GitHub account's
      Pages settings (TXT record)
  - Test first: none — external DNS
  - Verify: `dig +short A karpathy.app | sort` → the four GitHub IPs; `dig +short www.karpathy.app` →
    `tillg.github.io.` first; `dig +short A app.karpathy.app` → `100.116.203.50`
- [x] Enforce HTTPS once GitHub has issued the certificate and check the live site
  - Test first: none — end-to-end
  - Verify: `gh api -X PUT repos/tillg/karpathy.app/pages -F https_enforced=true` succeeds;
    `curl -sI https://karpathy.app | grep -i '^server: GitHub.com'` matches;
    `curl -sI https://www.karpathy.app` → 301 to `https://karpathy.app/`; `curl -s https://karpathy.app |
    grep -q '<title>.*karpathy.app'`

System docs are updated at `/spec:archive`.
