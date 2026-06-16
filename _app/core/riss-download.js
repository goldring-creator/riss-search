const fs = require('fs');
const path = require('path');

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

// ──────────────────────────────────────────────
// 외부 사이트별 다운로드 핸들러
// ──────────────────────────────────────────────

async function downloadFromScholar(extPage, paper, pdfsDir) {
  // Kyobo Scholar (scholar.kyobobook.co.kr)
  // SPA(Vue) 렌더링 완료 후 "원문저장" 버튼(.btn_type01.down) 클릭
  await extPage.waitForSelector('a.btn_type01.down, a.down', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(1000);

  const [download] = await Promise.all([
    extPage.waitForEvent('download', { timeout: 20000 }),
    extPage.evaluate(() => {
      const btn = document.querySelector('a.btn_type01.down, a.down');
      if (btn) btn.click();
    })
  ]);

  const filename = sanitizeFilename(paper.filename);
  const savePath = path.join(pdfsDir, filename);
  await download.saveAs(savePath);
  return savePath;
}

async function downloadFromKci(extPage, paper, pdfsDir) {
  // KCI (kci.go.kr)
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(2000);

  const [download] = await Promise.all([
    extPage.waitForEvent('download', { timeout: 20000 }),
    extPage.evaluate(() => {
      // KCI 원문 다운로드 버튼 패턴
      const btn = document.querySelector(
        'a[onclick*="download"], .btn_down, #btnDown, a[href*=".pdf"], ' +
        'button[onclick*="download"], a.btn_fulltext'
      );
      if (btn) btn.click();
    })
  ]);

  const filename = sanitizeFilename(paper.filename);
  const savePath = path.join(pdfsDir, filename);
  await download.saveAs(savePath);
  return savePath;
}

async function downloadFromDbpia(extPage, paper, pdfsDir) {
  // DBpia (dbpia.co.kr) — 테스트 확인: button[onclick*="download"] ("다운받기")
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(2000);

  const [download] = await Promise.all([
    extPage.waitForEvent('download', { timeout: 20000 }),
    extPage.evaluate(() => {
      const btn = document.querySelector('button[onclick*="download"], a[onclick*="download"]')
        || Array.from(document.querySelectorAll('a, button')).find(el =>
            el.textContent?.trim().match(/다운받기|다운로드|Download/));
      if (btn) btn.click();
    })
  ]);

  const filename = sanitizeFilename(paper.filename);
  const savePath = path.join(pdfsDir, filename);
  await download.saveAs(savePath);
  return savePath;
}

async function downloadFromEarticle(extPage, paper, pdfsDir) {
  // earticle (earticle.net) — 테스트 확인: text "다운로드"
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(2000);

  const [download] = await Promise.all([
    extPage.waitForEvent('download', { timeout: 20000 }),
    extPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a, button')).find(el =>
          el.textContent?.trim().match(/다운로드|Download|PDF/))
        || document.querySelector('a[href*="download"], a.pdf_down, button[onclick*="download"]');
      if (btn) btn.click();
    })
  ]);

  const filename = sanitizeFilename(paper.filename);
  const savePath = path.join(pdfsDir, filename);
  await download.saveAs(savePath);
  return savePath;
}

async function downloadFromKiss(extPage, paper, pdfsDir) {
  // KISS (kiss.kstudy.com / kiss-kstudy-com.sproxy.*)
  // 프록시(sproxy) 경유 시 응답이 매우 느리게 스트리밍되어 body가 15초+ 후에 도착함
  // → body 콘텐츠가 실제로 나타날 때까지 폴링 (최대 60초)
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  const bodyReady = await extPage.waitForFunction(
    () => document.body && document.body.innerText.length > 100,
    null,
    { timeout: 60000, polling: 1000 }
  ).then(() => true).catch(() => false);
  if (!bodyReady) {
    console.log('    (KISS 페이지 본문이 60초 내 로드되지 않음)');
    return null;
  }
  await extPage.waitForTimeout(1500);

  // KISS 버튼 셀렉터 우선순위 목록
  const KISS_SELECTORS = [
    '#btnDown',
    '#btnDownload',
    'a.btn_down',
    'button.btn_down',
    'a[onclick*="PdfDown"]',
    'a[onclick*="pdfDown"]',
    'a[onclick*="fileDown"]',
    'a[onclick*="download"]',
    'button[onclick*="download"]',
    '.down_btn',
    'a[href*=".pdf"]',
  ];

  // 텍스트 기반 버튼 탐색 포함 + 위 셀렉터 합산
  const btn = await extPage.evaluate((selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return sel;
    }
    // 텍스트 매칭
    const textMatch = Array.from(document.querySelectorAll('a, button')).find(el =>
      el.textContent?.trim().match(/PDF\s*다운|원문\s*다운|다운로드|Download/i)
    );
    if (textMatch) {
      const id = textMatch.id || textMatch.className.split(' ')[0];
      return id ? `#${textMatch.id || ''}` : '__text__';
    }
    return null;
  }, KISS_SELECTORS);

  if (!btn) {
    // 페이지 내용 디버그용 스냅샷
    const bodyText = await extPage.evaluate(() =>
      document.body?.innerText?.substring(0, 300) || ''
    ).catch(() => '');
    console.log(`    (KISS 버튼 미발견, 페이지: ${bodyText.replace(/\n/g, ' ').substring(0, 100)})`);
    return null;
  }

  try {
    const [download] = await Promise.all([
      extPage.waitForEvent('download', { timeout: 25000 }),
      extPage.evaluate((sel) => {
        let el;
        if (sel === '__text__') {
          el = Array.from(document.querySelectorAll('a, button')).find(e =>
            e.textContent?.trim().match(/PDF\s*다운|원문\s*다운|다운로드|Download/i)
          );
        } else {
          el = document.querySelector(sel);
        }
        if (el) el.click();
      }, btn)
    ]);
    const filename = sanitizeFilename(paper.filename);
    const savePath = path.join(pdfsDir, filename);
    await download.saveAs(savePath);
    return savePath;
  } catch (err) {
    // 팝업 페이지에서 다운로드 트리거될 수 있음 — Generic 핸들러로 재시도
    console.log(`    (KISS 직접 클릭 실패, Generic 시도: ${err.message})`);
    return await downloadFromGeneric(extPage, paper, pdfsDir);
  }
}

async function downloadFromRissDirect(extPage, paper, pdfsDir) {
  // RISS 직접 제공 (학위논문 등)
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(2000);

  const [download] = await Promise.all([
    extPage.waitForEvent('download', { timeout: 20000 }),
    extPage.evaluate(() => {
      const btn = document.querySelector(
        'a[onclick*="download"], #btnFullDown, a.btn_down, a[href*=".pdf"]'
      );
      if (btn) btn.click();
    })
  ]);

  const filename = sanitizeFilename(paper.filename);
  const savePath = path.join(pdfsDir, filename);
  await download.saveAs(savePath);
  return savePath;
}

// 알 수 없는 사이트 - 공통 패턴으로 시도
async function downloadFromGeneric(extPage, paper, pdfsDir) {
  await extPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await extPage.waitForTimeout(3000);

  // 1차 시도: 텍스트 기반 버튼 탐색
  const downloadText = ['원문저장', '원문다운로드', 'PDF 다운', 'PDF다운', 'Download', '다운로드'];
  for (const text of downloadText) {
    try {
      const [download] = await Promise.all([
        extPage.waitForEvent('download', { timeout: 8000 }),
        extPage.evaluate((t) => {
          const els = Array.from(document.querySelectorAll('a, button'));
          const btn = els.find(el => el.textContent?.includes(t));
          if (btn) btn.click();
          return !!btn;
        }, text)
      ]);
      const filename = sanitizeFilename(paper.filename);
      const savePath = path.join(pdfsDir, filename);
      await download.saveAs(savePath);
      return savePath;
    } catch {
      // 다음 시도
    }
  }

  // 2차 시도: href에 .pdf 포함된 링크 직접 클릭
  try {
    const pdfUrl = await extPage.evaluate(() => {
      const link = document.querySelector('a[href$=".pdf"], a[href*=".pdf?"]');
      return link?.href || null;
    });
    if (pdfUrl) {
      const [download] = await Promise.all([
        extPage.waitForEvent('download', { timeout: 10000 }),
        extPage.evaluate((url) => {
          const a = document.querySelector(`a[href="${url}"]`);
          if (a) a.click();
        }, pdfUrl)
      ]);
      const filename = sanitizeFilename(paper.filename);
      const savePath = path.join(pdfsDir, filename);
      await download.saveAs(savePath);
      return savePath;
    }
  } catch {
    // 실패
  }

  return null;
}

// ──────────────────────────────────────────────
// 메인 다운로드 로직
// ──────────────────────────────────────────────

// 외부 페이지 안정화 대기
// 1) UrlLoad.do → 제공사 리다이렉트 체인이 끝날 때까지 URL 변화 폴링
//    (중간 URL로 제공사를 오판하면 잘못된 핸들러로 분기됨)
// 2) sproxy 프록시 경유 시 body가 15초+ 후에야 스트리밍되므로 본문 도착까지 대기
async function settleExternalPage(extPage) {
  await extPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  let prev = '';
  for (let i = 0; i < 20; i++) {
    await extPage.waitForTimeout(1000);
    const cur = extPage.url();
    if (cur === prev && !cur.includes('UrlLoad')) break;
    prev = cur;
  }
  await extPage.waitForFunction(
    () => document.body && document.body.innerText.length > 100,
    null,
    { timeout: 45000, polling: 1000 }
  ).catch(() => {});
}

// 반환: { status: 'success'|'no_link'|'drm'|'failed', path: string|null }
async function attemptDownload(context, rissPage, paper, pdfsDir) {
  // 상세 페이지로 이동
  await rissPage.goto(paper.detailUrl);
  await rissPage.waitForTimeout(2000);

  // 버튼 확인: memberUrlDownload(외부 사이트) vs fulltextDownload(RISS 뷰어/DRM)
  await rissPage.waitForSelector(
    'a[onclick*="memberUrlDownload"], a[onclick*="fulltextDownload"]',
    { timeout: 8000 }
  ).catch(() => {});

  const memberBtn = await rissPage.$('a[onclick*="memberUrlDownload"]');
  const fulltextBtn = await rissPage.$('a[onclick*="fulltextDownload"]');

  // memberUrlDownload 없고 fulltextDownload만 있을 때 → 학위논문 DRM
  if (!memberBtn && fulltextBtn) {
    console.log('    (DRM 보호 — 자동 다운로드 불가)');
    return { status: 'drm', path: null };
  }

  if (!memberBtn) return { status: 'no_link', path: null };

  // evaluate()로 클릭해야 onclick 핸들러가 정상 실행됨
  // 이벤트 리스너 먼저 등록 후 클릭. 새 탭이 안 뜨면 같은 탭 이동 여부 확인(폴백)
  const extPagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await rissPage.evaluate(() => {
    document.querySelector('a[onclick*="memberUrlDownload"]')?.click();
  });
  let extPage = await extPagePromise;
  let usedSameTab = false;

  if (!extPage) {
    // 새 탭 미발생 — 같은 탭에서 외부 사이트로 이동한 경우 폴백
    await rissPage.waitForTimeout(2000);
    if (!rissPage.url().includes('DetailView')) {
      extPage = rissPage;
      usedSameTab = true;
      console.log('    (같은 탭 이동 감지 — 폴백 사용)');
    } else {
      console.log('    ✗ 다운로드 창이 열리지 않음');
      return { status: 'failed', path: null };
    }
  }

  // UrlLoad.do → 외부 사이트 리다이렉트 + 본문 로드 완료 대기
  await settleExternalPage(extPage);

  const extUrl = extPage.url();
  console.log(`    → ${extUrl.split('/').slice(0, 3).join('/')}`);

  let downloadPath = null;
  try {
    // HUFS 프록시 URL 패턴: 도메인 점(.)이 하이픈(-)으로 치환됨
    // 예) kiss.kstudy.com → kiss-kstudy-com.sproxy.hufs.ac.kr
    if (extUrl.includes('scholar.kyobobook') || extUrl.includes('scholar-kyobobook')) {
      downloadPath = await downloadFromScholar(extPage, paper, pdfsDir);
    } else if (extUrl.includes('kci.go.kr') || extUrl.includes('kci-go-kr')) {
      downloadPath = await downloadFromKci(extPage, paper, pdfsDir);
    } else if (extUrl.includes('dbpia.co.kr') || extUrl.includes('dbpia-co-kr')) {
      downloadPath = await downloadFromDbpia(extPage, paper, pdfsDir);
    } else if (extUrl.includes('earticle.net') || extUrl.includes('earticle-net')) {
      downloadPath = await downloadFromEarticle(extPage, paper, pdfsDir);
    } else if (extUrl.includes('kiss.kstudy') || extUrl.includes('kiss-kstudy')) {
      downloadPath = await downloadFromKiss(extPage, paper, pdfsDir);
    } else if (extUrl.includes('riss.kr') || extUrl.includes('riss-kr')) {
      downloadPath = await downloadFromRissDirect(extPage, paper, pdfsDir);
    } else {
      downloadPath = await downloadFromGeneric(extPage, paper, pdfsDir);
    }
  } catch (err) {
    console.log(`    ✗ 다운로드 실패 (${extUrl.split('/')[2]}): ${err.message}`);
  }

  if (!usedSameTab) await extPage.close().catch(() => {});
  return downloadPath
    ? { status: 'success', path: downloadPath }
    : { status: 'failed', path: null };
}

async function downloadPapers(context, rissPage, papers, pdfsDir) {
  const downloadable = papers.filter(p => p.downloadOnclick).length;
  console.log(`\nPDF 다운로드 시작 (원문 제공 ${downloadable}/${papers.length}건)`);
  const results = [];
  const startTime = Date.now();
  let doneCount = 0;

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    // 남은 시간 추정: 완료된 건 기준 평균 × 남은 건수
    let etaStr = '';
    if (doneCount > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const avgSec = elapsed / doneCount;
      const remaining = (papers.length - i) * avgSec;
      const remMin = Math.ceil(remaining / 60);
      etaStr = remaining < 60 ? ` (약 ${Math.ceil(remaining)}초 남음)` : ` (약 ${remMin}분 남음)`;
    }
    console.log(`  [${i + 1}/${papers.length}] ${paper.title.substring(0, 38)}...${etaStr}`);

    if (!paper.downloadOnclick) {
      console.log('    원문 미제공');
      results.push({ ...paper, downloadStatus: 'no_link' });
      continue;
    }

    try {
      const { status, path: filepath } = await attemptDownload(context, rissPage, paper, pdfsDir);
      if (status === 'success') {
        console.log(`    ✓ 저장: ${path.basename(filepath)}`);
        results.push({ ...paper, filePath: path.join('downloaded', path.basename(filepath)), downloadStatus: 'success' });
      } else {
        // no_link(원문 미제공) / drm(보호) / failed(시도했으나 실패) 구분 기록
        results.push({ ...paper, downloadStatus: status });
      }
    } catch (err) {
      console.error(`    ✗ 오류: ${err.message}`);
      results.push({ ...paper, downloadStatus: 'error', downloadError: err.message });
    }

    doneCount++;
    await rissPage.waitForTimeout(1000);
  }

  const success = results.filter(r => r.downloadStatus === 'success').length;
  const noLink = results.filter(r => r.downloadStatus === 'no_link').length;
  const drm = results.filter(r => r.downloadStatus === 'drm').length;
  const failed = results.length - success - noLink - drm;
  console.log(`\n다운로드 완료: 성공 ${success} / 원문없음 ${noLink} / DRM보호 ${drm} / 실패 ${failed}`);
  return results;
}

async function runDownload(rissPage, metadataPath, pdfsDir) {
  const papers = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const withDownload = papers.filter(p => p.downloadOnclick);
  console.log(`원문 다운로드 가능: ${withDownload.length}/${papers.length}개`);

  const context = rissPage.context();
  const results = await downloadPapers(context, rissPage, papers, pdfsDir);

  fs.writeFileSync(metadataPath, JSON.stringify(results, null, 2), 'utf8');
  return results;
}

module.exports = { runDownload, downloadPapers };
