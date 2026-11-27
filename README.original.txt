하천·호수 지도 — 브라우저 전용 배포본

1. Cloudflare Pages에서 Workers & Pages → 만들기 → Pages → Direct Upload를 선택합니다.
   ZIP 또는 압축을 푼 폴더의 내용을 올립니다. index.html과 assets 폴더가 배포 루트에 있어야 합니다.
   https://developers.cloudflare.com/pages/get-started/direct-upload/
2. 배포 화면에서 발급된 https://프로젝트이름.pages.dev 주소를 확인합니다.
3. Google Auth Platform에서 기존 Earth Engine 프로젝트를 선택합니다.
   앱이 외부 테스트 상태라면 사용할 Google 계정을 테스트 사용자에 추가합니다.
   웹 애플리케이션 OAuth 클라이언트를 만들고 승인된 JavaScript 원본에 정확한 pages.dev HTTPS 주소를 넣습니다.
   Google 인증에 필요한 Earth Engine API 활성화와 프로젝트 등록 상태도 확인합니다.
   https://developers.google.com/earth-engine/guides/access
4. 방금 배포된 웹앱을 엽니다. Sentinel-2 배경을 선택한 뒤 Cloud 프로젝트 ID와
   OAuth 웹 클라이언트 ID(...apps.googleusercontent.com)를 입력하고 Google 로그인을 누릅니다.
   클라이언트 보안 비밀번호나 서비스 계정 키는 입력하지 않습니다.
5. 수계 분석 후 출력 미리보기 또는 지도 저장을 사용합니다. PPTX는 16:9입니다.

Python, Node.js 설치나 빌드 명령은 필요하지 않습니다. 파일을 직접 열기보다 배포된 주소를 사용하세요.
Sentinel-2는 최근 180일 영상의 자연색 합성이며, Google 어스 화면의 위성영상과는 별도 데이터입니다.
앱 및 내장 공개 도형 파일은 해당 호스팅 주소에서 내려받을 수 있습니다.

도로 데이터 제공처에서 브이월드 도로중심선을 선택할 수 있습니다.
브이월드 키는 배포된 도메인과 데이터 API 사용 권한을 확인하세요.
실제 키로 도로 레이어와 번호 속성은 아직 검증하지 않았습니다.
도로번호 자동 인식에 실패하면 제공된 속성 목록을 확인하고 고급 설정에서 속성명을 지정할 수 있습니다.
