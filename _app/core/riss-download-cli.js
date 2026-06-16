#!/usr/bin/env node
// 기존 metadata.json을 입력받아 PDF만 다운로드하는 단독 CLI
// 사용법: node riss-download-cli.js --metadata <metadata.json> --output-dir <폴더> [--headed]
const path = require('path');
const os = require('os');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(os.homedir(), '.riss', '.env') });
const fs = require('fs');
const { chromium } = require('playwright');
const { loginAndGetRiss } = require('./riss-auth');
const { launchOptions, contextOptions } = require('./browser-config');
const { runDownload } = require('./riss-download');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { metadata: null, outputDir: null, headed: process.env.RISS_HEADED === '1', universityId: null, libraryId: null, libraryPw: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--metadata' && args[i + 1]) opts.metadata = args[++i];
    if (args[i] === '--output-dir' && args[i + 1]) opts.outputDir = args[++i];
    if (args[i] === '--university-id' && args[i + 1]) opts.universityId = args[++i];
    if (args[i] === '--headed') opts.headed = true;
  }
  return opts;
}

(async () => {
  const opts = parseArgs();
  if (!opts.metadata || !fs.existsSync(opts.metadata)) {
    console.error('사용법: node riss-download-cli.js --metadata <metadata.json> --output-dir <폴더>');
    process.exit(1);
  }
  const outputDir = opts.outputDir || path.dirname(opts.metadata);
  const pdfsDir = path.join(outputDir, 'downloaded');
  fs.mkdirSync(pdfsDir, { recursive: true });

  const browser = await chromium.launch(launchOptions(opts.headed));
  const context = await browser.newContext(contextOptions({ acceptDownloads: true, downloadsPath: pdfsDir }));
  try {
    const rissPage = await loginAndGetRiss(context, {
      libraryId: process.env.RISS_ID,
      libraryPw: process.env.RISS_PW,
      universityId: opts.universityId || process.env.RISS_UNIVERSITY || 'hufs',
    });
    await runDownload(rissPage, opts.metadata, pdfsDir);
    console.log(`\n완료 — PDF: ${pdfsDir}/`);
  } catch (err) {
    console.error('오류 발생:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
