#!/bin/sh
# Earth Engine 클라이언트 라이브러리를 vendor/ 에 내려받아 고정한다(Sentinel-2 배경을 쓸 때만 필요).
# 앱은 vendor/ee_api_js.js 가 있으면 CDN 대신 이 파일을 쓴다. 인터넷이 되는 PC에서 한 번 실행하세요.
set -eu
cd "$(dirname "$0")/.."
URL="${EE_URL:-https://cdn.jsdelivr.net/gh/google/earthengine-api@master/javascript/build/ee_api_js.js}"
curl -fsSL "$URL" -o vendor/ee_api_js.js
echo "저장: vendor/ee_api_js.js ($(wc -c < vendor/ee_api_js.js) bytes)"
echo "sha256: $(sha256sum vendor/ee_api_js.js | cut -d' ' -f1)"
echo "이 파일을 저장소에 커밋하면 배포본이 외부 스크립트에 의존하지 않습니다."
