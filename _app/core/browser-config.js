// 브라우저 공통 설정
// KISS(kiss.kstudy.com) 등 일부 제공사는 headless 브라우저를 차단한다.
// 1) userAgent를 일반 Chrome으로 명시해 "HeadlessChrome" 토큰 제거
// 2) 그래도 차단되면 --headed(RISS_HEADED=1)로 실제 창을 띄워 우회

const USER_AGENT = process.platform === 'win32'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function launchOptions(headed = false) {
  return { headless: !headed };
}

function contextOptions(extra = {}) {
  return {
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    ...extra,
  };
}

module.exports = { USER_AGENT, launchOptions, contextOptions };
