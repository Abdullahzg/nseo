#!/usr/bin/env bash
# Publish this repository to a NEW public GitHub repo with every leaked secret scrubbed from history.
#
# Why this exists: the pre-rebuild commit 2e63454 ("docs: rewrite PROJECT_HANDOFF.md…") pasted a
# real .env block into a tracked markdown file, and that commit was pushed. The file is long gone
# from HEAD, but it is still in history, and the hackathon rules want a PUBLIC repo. Publishing the
# history as-is would hand those values to every scraper that watches new public repos.
#
# What it does NOT do: touch your working repository. It clones into a temp directory, rewrites
# THAT clone with git-filter-repo (every commit kept, dates and authorship preserved), verifies the
# result, and pushes it to a new remote.
#
# Usage:
#   scripts/publish-clean.sh                                  # rewrite + verify only, no push
#   scripts/publish-clean.sh git@github.com:<you>/nseo.git     # rewrite, verify, then push
#
# Needs: git, and python with git-filter-repo (pip install git-filter-repo).
set -euo pipefail
REMOTE="${1:-}"

FR=""
if command -v git-filter-repo >/dev/null 2>&1; then FR="git-filter-repo"
elif python -m git_filter_repo --version >/dev/null 2>&1; then FR="python -m git_filter_repo"
elif python3 -m git_filter_repo --version >/dev/null 2>&1; then FR="python3 -m git_filter_repo"
else
  python -m pip install --user git-filter-repo >/dev/null 2>&1 || python3 -m pip install --user git-filter-repo >/dev/null
  FR="python -m git_filter_repo"
fi

SRC="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
echo "clean clone -> $WORK/repo"
git clone --quiet --no-local "$SRC" "$WORK/repo"
cd "$WORK/repo"

# Every secret SHAPE that has ever appeared in this history. Shapes, not literals, so no real value
# has to be written into this file to remove it.
#   AQ.    Google/Vertex express key  (the one that actually leaked, in PROJECT_HANDOFF.md)
#   AIza   Google API key
#   tvly-  Tavily
#   v1.Cm  Nebius Token Factory
#   sk-or-v1- OpenRouter · gsk_ Groq · sk- generic
# Assignments are caught too, so a value with an unknown shape still goes.
cat > "$WORK/replacements.txt" <<'EOF'
regex:AQ\.[A-Za-z0-9_\-]{20,}==>REDACTED_GOOGLE_KEY
regex:AIza[0-9A-Za-z_\-]{30,}==>REDACTED_GOOGLE_KEY
regex:tvly-[0-9A-Za-z_\-]{20,}==>REDACTED_TAVILY_KEY
regex:v1\.Cm[0-9A-Za-z_.\-]{40,}==>REDACTED_NEBIUS_KEY
regex:sk-or-v1-[0-9A-Za-z_\-]{10,}==>REDACTED_OPENROUTER_KEY
regex:gsk_[0-9A-Za-z]{20,}==>REDACTED_GROQ_KEY
regex:sk-[0-9A-Za-z_\-]{30,}==>REDACTED_KEY
regex:(?i)(CRON_SECRET|AUTH_SECRET|NEXTAUTH_SECRET|AGENT_SERVICE_TOKEN|SMTP_PASS|IMAP_PASS|GMAIL_SMTP_PASS)\s*=\s*\S+==>\1=REDACTED
EOF

# Belt and braces: the two files that ever held real values are removed from every commit, along
# with the private notes and test artefacts that were never meant to ship.
$FR --force --replace-text "$WORK/replacements.txt" \
  --path PROJECT_HANDOFF.md --invert-paths \
  --path ROTATION.md --invert-paths \
  --path _private --invert-paths \
  --path test-results --invert-paths

echo "verifying no known secret shape survives…"
LEAK_RE='AQ\.[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|tvly-[0-9A-Za-z_-]{20,}|v1\.Cm[0-9A-Za-z_.-]{40,}|sk-or-v1-[0-9A-Za-z_-]{10,}|gsk_[0-9A-Za-z]{20,}'
if git log -p --all | grep -E -m1 "$LEAK_RE"; then
  echo "STILL FOUND A SECRET - add its pattern to replacements.txt and rerun"; exit 2
fi
if git log --all --name-only --format= | sort -u | grep -qE '^(PROJECT_HANDOFF\.md|ROTATION\.md)$'; then
  echo "STILL FOUND A FILE THAT HELD SECRETS"; exit 2
fi
echo "history is clean: $(git rev-list --count HEAD) commits, first $(git log --reverse --format=%cs | head -1), last $(git log -1 --format=%cs)"

if [ -z "$REMOTE" ]; then
  echo
  echo "Verify-only run. Nothing was pushed, and your own repository was never touched."
  echo "The rewritten clone is at: $WORK/repo"
  echo "To publish: scripts/publish-clean.sh git@github.com:<you>/nseo.git"
  exit 0
fi

git remote add publish "$REMOTE"
git push --force publish HEAD:main
git push --force publish --tags || true
echo "pushed to $REMOTE (branch main). Your local repo is untouched."
echo "next: make the repo public, then set the GitHub Actions secrets APP_URL and CRON_SECRET (see DEPLOY.md)."
