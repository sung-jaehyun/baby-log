#!/usr/bin/env bash
# 배포 전 실행: sw.js의 VERSION을 지금 시각으로 바꿔, 휴대폰들이 새 버전을 받게 한다.
set -euo pipefail
cd "$(dirname "$0")/.."
v="v$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)"
sed -i.bak -E "s/^const VERSION = '[^']*';/const VERSION = '${v}';/" sw.js && rm -f sw.js.bak
grep -q "const VERSION = '${v}';" sw.js || { echo "VERSION 갱신 실패"; exit 1; }
for f in app.js art.js demo.js sw.js; do node --check "$f"; done
echo "버전: ${v}"
