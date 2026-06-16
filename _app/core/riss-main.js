#!/usr/bin/env node
const path = require('path');
const os = require('os');
// 자격증명 로드 우선순위: 현재 폴더 .env → _app/.env → ~/.riss/.env
// (dotenv는 이미 설정된 변수를 덮어쓰지 않으므로 앞쪽이 우선)
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(os.homedir(), '.riss', '.env') });
const { chromium } = require('playwright');
const fs = require('fs');

const { loginAndGetRiss } = require('./riss-auth');
const { launchOptions, contextOptions } = require('./browser-config');
const { runSearch } = require('./riss-search');
const { runDownload } = require('./riss-download');
const { runClassify } = require('./riss-classify');
const { filterByRelevance } = require('./riss-filter');
const { PROFILES } = require('./university-profiles');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    keywords: [],
    titles: [],
    pages: 2,
    topN: null, minCitations: 0, exclude: [],
    skipDownload: false, skipClassify: false,
    yearFrom: null, yearTo: null, kciOnly: false,
    sort: 'rank',
    headed: process.env.RISS_HEADED === '1',
    universityId: 'hufs',
    libraryId: null, libraryPw: null,
    outputDir: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keyword' && args[i + 1]) opts.keywords.push(args[++i]);
    if (args[i] === '--title' && args[i + 1]) opts.titles.push(args[++i]);
    if (args[i] === '--pages' && args[i + 1]) opts.pages = parseInt(args[++i]);
    if (args[i] === '--top-n' && args[i + 1]) opts.topN = parseInt(args[++i]);
    if (args[i] === '--min-citations' && args[i + 1]) opts.minCitations = parseInt(args[++i]);
    if (args[i] === '--exclude' && args[i + 1]) opts.exclude = args[++i].split(',').map(s => s.trim());
    if (args[i] === '--skip-download') opts.skipDownload = true;
    if (args[i] === '--skip-classify') opts.skipClassify = true;
    if (args[i] === '--year-from' && args[i + 1]) opts.yearFrom = args[++i];
    if (args[i] === '--year-to' && args[i + 1]) opts.yearTo = args[++i];
    if (args[i] === '--kci-only') opts.kciOnly = true;
    if (args[i] === '--headed') opts.headed = true;
    if (args[i] === '--sort' && args[i + 1]) opts.sort = args[++i];
    if (args[i] === '--university-id' && args[i + 1]) opts.universityId = args[++i];
    if (args[i] === '--library-id' && args[i + 1]) opts.libraryId = args[++i];
    if (args[i] === '--library-pw' && args[i + 1]) opts.libraryPw = args[++i];
    if (args[i] === '--output-dir' && args[i + 1]) opts.outputDir = args[++i];
  }
  return opts;
}

function applyFilters(papers, opts) {
  let result = papers;

  if (opts.exclude.length > 0) {
    result = result.filter(p => {
      const text = `${p.title} ${p.abstract}`.toLowerCase();
      return !opts.exclude.some(kw => text.includes(kw.toLowerCase()));
    });
    console.log(`  제외 키워드 필터 후: ${result.length}건`);
  }

  if (opts.minCitations > 0) {
    result = result.filter(p => p.kciCitations >= opts.minCitations);
    console.log(`  피인용 ${opts.minCitations}회 이상 필터 후: ${result.length}건`);
  }

  result.sort((a, b) => b.kciCitations - a.kciCitations);

  if (opts.topN && result.length > opts.topN) {
    result = result.slice(0, opts.topN);
    console.log(`  상위 ${opts.topN}건 추출`);
  }

  return result;
}

function fmtMin(seconds) {
  if (seconds < 60) return `약 ${Math.ceil(seconds)}초`;
  const m = Math.ceil(seconds / 60);
  return `약 ${m}분`;
}

function phaseHeader(n, total, label, estSec) {
  const est = estSec ? ` (예상 ${fmtMin(estSec)})` : '';
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[${n}/${total}단계] ${label}${est}`);
  console.log('─'.repeat(50));
}

async function main() {
  const opts = parseArgs();
  opts.researchContext = process.env.RISS_RESEARCH_CONTEXT || null;

  if (opts.keywords.length === 0 && opts.titles.length === 0) {
    console.error('사용법: node riss-main.js --keyword "검색어" [--keyword "검색어2"] 또는 --title "논문 제목" [--title "논문 제목2"] ...');
    process.exit(1);
  }

  const outputDir = opts.outputDir || path.join(__dirname, '..', 'output');
  const pdfsDir = path.join(outputDir, 'downloaded');
  fs.mkdirSync(pdfsDir, { recursive: true });

  const metadataPath = path.join(outputDir, 'metadata.json');

  console.log('='.repeat(50));
  console.log('RISS 문헌 수집 파이프라인');
  if (opts.keywords.length > 0) console.log(`키워드: ${opts.keywords.map(k => `"${k}"`).join(', ')} | 페이지: ${opts.pages}`);
  if (opts.titles.length > 0) console.log(`제목 검색: ${opts.titles.map(t => `"${t}"`).join(', ')}`);
  if (opts.yearFrom || opts.yearTo) console.log(`연도 범위: ${opts.yearFrom || '전체'} ~ ${opts.yearTo || '전체'}`);
  if (opts.kciOnly) console.log('KCI 등재 논문만 수집');
  console.log('='.repeat(50));

  // 자격증명을 브라우저 기동 전에 먼저 검증 — 설정 누락 시 빠르고 명확하게 안내
  const universityId = opts.universityId || process.env.RISS_UNIVERSITY || 'hufs';
  const profile = PROFILES[universityId];
  if (!profile) {
    console.error(`지원하지 않는 대학 ID: ${universityId}`);
    console.error(`지원 대학: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }
  const creds = {
    universityId,
    profile,
    libraryId: opts.libraryId || process.env.RISS_ID,
    libraryPw: opts.libraryPw || process.env.RISS_PW,
  };
  if (!creds.libraryId || !creds.libraryPw) {
    console.error('도서관 ID/PW가 설정되지 않았습니다.');
    console.error('  GUI 사용: 앱 화면에서 대학·ID·PW를 저장하세요.');
    console.error('  CLI 사용: ~/.riss/.env 또는 _app/.env 에 RISS_ID, RISS_PW, RISS_UNIVERSITY를 설정하세요. (_app/.env.example 참고)');
    process.exit(1);
  }

  const browser = await chromium.launch(launchOptions(opts.headed));
  const context = await browser.newContext(contextOptions({
    acceptDownloads: true,
    downloadsPath: pdfsDir
  }));

  try {
    const rissPage = await loginAndGetRiss(context, creds);

    const filters = {
      yearFrom: opts.yearFrom,
      yearTo: opts.yearTo,
      kciOnly: opts.kciOnly,
      sortBy: opts.sort,
    };
    const titleFilters = { ...filters, searchField: 'TI' };

    // ── 단계 수 계산 ─────────────────────────────────────────
    const hasAI = !opts.skipClassify;
    const totalSteps = 1 + (hasAI ? 1 : 0) + (opts.skipDownload ? 0 : 1) + (hasAI ? 1 : 0);
    let step = 0;

    // ── 1단계: 검색 ─────────────────────────────────────────
    const searchEstSec = (opts.keywords.length * opts.pages + opts.titles.length) * 65;
    phaseHeader(++step, totalSteps, '문헌 검색 및 메타데이터 수집', searchEstSec);

    const seenControlNos = new Set();
    let allPapers = [];
    const totalSearchPages = opts.keywords.length * opts.pages + opts.titles.length;
    let pageOffset = 0;

    for (const keyword of opts.keywords) {
      const papers = await runSearch(context, rissPage, keyword, opts.pages, outputDir, filters, pageOffset, totalSearchPages);
      pageOffset += opts.pages;
      for (const paper of papers) {
        if (paper.controlNo && seenControlNos.has(paper.controlNo)) {
          console.log(`  (타 키워드 중복) ${paper.title.substring(0, 40)}`);
        } else {
          if (paper.controlNo) seenControlNos.add(paper.controlNo);
          allPapers.push({ ...paper, sourceKeyword: keyword });
        }
      }
    }

    for (const title of opts.titles) {
      const papers = await runSearch(context, rissPage, title, 1, outputDir, titleFilters, pageOffset, totalSearchPages);
      pageOffset += 1;
      for (const paper of papers) {
        if (paper.controlNo && seenControlNos.has(paper.controlNo)) {
          console.log(`  (중복) ${paper.title.substring(0, 40)}`);
        } else {
          if (paper.controlNo) seenControlNos.add(paper.controlNo);
          allPapers.push({ ...paper, sourceKeyword: title });
        }
      }
    }

    const totalSearchCount = opts.keywords.length + opts.titles.length;
    console.log(`\n전체 수집: ${allPapers.length}건 (${totalSearchCount}개 검색어·제목 병합)`);
    fs.writeFileSync(metadataPath, JSON.stringify(allPapers, null, 2), 'utf8');

    if (opts.topN || opts.minCitations > 0 || opts.exclude.length > 0) {
      console.log('\n[기본 필터 적용]');
      allPapers = applyFilters(allPapers, opts);
      console.log(`  최종 선택: ${allPapers.length}건`);
      fs.writeFileSync(metadataPath, JSON.stringify(allPapers, null, 2), 'utf8');
    }

    if (!opts.skipClassify) {
      const anthropicKey = opts.anthropicKey || process.env.ANTHROPIC_API_KEY;
      const claudeCliPath = process.env.CLAUDE_CLI_PATH;
      const useClaudeCli = process.env.USE_CLAUDE_CLI === '1';

      if (anthropicKey || useClaudeCli) {
        // 예상: 배치(15건) × 10초
        const filterEstSec = Math.ceil(allPapers.length / 15) * 10;
        phaseHeader(++step, totalSteps, 'Claude 관련도 필터링', filterEstSec);
        const before = allPapers.length;
        allPapers = await filterByRelevance(
          allPapers,
          opts.keywords,
          { anthropicKey, claudeCliPath, useClaudeCli, researchContext: opts.researchContext },
          (msg) => process.stdout.write(msg + '\n')
        );
        console.log(`\n  관련도 필터 결과: ${before}건 → ${allPapers.length}건 (${before - allPapers.length}건 제외)`);
        fs.writeFileSync(metadataPath, JSON.stringify(allPapers, null, 2), 'utf8');
      }
    }

    if (!opts.skipDownload) {
      // 예상: 논문 × 30초
      const dlEstSec = allPapers.filter(p => p.downloadOnclick).length * 30;
      phaseHeader(++step, totalSteps, '원문 PDF 다운로드', dlEstSec);
      await runDownload(rissPage, metadataPath, pdfsDir);
    }

    if (!opts.skipClassify) {
      const classifyKeyword = [...opts.keywords, ...opts.titles].join(' / ');
      const classifyCount = JSON.parse(fs.readFileSync(metadataPath, 'utf8')).length;
      phaseHeader(++step, totalSteps, '주제별 자동 분류', classifyCount * 8);
      await runClassify(metadataPath, pdfsDir, outputDir, classifyKeyword, opts.researchContext);
    }

    console.log('\n' + '='.repeat(50));
    console.log('완료!');
    console.log(`  메타데이터: ${metadataPath}`);
    console.log(`  PDF 파일:   ${pdfsDir}/`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error('\n오류 발생:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  // chromium.launch 등 try 블록 밖 오류도 명확히 출력 (unhandled rejection 방지)
  console.error('\n오류 발생:', err.message);
  if (/Executable doesn't exist|playwright install/i.test(err.message)) {
    console.error('브라우저가 설치되지 않았습니다. _app 폴더에서 실행: npx playwright install chromium');
  }
  process.exit(1);
});
