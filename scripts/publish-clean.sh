#!/usr/bin/env bash
# Publish this repository to a NEW public GitHub repo with the leaked secrets scrubbed from history.
#
# Why: commit 2e63454 (pre-rebuild) contains a Google Gemini key, and a few early .env-style values
# were pasted into commits. The rules want a public repo; nobody wants those strings in it. This
# script never touches your working repo: it clones into a temp dir, rewrites THAT clone with
# git-filter-repo (dates and authorship preserved, every commit kept), and pushes the result.
#
# Usage:
#   scripts/publish-clean.sh git@github.com:<you>/nseo.git
#
# Needs: git, python3 with git-filter-repo (pip install git-filter-repo).
set -euo pipefail
REMOTE="${1:-}"
[ -n "$REMOTE" ] || { echo "usage: $0 <new-empty-github-remote>"; exit 1; }
command -v git-filter-repo >/dev/null 2>&1 || python3 -m pip install --user git-filter-repo >/dev/null

SRC="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
echo "clean clone → $WORK"
git clone --quiet "$SRC" "$WORK/repo"
cd "$WORK/repo"

# Every secret-looking value that ever appeared in history, replaced with a marker.
# Add lines here if `git log -p | grep -E 'AIza|tvly-|v1\.Cm|sk-'` shows more.
cat > "$WORK/replacements.txt" <<'EOF'
regex:AIza[0-9A-Za-z_-]{30,}==>REDACTED_GOOGLE_KEY
regex:tvly-[0-9A-Za-z_-]{20,}==>REDACTED_TAVILY_KEY
regex:v1\.Cm[0-9A-Za-z_.-]{40,}==>REDACTED_NEBIUS_KEY
regex:sk-[0-9A-Za-z_-]{30,}==>REDACTED_KEY
EOF
git filter-repo --force --replace-text "$WORK/replacements.txt" --path _private --invert-paths --path test-results --invert-paths

echo "verifying no known secret patterns remain in history…"
if git log -p --all | grep -E -m1 'AIza[0-9A-Za-z_-]{30,}|tvly-[0-9A-Za-z_-]{20,}|v1\.Cm[0-9A-Za-z_.-]{40,}'; then
  echo "STILL FOUND A SECRET — add its pattern to replacements.txt and rerun"; exit 2
fi
echo "history is clean: $(git rev-list --count HEAD) commits, first $(git log --reverse --format=%cs | head -1), last $(git log -1 --format=%cs)"

git remote add publish "$REMOTE"
git push --force publish HEAD:main
git push --force publish --tags || true
echo "pushed to $REMOTE (branch main). Your local repo is untouched."
echo "next: make the repo public, then set the GitHub Actions secrets APP_URL and CRON_SECRET (see DEPLOY.md)."
