// 도서관 로그인 + RISS 접속 — 대학 프로필 기반
const { PROFILES } = require('./university-profiles');

// 여러 셀렉터 후보를 순서대로 시도
// 후보당 3초 제한 — 기본값(30초)이면 추정 셀렉터 대학에서 로그인이 수 분 지연됨
const SELECTOR_TIMEOUT = 3000;

async function tryFill(page, selectors, value) {
  for (const sel of selectors) {
    try {
      await page.fill(sel, value, { timeout: SELECTOR_TIMEOUT });
      return;
    } catch {}
  }
  throw new Error(`입력 필드를 찾을 수 없습니다: ${selectors.join(', ')}`);
}

async function tryClick(page, selectors) {
  for (const sel of selectors) {
    try {
      await page.locator(sel).first().click({ timeout: SELECTOR_TIMEOUT });
      return;
    } catch {}
  }
  throw new Error(`버튼을 찾을 수 없습니다: ${selectors.join(', ')}`);
}

async function loginAndGetRiss(context, creds = {}) {
  const { libraryId, libraryPw } = creds;
  const universityId = creds.universityId || 'hufs';
  const profile = creds.profile || PROFILES[universityId];

  if (!profile) throw new Error(`지원하지 않는 대학 ID: ${universityId}`);
  if (!libraryId || !libraryPw) {
    throw new Error('도서관 ID/PW가 설정되지 않았습니다. 앱 화면에서 저장하세요.');
  }

  const page = await context.newPage();

  await page.goto(profile.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await tryFill(page, profile.idSelectors, libraryId);
  await tryFill(page, profile.pwSelectors, libraryPw);
  await tryClick(page, profile.submitSelectors);

  // waitForURL의 predicate는 URL 객체를 받으므로 문자열로 변환해 전달
  // (기존 코드는 문자열 함수를 그대로 넘겨 항상 예외 → 고정 5초 대기에만 의존했음)
  try {
    await page.waitForURL(u => profile.loginSuccessCheck(u.toString()), { timeout: 30000 });
  } catch { /* 아래에서 최종 판정 */ }
  await page.waitForTimeout(1500);

  if (!profile.loginSuccessCheck(page.url())) {
    // 로그인 페이지에 머물러 있으면 자격증명 문제일 가능성이 높음
    const alertText = await page.evaluate(() =>
      document.body?.innerText?.match(/(?:비밀번호|아이디|인증|일치하지|실패)[^\n]{0,60}/)?.[0] || ''
    ).catch(() => '');
    throw new Error(
      `도서관 로그인 실패 (${profile.name}) — ID/PW를 확인하세요.` +
      (alertText ? ` [페이지 메시지: ${alertText.trim()}]` : '') +
      ` [현재 URL: ${page.url()}]`
    );
  }
  console.log('도서관 로그인 성공');

  const rissLink = await page.$(profile.rissLinkSelector);
  if (!rissLink) throw new Error(`RISS 링크를 찾을 수 없습니다. (${profile.name} 도서관 페이지 구조가 변경됐을 수 있습니다)`);

  const rissHref = await rissLink.getAttribute('href');
  const absoluteHref = rissHref.startsWith('http')
    ? rissHref
    : `${profile.libraryPrefix}${rissHref}`;

  // 현재 탭에서 직접 이동 — EZproxy 리다이렉트 체인을 안정적으로 따라감
  // 프록시 첫 접속이 간헐적으로 chrome-error로 떨어지므로 최대 3회 재시도
  let finalUrl = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(absoluteHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch { /* 네비게이션 오류 — 아래에서 URL로 판정 */ }

    // 리다이렉트 체인이 완전히 끝날 때까지 대기
    try {
      await page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch { /* 타임아웃 무시, URL만 확인 */ }

    finalUrl = page.url();
    if (profile.rissCheck(finalUrl)) break;
    if (attempt < 3) {
      console.log(`RISS 접속 재시도 (${attempt}/3) — 현재 URL: ${finalUrl}`);
      await page.waitForTimeout(3000);
    }
  }

  if (!profile.rissCheck(finalUrl)) {
    throw new Error(`RISS 접속 실패 (3회 시도) — 최종 URL: ${finalUrl}`);
  }
  console.log('RISS 접속 성공:', finalUrl);

  return page;
}

module.exports = { loginAndGetRiss };
