const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const net = require('net');
const multer = require('multer');

const credentials = require('./credentials');
const config = require('./config');
const runner = require('./runner');
const { PROFILES } = require('../core/university-profiles');

function findClaudeCli() {
  try {
    const p = execSync(
      'export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH; which claude 2>/dev/null',
      { shell: '/bin/bash', encoding: 'utf8' }
    ).trim();
    return p || null;
  } catch { return null; }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

function findFreePort(start, end) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > end) return reject(new Error('사용 가능한 포트 없음'));
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => { s.close(() => resolve(p)); });
      s.listen(p);
    };
    tryPort(start);
  });
}

// ── 대학 목록 ──────────────────────────────────────────────
app.get('/api/universities', (req, res) => {
  res.json(Object.entries(PROFILES).map(([id, p]) => ({ id, name: p.name, libraryUrl: p.libraryUrl })));
});

// ── 설정 로드 ──────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const cfg = config.load();
  const universityId = cfg.selectedUniversity || 'hufs';
  res.json({
    ...cfg,
    hasLibraryCredentials: credentials.keychainHas(universityId),
    hasAnthropicKey: credentials.keychainHas('__anthropic__'),
    hasClaudeCli: !!findClaudeCli(),
  });
});

// ── 자격증명 저장 (API 키 전용) ───────────────────────────
app.post('/api/save-credentials', (req, res) => {
  const { anthropicKey } = req.body;
  try {
    if (anthropicKey) {
      credentials.keychainSet('__anthropic__', anthropicKey);
      config.save({ hasAnthropicKey: true });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 도서관 자격증명 검증 + 저장 ───────────────────────────
app.post('/api/verify-credentials', async (req, res) => {
  const { universityId, libraryId, libraryPw } = req.body;
  if (!universityId || !libraryId || !libraryPw) {
    return res.status(400).json({ ok: false, error: '대학, ID, PW를 모두 입력하세요.' });
  }
  const profile = PROFILES[universityId];
  if (!profile) {
    return res.status(400).json({ ok: false, error: `지원하지 않는 대학: ${universityId}` });
  }

  let browser = null;
  try {
    const { chromium } = require('playwright');
    const { loginAndGetRiss } = require('../core/riss-auth');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const rissPage = await loginAndGetRiss(context, { universityId, profile, libraryId, libraryPw });
    await rissPage.close();
    await context.close();

    // 로그인 성공 → universityId를 키로 Keychain 저장
    credentials.keychainSet(universityId, libraryPw);
    config.save({ selectedUniversity: universityId, libraryId, hasLibraryCredentials: true });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── 폴더 선택 (macOS: osascript / Windows: PowerShell) ────
app.post('/api/pick-folder', (req, res) => {
  try {
    let result;
    if (process.platform === 'win32') {
      const tmp = require('path').join(require('os').tmpdir(), 'riss_folder.ps1');
      require('fs').writeFileSync(tmp, `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '저장 위치를 선택하세요'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }
`, 'utf8');
      result = execSync(`powershell -ExecutionPolicy Bypass -File "${tmp}"`, { timeout: 30000 }).toString().trim();
      try { require('fs').unlinkSync(tmp); } catch {}
      if (!result) return res.json({ cancelled: true });
    } else {
      result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "다운로드 위치를 선택하세요")'`,
        { timeout: 30000 }
      ).toString().trim();
    }
    res.json({ path: result });
  } catch (e) {
    if (e.status === 1) return res.json({ cancelled: true });
    res.status(500).json({ error: e.message });
  }
});

// ── 파일 업로드 → 키워드 추출 ────────────────────────────
app.post('/api/extract-keywords', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없거나 지원하지 않는 형식입니다.' });

  const tmpPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let text = '';

    if (ext === '.pdf') {
      const { PDFParse } = require('pdf-parse');
      const buf = fs.readFileSync(tmpPath);
      const parser = new PDFParse({ data: buf });
      await parser.load(buf);
      const data = await parser.getText();
      text = data.text;
      await parser.destroy().catch(() => {});
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: tmpPath });
      text = result.value;
    } else {
      text = fs.readFileSync(tmpPath, 'utf8');
    }

    // 3000자로 제한 (Claude 비용 절감)
    text = text.replace(/\s+/g, ' ').trim().slice(0, 3000);
    if (!text) return res.status(400).json({ error: '텍스트를 추출할 수 없습니다.' });

    // Claude로 연구 맥락 + 키워드 추출
    const anthropicKey = credentials.keychainGet('__anthropic__') || process.env.ANTHROPIC_API_KEY;

    const extractPrompt = `다음 연구 텍스트를 분석하여 RISS 논문 검색에 최적화된 정보를 추출하세요.

텍스트:
${text}

[규칙]
- primaryConcepts: 핵심 이론·개념 2~3개
- secondaryConcepts: 관련 맥락·배경 개념 2~3개
- keywords: 핵심×핵심, 핵심×관련 조합 쿼리 8~12개 (각 2~3어절, 4단어 이상 금지, "분석/과정/연구" 끝에 붙이기 금지)
- researchContext: 연구 주제·핵심 개념·연구자 배경을 2~3문장으로 요약

JSON만 출력하세요:
{"researchContext":"...","primaryConcepts":["..."],"secondaryConcepts":["..."],"keywords":["..."]}`;

    let researchContext = '';
    let keywords = [];

    if (anthropicKey) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: extractPrompt }],
      });
      try {
        const json = JSON.parse(msg.content[0].text.match(/\{[\s\S]+\}/)[0]);
        keywords = (json.keywords || []).map(k => k.trim()).filter(Boolean);
        researchContext = json.researchContext || '';
      } catch {
        keywords = msg.content[0].text.split(',').map(k => k.trim()).filter(Boolean);
      }
    } else {
      const claudeCliPath = findClaudeCli();
      if (!claudeCliPath) return res.status(400).json({ error: 'Claude API 키 또는 Claude CLI가 필요합니다.' });
      const r = spawnSync(claudeCliPath, ['-p', extractPrompt], {
        encoding: 'utf8', timeout: 60000,
        env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH}` },
      });
      if (r.error) return res.status(500).json({ error: `Claude CLI 오류: ${r.error.message}` });
      try {
        const json = JSON.parse(r.stdout.match(/\{[\s\S]+\}/)[0]);
        keywords = (json.keywords || []).map(k => k.trim()).filter(Boolean);
        researchContext = json.researchContext || '';
      } catch {
        keywords = r.stdout.split(',').map(k => k.trim()).filter(Boolean);
      }
    }

    res.json({ keywords, researchContext });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ── 연구 맥락 텍스트 → 키워드 생성 ──────────────────────
app.post('/api/extract-from-context', async (req, res) => {
  const { contextText } = req.body;
  if (!contextText || !contextText.trim()) {
    return res.status(400).json({ error: '연구 맥락 텍스트가 없습니다.' });
  }

  const anthropicKey = credentials.keychainGet('__anthropic__') || process.env.ANTHROPIC_API_KEY;

  const prompt = `다음 연구 맥락에서 RISS 논문 검색 키워드를 생성하세요.

연구 맥락: ${contextText.trim().slice(0, 1000)}

[규칙]
- 핵심 개념 2~3개 + 관련 개념 2~3개 추출
- 핵심×핵심, 핵심×관련 조합으로 8~12개 쿼리 생성
- 각 쿼리 2~3어절, 4단어 이상 금지
- "분석/과정/연구" 같은 방법 단어 끝에 붙이기 금지

JSON만 출력: {"keywords":["..."]}`;

  try {
    let keywords = [];
    if (anthropicKey) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });
      try {
        const json = JSON.parse(msg.content[0].text.match(/\{[\s\S]+\}/)[0]);
        keywords = (json.keywords || []).map(k => k.trim()).filter(Boolean);
      } catch {
        keywords = msg.content[0].text.split(',').map(k => k.trim()).filter(Boolean);
      }
    } else {
      const claudeCliPath = findClaudeCli();
      if (!claudeCliPath) return res.status(400).json({ error: 'Claude API 키 또는 Claude CLI가 필요합니다.' });
      const r = spawnSync(claudeCliPath, ['-p', prompt], {
        encoding: 'utf8', timeout: 60000,
        env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH}` },
      });
      if (r.error) return res.status(500).json({ error: `Claude CLI 오류: ${r.error.message}` });
      try {
        const json = JSON.parse(r.stdout.match(/\{[\s\S]+\}/)[0]);
        keywords = (json.keywords || []).map(k => k.trim()).filter(Boolean);
      } catch {
        keywords = r.stdout.split(',').map(k => k.trim()).filter(Boolean);
      }
    }
    res.json({ keywords });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 파이프라인 실행 (Server-Sent Events) ──────────────────
app.post('/api/run', (req, res) => {
  if (runner.isRunning()) {
    return res.status(409).json({ error: '이미 실행 중입니다.' });
  }

  const params = req.body;
  const cfg = config.load();
  const universityId = params.universityId || cfg.selectedUniversity || 'hufs';
  const lid = params.libraryId || cfg.libraryId;

  if (!lid) return res.status(400).json({ error: '도서관 ID가 설정되지 않았습니다.' });

  const lpw = credentials.keychainGet(universityId);
  if (!lpw) return res.status(400).json({ error: '도서관 PW를 먼저 저장하세요.' });

  const anthropicKey = credentials.keychainGet('__anthropic__') || process.env.ANTHROPIC_API_KEY;
  const claudeCliPath = (!anthropicKey && !params.skipClassify) ? findClaudeCli() : null;
  const useClaudeCli = !!claudeCliPath;

  if (params.keywords && params.keywords.length > 0) {
    config.save({ lastKeywords: params.keywords, lastOutputDir: params.outputDir || cfg.lastOutputDir });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  send('start', '파이프라인 시작...\n');

  const resolvedOutputDir = params.outputDir || path.join(__dirname, '..', 'output');

  runner.run(
    { ...params, universityId, libraryId: lid, libraryPw: lpw, anthropicKey, useClaudeCli, claudeCliPath, researchContext: params.researchContext || null },
    (text) => send('log', text),
    (code) => {
      if (code === 0) {
        let total = 0, pdfCount = 0;
        try {
          const metaPath = path.join(resolvedOutputDir, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            const papers = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            total = Array.isArray(papers) ? papers.length : 0;
          }
        } catch {}
        try {
          const countPdfs = (dir) => {
            if (!fs.existsSync(dir)) return 0;
            return fs.readdirSync(dir).reduce((acc, f) => {
              const fp = path.join(dir, f);
              return acc + (fs.statSync(fp).isDirectory() ? countPdfs(fp) : f.endsWith('.pdf') ? 1 : 0);
            }, 0);
          };
          pdfCount = countPdfs(path.join(resolvedOutputDir, 'pdfs'));
        } catch {}

        send('summary', { outputDir: resolvedOutputDir, total, pdfCount });

        try {
          if (process.platform !== 'win32') {
            execSync(
              `osascript -e 'display notification "총 ${total}건 수집 완료 · PDF ${pdfCount}개" with title "RISS 논문 수집기" sound name "Glass"'`,
              { timeout: 5000 }
            );
          }
        } catch {}
      }

      send('end', code === 0 ? '✅ 완료' : `❌ 종료 코드: ${code}`);
      res.end();
    }
  );
});

// ── 실행 중단 ─────────────────────────────────────────────
app.post('/api/stop', (req, res) => {
  runner.stop();
  res.json({ ok: true });
});

// ── 저장 폴더 열기 ────────────────────────────────────────
app.post('/api/open-folder', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: '경로가 없습니다.' });
  try {
    if (process.platform === 'win32') {
      execSync(`explorer "${folderPath.replace(/\//g, '\\')}"`, { timeout: 5000 });
    } else {
      execSync(`open "${folderPath}"`, { timeout: 5000 });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 서버 종료 ─────────────────────────────────────────────
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

// ── 서버 시작 ─────────────────────────────────────────────
(async () => {
  // 기존 HUFS 사용자 마이그레이션: libraryId 키 → 'hufs' 키
  try {
    const cfg = config.load();
    if (cfg.libraryId && credentials.keychainHas(cfg.libraryId) && !credentials.keychainHas('hufs')) {
      const pw = credentials.keychainGet(cfg.libraryId);
      if (pw) credentials.keychainSet('hufs', pw);
    }
  } catch {}

  const port = await findFreePort(47281, 47299);
  config.writePort(port);
  app.listen(port, '127.0.0.1', () => {
    console.log(`RISS UI 서버: http://127.0.0.1:${port}`);
  });
})();
