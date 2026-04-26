// 도서관 로그인 + RISS 접속 — 배포용 (자격증명 파라미터 방식)
async function loginAndGetRiss(context, creds = {}) {
  const libraryId = creds.libraryId || process.env.RISS_ID;
  const libraryPw = creds.libraryPw || process.env.RISS_PW;

  if (!libraryId || !libraryPw) {
    throw new Error('도서관 ID/PW가 설정되지 않았습니다. 앱 화면에서 저장하세요.');
  }

  const page = await context.newPage();

  await page.goto('https://lib.hufs.ac.kr/login?returnUrl=%3F&queryParamsHandling=merge');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.fill('input[placeholder*="이용자ID"]', libraryId);
  await page.fill('input[placeholder*="이용자PW"]', libraryPw);
  await page.locator('#content button[type="submit"]').click();
  await page.waitForTimeout(5000);
  try {
    await page.waitForURL(url => !url.includes('login'), { timeout: 60000 });
  } catch { /* 계속 진행 */ }

  if (page.url().includes('login')) throw new Error('도서관 로그인 실패 — ID/PW를 확인하세요.');
  console.log('도서관 로그인 성공');

  const rissLink = await page.$('a[href*="riss"]');
  if (!rissLink) throw new Error('RISS 링크를 찾을 수 없습니다');

  const rissHref = await rissLink.getAttribute('href');
  const absoluteHref = rissHref.startsWith('http') ? rissHref : `https://lib.hufs.ac.kr${rissHref}`;

  // 새 탭 대신 현재 탭에서 직접 이동 — EZproxy 리다이렉트 체인을 안정적으로 따라감
  await page.goto(absoluteHref, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 리다이렉트 체인이 완전히 끝날 때까지 대기 (networkidle = 모든 요청 완료)
  try {
    await page.waitForLoadState('networkidle', { timeout: 60000 });
  } catch { /* 타임아웃 무시, URL만 확인 */ }

  const finalUrl = page.url();
  // riss.kr 직접 접속 또는 EZproxy 경유 (sproxy.hufs.ac.kr/_Lib_Proxy_Url/...riss.kr...) 모두 허용
  const isRiss = finalUrl.includes('riss.kr') || finalUrl.includes('sproxy.hufs.ac.kr');
  if (!isRiss) throw new Error(`RISS 접속 실패 — 최종 URL: ${finalUrl}`);
  console.log('RISS 접속 성공:', finalUrl);

  return page;
}

module.exports = { loginAndGetRiss };
