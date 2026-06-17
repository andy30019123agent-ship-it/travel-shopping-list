#!/bin/bash
# 在 expo export 後補上 PWA（manifest + icons + iOS meta），讓「加到主畫面」像真 App
set -e
cd "$(dirname "$0")"
D=dist
sips -s format png -Z 192 assets/icon.png --out "$D/icon-192.png" >/dev/null
sips -s format png -Z 512 assets/icon.png --out "$D/icon-512.png" >/dev/null

cat > "$D/manifest.json" <<'JSON'
{
  "name": "免稅不是免費",
  "short_name": "免稅不是免費",
  "description": "出國購物清單：日韓即時比價、換算台幣、免稅門檻",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F6F0EA",
  "theme_color": "#E0567C",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
JSON

python3 - "$D/index.html" <<'PY'
import sys
p = sys.argv[1]
html = open(p, encoding='utf-8').read()
inject = (
  '<link rel="manifest" href="manifest.json">'
  '<meta name="apple-mobile-web-app-capable" content="yes">'
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
  '<meta name="apple-mobile-web-app-title" content="免稅不是免費">'
  '<link rel="apple-touch-icon" href="icon-192.png">'
)
if 'rel="manifest"' not in html:
    html = html.replace('</head>', inject + '</head>', 1)
    open(p, 'w', encoding='utf-8').write(html)
    print('PWA meta injected')
else:
    print('already injected')
PY
echo "PWA postbuild done"
