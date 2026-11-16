# 설치 가이드 — 회사 PC · 집 PC 를 오가며 쓰기 (D-032)

## 결론
**코드는 인터넷(정적 호스팅) 한 곳에, PC 에는 "주소 등록"만.**
v2 부터는 서버 프로그램이 필요 없어서(D-029) 빌드 결과 파일만 올려 두면 된다.
각 PC 는 설치 스크립트를 **한 번** 실행하면 끝이고, 이후 업데이트는 호스팅만 갱신하면 모든 PC 에 자동 반영된다.
지도 데이터는 pptx 안에 있으므로 파일만 들고 다니면 된다.

| 방법 | PC 마다 필요한 것 | 업데이트 | 추천 |
|---|---|---|---|
| **A. 정적 호스팅 + 설치 스크립트** | `install-addin.cmd` 1회 (Node·관리자권한 불필요) | 호스팅만 다시 올리면 끝 | ★ 일상 사용 |
| B. 개발 모드 (지금 방식) | Node.js + 저장소 + `1_setup` + 매번 `2_start` 창 유지 | `git pull` + `1_setup` | 개발할 PC 만 |
| C. 회사 M365 중앙 배포 | 없음 (관리자가 배포) | 관리자 | 팀 전체 확산 시 |

## A. 정적 호스팅 (권장) — 최초 1회 준비 (약 20분)
1. **VWorld 키를 배포 주소용으로 하나 더 발급** (vworld.kr → 오픈API → 인증키 발급, 서비스 URL 에 호스팅 주소 입력).
   VWorld 키는 도메인 단위로 검사하므로 localhost 용 키는 배포 주소에서 안 될 수 있다 `[확인 필요]`.
2. 빌드 (배포용 키를 넣어서):
   ```powershell
   $env:VITE_VWORLD_KEY_PUBLIC = "배포용키"
   npm run build
   node scripts/make-manifest.mjs https://slidemap-xxxx.pages.dev
   ```
   - 개인 키(`.env.local`)는 배포 번들에 들어가지 않는다(D-038). 공개 키를 안 넣으면 각자 패널 설정에서 키 입력.
3. 업로드 — Cloudflare Pages 예시 (무료, `wrangler` 이미 설치돼 있음):
   ```powershell
   npx wrangler login
   npx wrangler pages deploy dist --project-name slidemap-xxxx
   ```
   GitHub Pages / Vercel / Netlify 도 동일 (HTTPS 만 되면 됨).
4. 각 PC 에서 (회사·집 각각 1번):
   ```powershell
   install\install-addin.cmd https://slidemap-xxxx.pages.dev/manifest.xml
   ```
   → PowerPoint 다시 열기 → 홈 탭 **[Slide Map]**. 제거는 `install\uninstall-addin.cmd`.
   - 이 스크립트는 저장소 없이도 돌아간다: `install` 폴더(2개 파일)만 USB/메일/OneDrive 로 옮겨도 됨.

### 회사 PC 에서 막힐 때
- 사내 정책으로 "개발자 애드인"이 막혀 있으면 → 웹 PowerPoint(office.com)에서 **삽입 → 추가 기능 → 내 추가 기능 업로드 → manifest.xml** 로도 쓸 수 있다.
- 사내 보안상 외부 지도 서버 접속이 막히면 배경지도가 안 보인다 → 회사 네트워크에서 `api.vworld.kr`, `tiles.openfreemap.org` 허용 여부 확인.
- 팀 전체가 쓰게 되면 M365 관리자에게 **통합 앱(중앙 배포)** 으로 manifest 등록을 요청 → 개인 설치 불필요.

## B. 개발 모드 (코드를 고치는 PC)
1. 저장소를 개인 GitHub(비공개)에 올려 두고 각 PC 에서 clone:
   ```powershell
   git remote add origin https://github.com/<계정>/slide-map.git
   git push -u origin main
   ```
   (`.env.local` 은 커밋되지 않으니 PC 마다 만들 것)
2. `1_setup.cmd` → PowerPoint 닫고 `2_start.cmd`.
- 개발용(Id 55565cbb…)과 배포용(Id 8f1c2d7e…)은 동시에 설치 가능 → 리본에 "Slide Map 패널"(개발)과 "Slide Map"(배포)가 따로 뜬다.

## QGIS 플러그인 (각 PC)
`qgis-plugin\install.cmd` → QGIS 플러그인 관리자 → 설치됨 → **Slide Map Bridge** 체크.
다음 단계로, 호스팅에 `plugins.xml` 을 올리면 QGIS 의 "저장소 추가"로 자동 업데이트도 가능하다(미구현).
