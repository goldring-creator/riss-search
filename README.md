# RISS 논문 수집기

RISS(학술연구정보서비스)에서 키워드 또는 논문 제목으로 국내 학술지 논문을 자동 수집하고 PDF를 다운로드하는 도구입니다.

> ⚠️ **학위논문은 수집되지 않습니다.** 국내 학술지 논문만 대상입니다.

**지원 대학:** 한국외대 · 고려대 · 서울대 · 성균관대 · 경희대 · 부산대 · 건국대 · 국민대 · 충남대 · 충북대

---

## 실행 방법

### GUI (권장) — Mac / Windows

**1. 다운로드**

이 페이지 상단 **Code → Download ZIP** → 압축 해제

**2. 실행**

**[Mac]**
- `RISS 논문수집.app` 우클릭 → **"열기"** 선택
  (첫 실행 시 1회만. 이후엔 더블클릭)
- 열리지 않으면 압축 해제한 폴더 안에서 터미널을 열고 실행:
  ```bash
  xattr -dr com.apple.quarantine .
  ```

**[Windows]**
- `RISS-search.bat` 더블클릭
- "Windows가 PC를 보호했습니다" 창이 뜨면 → **추가 정보** → **실행**

**3. 최초 설정**
- 최초 실행 시 Node.js · 브라우저 · 의존성 자동 설치 (인터넷 필요, 약 3~5분)
- 앱 화면에서 **대학교 선택 → 도서관 ID · 비밀번호 입력 → 저장**
- (선택) Claude API 키 입력 시 AI 분류 기능 사용 가능

---

### CLI (직접 실행)

Node.js가 설치되어 있어야 합니다. [nodejs.org](https://nodejs.org) LTS 버전 설치.

**의존성 설치 (최초 1회)**
```bash
cd _app
npm install
npx playwright install chromium
```

**자격증명 설정**
`_app/.env.example`을 `_app/.env`로 복사 후 편집:
```
RISS_ID=학번
RISS_PW=도서관비밀번호
RISS_UNIVERSITY=hufs
```
대학 ID: `hufs` · `korea` · `snu` · `skku` · `khu` · `pusan` · `konkuk` · `kookmin` · `cnu` · `cbnu`

**키워드 검색**
```bash
cd _app
node core/riss-main.js \
  --keyword "검색어1" --keyword "검색어2" \
  --pages 3 \
  --year-from 2015 --year-to 2024 \
  --kci-only \
  --output-dir ~/Downloads/RISS_출력
```

**제목으로 특정 논문 다운로드**
```bash
node core/riss-main.js \
  --title "논문 제목 1" \
  --title "논문 제목 2" \
  --skip-classify \
  --output-dir ~/Downloads/RISS_출력
```

**주요 옵션**

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--keyword` | 키워드 검색 (여러 개 가능) | — |
| `--title` | 제목 검색 (여러 개 가능) | — |
| `--pages` | 키워드당 수집 페이지 수 | 2 |
| `--year-from` / `--year-to` | 연도 범위 | 전체 |
| `--kci-only` | KCI 등재 논문만 수집 | false |
| `--top-n` | 피인용 상위 N건만 | 전체 |
| `--skip-download` | PDF 다운로드 건너뜀 | false |
| `--skip-classify` | AI 분류 건너뜀 | false |
| `--headed` | 브라우저 창 표시 (차단 우회용) | false |
| `--output-dir` | 결과 저장 경로 | `_app/output/` |

---

### Claude Code MCP (말로 시키기)

Claude Code 사용자라면 MCP 서버로 등록해 대화로 논문을 수집할 수 있습니다.

**등록**
```bash
claude mcp add riss -- node "<이 폴더 경로>/_app/mcp/server.js"
```

**자격증명 설정** (`~/.riss/.env` 파일 생성)
```
RISS_ID=학번
RISS_PW=도서관비밀번호
RISS_UNIVERSITY=hufs
```

**사용 예시**
```
"RISS에서 '교사 AI 활용' 키워드로 2020년 이후 논문 수집해줘"
```

사용 가능한 도구: `riss_verify_login` · `riss_search` · `riss_download` · `riss_status`

---

## 사용 방법 (GUI)

### ① 키워드 입력
Enter 또는 쉼표로 키워드 태그 추가. 복수 키워드는 각각 검색 후 병합됩니다.

### ② 필터 설정 (선택)

| 옵션 | 설명 |
|------|------|
| 수집 페이지 수 | 1페이지 ≈ 10건 |
| 연도 범위 | 빈칸 = 전체 |
| KCI 등재만 | KCI 등재 논문으로 한정 |
| 정렬 방식 | 정확도 / 최신 / 인기도 |
| 상위 N건 | 피인용수 기준 상위 N건만 |
| 제외 키워드 | 제목/초록 포함 시 제외 |

### ③ 저장 위치 → 수집 시작
폴더 선택 후 **수집 시작** 버튼 클릭. 실시간 로그로 진행 상황 확인.

---

## 출력 파일 구조

```
저장위치/
├── metadata.json          # 전체 논문 메타데이터
├── report.csv             # 제목·저자·연도·카테고리·요약 (AI 분류 시)
├── downloaded/            # 다운로드된 PDF (분류 전)
├── {카테고리1}/           # AI 분류 완료 후 카테고리별 폴더
└── {카테고리2}/
```

---

## 자주 묻는 질문

**Q. 앱이 열리지 않습니다. (Mac)**  
A. 우클릭 → 열기를 시도하세요. 그래도 안 되면 폴더 안에서 터미널을 열고 `xattr -dr com.apple.quarantine .` 실행 후 다시 시도하세요.

**Q. 도서관 로그인이 실패합니다.**  
A. RISS 계정이 아닌 소속 기관 도서관 계정(학번/비밀번호)을 입력하세요.

**Q. KISS · DBpia 논문 다운로드가 느립니다.**  
A. 학교 프록시 경유 시 페이지 로딩이 15초 이상 걸리는 경우가 있습니다. 멈춘 게 아니라 자동 대기 중이니 기다려 주세요.

**Q. 접속 오류가 발생합니다.**  
A. 자동으로 최대 3회까지 재시도합니다. 반복 실패 시 `--headed` 옵션으로 브라우저 창을 띄워 실행해 보세요.

**Q. Mac Keychain 팝업이 뜹니다.**  
A. "항상 허용"을 클릭하면 이후 팝업이 뜨지 않습니다.

---

## 주의사항

- 소속 기관 도서관 계정으로 RISS에 접근합니다.
- 수집된 논문은 개인 연구 목적으로만 사용하세요.
- DRM 보호 논문(일부 학위논문)은 자동 다운로드가 불가합니다.

---

## 라이선스

개인 및 학술 연구 목적 허용. 상업적 사용 금지.
