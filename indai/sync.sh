#!/usr/bin/env bash
# Re-copy the modules INDAI's website shares with the Quest app (bongs-git/jarvis-command-center).
#
#   ./sync.sh                      # expects the source repo checked out next to this repo
#   ./sync.sh /path/to/jarvis-command-center
#
# Shared files are copied byte for byte. Never edit them here: change them in the source repo, then run this.
# Website-only files (app.js, views.js, sheets.js, chart.js, demo.js, hud.js, panels.js, css/, index.html, sw.js) are not touched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$HERE/../../jarvis-command-center}"
[ -f "$SRC/js/indai.js" ] || { echo "Can't find the source repo at: $SRC" >&2; echo "Usage: ./sync.sh /path/to/jarvis-command-center" >&2; exit 1; }

SHARED_JS="relay.js feeds.js market.js analysis.js options.js signals.js store.js indai.js voice.js speech.js"
changed=0; voice_changed=0
copy() { # copy <from> <to>
  mkdir -p "$(dirname "$2")"
  if ! cmp -s "$1" "$2"; then
    cp "$1" "$2"; echo "updated  ${2#$HERE/}"; changed=$((changed + 1))
    case "$2" in *voice-worker.js|*/vendor/ort/*) voice_changed=1;; esac
  fi
}
for f in $SHARED_JS; do copy "$SRC/js/$f" "$HERE/js/$f"; done
copy "$SRC/js/workers/voice-worker.js" "$HERE/js/workers/voice-worker.js"
for f in "$SRC"/vendor/ort/*; do copy "$f" "$HERE/vendor/ort/$(basename "$f")"; done
copy "$SRC/brand/indai-logo.png" "$HERE/brand/indai-logo.png"
for f in "$SRC"/icons/*.png; do copy "$f" "$HERE/icons/$(basename "$f")"; done

SHA="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
DATE="$(date -u +%Y-%m-%d)"
if [ -f "$HERE/SYNC.md" ]; then
  sed -i.bak -E "s|^Synced at commit: .*|Synced at commit: \`$SHA\` ($DATE)|" "$HERE/SYNC.md" && rm -f "$HERE/SYNC.md.bak"
fi
# The service worker keeps the voice runtime in a cache named after the commit it came from: rename it when those files change.
if [ "$voice_changed" = 1 ]; then
  sed -i.bak -E "s|^const VOICE = 'indai-web-voice-[^']*';|const VOICE = 'indai-web-voice-${SHA:0:7}';|" "$HERE/sw.js" && rm -f "$HERE/sw.js.bak"
  echo "updated  sw.js (voice cache name)"
fi
echo "$changed file(s) updated from $SHA"

# The shared indai.js imports a few names from hud.js and panels.js. On the website those two files are
# small stand-ins (no 3D), so make sure they still export everything the shared code asks for.
if command -v node >/dev/null 2>&1; then
  node - "$HERE" <<'NODE'
const fs = require('fs'), path = require('path');
const here = process.argv[2], js = path.join(here, 'js');
const SHARED = ['relay.js', 'feeds.js', 'market.js', 'analysis.js', 'options.js', 'signals.js', 'store.js', 'indai.js', 'voice.js', 'speech.js'];
const STANDINS = ['hud.js', 'panels.js'];
let bad = 0;
for (const f of SHARED) {
  const src = fs.readFileSync(path.join(js, f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w.-]+)'/g)) {
    const file = m[2];
    if (!fs.existsSync(path.join(js, file))) { console.error(`MISSING  js/${file} (imported by ${f})`); bad++; continue; }
    if (!STANDINS.includes(file)) continue;
    const target = fs.readFileSync(path.join(js, file), 'utf8');
    for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name}\\b`).test(target)) { console.error(`MISSING  js/${file} must export "${name}" (used by ${f})`); bad++; }
    }
  }
}
// Calls the shared brain makes on the app object: flag any the website's app.js does not define.
const appSrc = ['app.js', 'views.js', 'sheets.js'].map(f => fs.readFileSync(path.join(js, f), 'utf8')).join('\n');
const used = new Set([...fs.readFileSync(path.join(js, 'indai.js'), 'utf8').matchAll(/\bapp\.([a-zA-Z_]+)\s*\??\.?\(/g)].map(m => m[1]));
for (const name of used) if (!new RegExp(`app\\.${name}\\s*=|\\b${name}\\s*\\(`).test(appSrc)) { console.error(`CHECK    indai.js calls app.${name}() and the website does not define it`); bad++; }
console.log(bad ? `${bad} thing(s) to fix before publishing` : 'Stand-ins and app interface still match the shared code.');
process.exit(bad ? 2 : 0);
NODE
fi
