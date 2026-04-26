// 도서관 로그인 + RISS 접속 — 대학 프로필 기반
const { PROFILES } = require('./university-profiles');

// 여러 셀렉터 후보를 순서대로 시도
async function tryFill(page, selectors, value) {
  for (const sel of selectors) {
    try {
      await page.fill(sel, value);
      return;
    } catch {}
  }
  throw new Error(`입력 필드를 찾을 수 없습니다: ${selectors.join(', ')}`);
}

async function tryClick(page, selectors) {
  for (const sel of selectors) {
    try {
      await page.locator(sel).first().click();
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
  await page.waitForTimeout(5000);

  try {
    await page.waitForURL(profile.loginSuccessCheck, { timeout: 60000 });
  } catch { /* 계속 진행 */ }

  if (!profile.loginSuccessCheck(page.url())) {
    throw new Error(`도서관 로그인 실패 — ID/PW를 확인하세요. (${profile.name})`);
  }
  console.log('도서관 로그인 성공');

  const rissLink = await page.$(profile.rissLinkSelector);
  if (!rissLink) throw new Error(`RISS 링크를 찾을 수 없습니다. (${profile.name} 도서관 페이지 구조가 변경됐을 수 있습니다)`);

  const rissHref = await rissLink.getAttribute('href');
  const absoluteHref = rissHref.startsWith('http')
    ? rissHref
    : `${profile.libraryPrefix}${rissHref}`;

  // 현재 탭에서 직접 이동 — EZproxy 리다이렉트 체인을 안정적으로 따라감
  await page.goto(absoluteHref, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 리다이렉트 체인이 완전히 끝날 때까지 대기
  try {
    await page.waitForLoadState('networkidle', { timeout: 60000 });
  } catch { /* 타임아웃 무시, URL만 확인 */ }

  const finalUrl = page.url();
  if (!profile.rissCheck(finalUrl)) {
    throw new Error(`RISS 접속 실패 — 최종 URL: ${finalUrl}`);
  }
  console.log('RISS 접속 성공:', finalUrl);

  return page;
}

module.exports = { loginAndGetRiss };
