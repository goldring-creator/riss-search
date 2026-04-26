// 대학별 도서관 로그인 + RISS 접속 프로필
// ✅ = RISS 링크 및 셀렉터 직접 확인, ⚠️ = 셀렉터 추정(Pyxis 공통 패턴)
//
// idSelectors / pwSelectors / submitSelectors: 배열로 여러 후보를 순서대로 시도

const COMMON_SELECTORS = {
  id: [
    'input[placeholder*="이용자ID"]',
    'input[name="userId"]',
    'input[id="userId"]',
    'input[placeholder*="아이디"]',
    'input[name="user_id"]',
  ],
  pw: [
    'input[placeholder*="이용자PW"]',
    'input[name="userPw"]',
    'input[id="userPw"]',
    'input[placeholder*="비밀번호"]',
    'input[name="password"]',
    'input[type="password"]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    '.btn-login',
    'button.login',
  ],
};

const PROFILES = {
  // ✅ RISS 링크 확인 + ✅ 셀렉터 확인
  hufs: {
    name: '한국외국어대학교',
    libraryUrl: 'https://lib.hufs.ac.kr/',
    loginUrl: 'https://lib.hufs.ac.kr/login?returnUrl=%3F&queryParamsHandling=merge',
    libraryPrefix: 'https://lib.hufs.ac.kr',
    idSelectors: ['input[placeholder*="이용자ID"]'],
    pwSelectors: ['input[placeholder*="이용자PW"]'],
    submitSelectors: ['#content button[type="submit"]'],
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('login'),
    rissCheck: url => url.includes('riss.kr') || url.includes('sproxy.hufs.ac.kr'),
  },

  // ✅ RISS 링크 확인 + ✅ 셀렉터 확인
  korea: {
    name: '고려대학교',
    libraryUrl: 'https://library.korea.ac.kr/',
    loginUrl: 'https://library.korea.ac.kr/login/',
    libraryPrefix: 'https://library.korea.ac.kr',
    idSelectors: ['input[name="userId"]', 'input[id="userId"]'],
    pwSelectors: ['input[name="userPw"]', 'input[id="userPw"]'],
    submitSelectors: ['button[type="submit"]'],
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr') || url.includes('oca.korea.ac.kr'),
  },

  // ✅ RISS 링크 확인 + ✅ 셀렉터 확인
  cnu: {
    name: '충남대학교',
    libraryUrl: 'https://library.cnu.ac.kr/',
    loginUrl: 'https://library.cnu.ac.kr/login',
    libraryPrefix: 'https://library.cnu.ac.kr',
    idSelectors: ['input#id', 'input[name="id"]', 'input[placeholder*="학번"]'],
    pwSelectors: ['input[name="password"]', 'input[placeholder*="비밀번호"]'],
    submitSelectors: ['input[type="submit"]', 'button[type="submit"]'],
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr') || url.includes('libra.cnu.ac.kr'),
  },

  // ✅ RISS 링크 확인 + ⚠️ 셀렉터 추정
  snu: {
    name: '서울대학교',
    libraryUrl: 'https://lib.snu.ac.kr/',
    loginUrl: 'https://lib.snu.ac.kr/login/',
    libraryPrefix: 'https://lib.snu.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 기관접속 확인 + ⚠️ 셀렉터 추정
  skku: {
    name: '성균관대학교',
    libraryUrl: 'https://lib.skku.edu/',
    loginUrl: 'https://lib.skku.edu/login',
    libraryPrefix: 'https://lib.skku.edu',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 확인 + ⚠️ 셀렉터 추정
  khu: {
    name: '경희대학교',
    libraryUrl: 'https://lib.khu.ac.kr/',
    loginUrl: 'https://lib.khu.ac.kr/login',
    libraryPrefix: 'https://lib.khu.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 확인 + ⚠️ 셀렉터 추정
  pusan: {
    name: '부산대학교',
    libraryUrl: 'https://lib.pusan.ac.kr/',
    loginUrl: 'https://lib.pusan.ac.kr/login/',
    libraryPrefix: 'https://lib.pusan.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 확인 + ⚠️ 셀렉터 추정
  konkuk: {
    name: '건국대학교',
    libraryUrl: 'https://library.konkuk.ac.kr/',
    loginUrl: 'https://library.konkuk.ac.kr/login',
    libraryPrefix: 'https://library.konkuk.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 확인 + ⚠️ 셀렉터 추정
  kookmin: {
    name: '국민대학교',
    libraryUrl: 'https://lib.kookmin.ac.kr/',
    loginUrl: 'https://lib.kookmin.ac.kr/login',
    libraryPrefix: 'https://lib.kookmin.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },

  // ✅ RISS 확인 + ⚠️ 셀렉터 추정
  cbnu: {
    name: '충북대학교',
    libraryUrl: 'https://cbnul.chungbuk.ac.kr/',
    loginUrl: 'https://cbnul.chungbuk.ac.kr/login',
    libraryPrefix: 'https://cbnul.chungbuk.ac.kr',
    idSelectors: COMMON_SELECTORS.id,
    pwSelectors: COMMON_SELECTORS.pw,
    submitSelectors: COMMON_SELECTORS.submit,
    rissLinkSelector: 'a[href*="riss"]',
    loginSuccessCheck: url => !url.includes('/login'),
    rissCheck: url => url.includes('riss.kr'),
  },
};

module.exports = { PROFILES };
