@AGENTS.md

# Deployment / git remotes (READ THIS)

The **only** live deployment is the `vyro` remote: **github.com/Vyro-ai/seo_email**, branch `main`.
Ship every change there. `vyro/main` auto-deploys on Vercel.

The `origin` remote (github.com/abdullahzubair-dotcom/Blog_Lead) is the **old** repo and is
**no longer used** — do not treat it as production. (You may still push there as a mirror, but
nothing depends on it.)

Note: `vyro/main` may have branch protection toggled on at times ("Require a pull request" /
"Require approvals"). When it's ON, direct pushes are rejected ("GH006: protected branch update
failed") and changes must go via a branch + PR that an admin approves. When it's OFF, push
straight to `main` as normal. The connected CLI account has WRITE (not admin) access, so it
can push but cannot change these settings.
