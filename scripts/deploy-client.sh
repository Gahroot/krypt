#!/usr/bin/env bash
#
# One-command build + deploy for the static Phaser/Vite client.
#
# It bakes VITE_BACKEND_URL (the deployed wss:// server URL) into a production
# build, then publishes packages/client/dist/ to a static host. Testers just
# open the printed URL — no local setup.
#
# Usage:
#   VITE_BACKEND_URL=wss://api.example.com scripts/deploy-client.sh <target>
#
#   <target> = netlify | cloudflare | build
#     netlify     deploy dist/ to Netlify   (needs: npx netlify-cli, NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID or `netlify link`)
#     cloudflare  deploy dist/ to Cloudflare Pages (needs: npx wrangler, CLOUDFLARE_API_TOKEN; set CF_PAGES_PROJECT)
#     build       just produce dist/ (copy it to any nginx/static host yourself)
#
# Examples:
#   VITE_BACKEND_URL=wss://api.example.com scripts/deploy-client.sh netlify
#   VITE_BACKEND_URL=wss://api.example.com CF_PAGES_PROJECT=cryptomaple scripts/deploy-client.sh cloudflare
#   VITE_BACKEND_URL=wss://api.example.com scripts/deploy-client.sh build
#
# IMPORTANT: after deploying, set the server's CORS_ORIGIN to the exact client
# origin this prints (scheme + host, no trailing slash), or /auth/* calls fail
# with a CORS error.

set -euo pipefail

TARGET="${1:-build}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/packages/client/dist"

if [[ -z "${VITE_BACKEND_URL:-}" ]]; then
  echo "ERROR: VITE_BACKEND_URL is not set." >&2
  echo "  e.g. VITE_BACKEND_URL=wss://api.example.com $0 $TARGET" >&2
  exit 1
fi

case "$VITE_BACKEND_URL" in
  wss://*) ;;
  ws://*)
    echo "WARNING: VITE_BACKEND_URL is ws:// — an https:// page cannot open a plaintext WebSocket." >&2
    echo "         Use wss:// for any public deployment, or the browser will block the connection." >&2
    ;;
  *)
    echo "ERROR: VITE_BACKEND_URL must start with wss:// (or ws:// for localhost). Got: $VITE_BACKEND_URL" >&2
    exit 1
    ;;
esac

echo "▶ Building client with VITE_BACKEND_URL=$VITE_BACKEND_URL"
( cd "$REPO_ROOT" && VITE_BACKEND_URL="$VITE_BACKEND_URL" pnpm --filter @maple/client build )

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "ERROR: build did not produce $DIST_DIR/index.html" >&2
  exit 1
fi
echo "✓ Built $DIST_DIR"

case "$TARGET" in
  build)
    echo "✓ Done. Serve $DIST_DIR/ from any static host (nginx, Caddy, S3, …)."
    echo "  Reminder: set the server's CORS_ORIGIN to the origin you serve it from."
    ;;
  netlify)
    echo "▶ Deploying to Netlify (production)…"
    npx --yes netlify-cli deploy --dir "$DIST_DIR" --prod
    echo "✓ Deployed. Set the server's CORS_ORIGIN to the Netlify site origin printed above."
    ;;
  cloudflare)
    PROJECT="${CF_PAGES_PROJECT:-cryptomaple-client}"
    echo "▶ Deploying to Cloudflare Pages (project: $PROJECT)…"
    npx --yes wrangler pages deploy "$DIST_DIR" --project-name "$PROJECT"
    echo "✓ Deployed. Set the server's CORS_ORIGIN to the *.pages.dev origin printed above."
    ;;
  *)
    echo "ERROR: unknown target '$TARGET'. Use: netlify | cloudflare | build" >&2
    exit 1
    ;;
esac
