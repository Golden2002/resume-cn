/**
 * 产物门禁：判这份 PDF 在「能不能被机器正确读取」与「字体是否真的在」上是否合规。
 *
 * 这一层的原则是不自证：
 *   字体是否嵌入，读 PDF 结构判断，不信转换器的口头报告；
 *   ATS 可解析性，用多个独立抽取器交叉比对，不信我们自己写的解析。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findChineseIds } = require('./idcheck');
const { latinTokens } = require('../fonts');

/** 尝试用外部工具抽文本，返回 {tool, text} 列表。装了什么用什么，缺了就记缺。 */
function extractText(pdfPath) {
  const out = [];

  const pdftotext = probe('pdftotext');
  if (pdftotext) {
    const r = spawnSync(pdftotext, ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) out.push({ tool: 'pdftotext', text: r.stdout });
  }

  const mutool = probe('mutool');
  if (mutool) {
    const r = spawnSync(mutool, ['draw', '-F', 'txt', pdfPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) out.push({ tool: 'mutool', text: r.stdout });
  }

  const python = probe(process.platform === 'win32' ? 'python' : 'python3');
  if (python) {
    // 中文 Windows 上 Python 的 stdout 默认走 GBK，遇到「•」「「」」之类的字符会抛
    // UnicodeEncodeError。必须强制 UTF-8 模式，否则抽取会在中途静默失败。
    const code = 'import sys,fitz;d=fitz.open(sys.argv[1]);sys.stdout.write("".join(p.get_text() for p in d))';
    const r = spawnSync(python, ['-X', 'utf8', '-c', code, pdfPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) out.push({ tool: 'pymupdf', text: r.stdout });
    else out.push({ tool: 'pymupdf', error: (r.stderr || '').slice(0, 200) });
  }

  return out;
}

function probe(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [cmd], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  return null;
}

/**
 * 字体嵌入检查。
 * 判据（启发式，会在报告里标明方法）：PDF 里每个 FontDescriptor 应当伴随 FontFile、
 * FontFile2 或 FontFile3 流。缺一个就说明有字体没嵌入，换机器打印会变形。
 */
function checkFontsEmbedded(pdfPath) {
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const descriptors = (raw.match(/\/Type\s*\/FontDescriptor/g) || []).length;
  const fontFiles =
    (raw.match(/\/FontFile\b/g) || []).length +
    (raw.match(/\/FontFile2\b/g) || []).length +
    (raw.match(/\/FontFile3\b/g) || []).length;
  const baseFonts = [...raw.matchAll(/\/BaseFont\s*\/([^\s/\[\]<>()]+)/g)].map((m) => m[1]);
  return {
    method: 'PDF 结构扫描（FontDescriptor 与 FontFile 计数）',
    descriptors,
    fontFiles,
    embedded: descriptors > 0 && fontFiles >= descriptors,
    baseFonts: [...new Set(baseFonts)].slice(0, 24),
    note: '这是启发式判断，不替代 veraPDF 之类的合规校验。要更严格请自行跑 veraPDF 的 PDF/A 与 PDF/UA 配置。',
  };
}

/** 归一化：去空白、统一全半角外观，用于跨工具比对 */
function normalize(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[·・]/g, '')
    .trim();
}

/**
 * ATS 往返检查：多个抽取器抽出的文本是否彼此一致。
 * 只要求「至少两个工具都跑通且归一化后一致」，不一致就报出来，不猜谁对。
 */
function atsRoundTrip(pdfPath, expect = []) {
  const raw = extractText(pdfPath);
  const results = raw.filter((r) => !r.error);
  const toolErrors = raw.filter((r) => r.error);

  if (!results.length) {
    return {
      ok: false,
      skipped: true,
      reason:
        '没有可用的文本抽取器。装 poppler 的 pdftotext、MuPDF 的 mutool、或 Python 的 PyMuPDF 其中至少两个，才能做交叉验证。' +
        (toolErrors.length ? ` 已探测到但报错：${toolErrors.map((e) => e.tool + ' ' + e.error).join('；')}` : ''),
      tools: [],
    };
  }

  const normalized = results.map((r) => ({ tool: r.tool, text: normalize(r.text) }));

  // 只有一个抽取器：退化为单源校验，只确认关键字段被读到，并明确标注这是弱校验
  if (normalized.length === 1) {
    const only = normalized[0];
    const missing = expect.filter((s) => s && !only.text.includes(normalize(s)));
    return {
      ok: missing.length === 0,
      mode: 'single',
      tools: [only.tool],
      missing,
      note: '只有一个抽取器，做单源校验：只确认关键字段是否被读到，不验证解析一致性。',
      sample: only.text.slice(0, 120),
    };
  }

  const base = normalized[0];
  const mismatches = normalized
    .slice(1)
    .filter((r) => r.text !== base.text)
    .map((r) => ({
      tool: r.tool,
      vsTool: base.tool,
      length: r.text.length,
      baseLength: base.text.length,
    }));
  return {
    ok: mismatches.length === 0,
    mode: 'cross',
    tools: normalized.map((r) => r.tool),
    mismatches,
    sample: base.text.slice(0, 120),
  };
}

/** 隐私扫描：对仓库目录做，不只看 PDF。判据与体例门禁共用同一套校验位判断。 */
function scanPii(dir) {
  const hits = [];
  const walk = (p, depth = 0) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === 'fonts') continue;
      const fp = path.join(p, e.name);
      if (e.isDirectory()) {
        walk(fp, depth + 1);
      } else if (/\.(ya?ml|json|md|txt|js)$/.test(e.name)) {
        let content = '';
        try {
          content = fs.readFileSync(fp, 'utf8');
        } catch (err) {
          continue;
        }
        const found = findChineseIds(content);
        if (found.length) hits.push({ file: path.relative(dir, fp), matched: found[0].slice(0, 6) + '…', count: found.length });
      }
    }
  };
  walk(dir);
  return hits;
}

/**
 * 声明字体是否真的被用上。
 * 「字体都嵌入了」不等于「用的是模板声明的字体」：转换器在缺字体时会静默替换，
 * 替换后的字体照样被嵌入，PDF 看着正常，但字面宽度与版式全都变了。
 * 所以要比对 PDF 里的 BaseFont 名，这是 LibreOffice 报 missingFonts 之外的第二道保险。
 */
function checkDeclaredFont(pdfPath, acceptableFamilies) {
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const baseFonts = [...raw.matchAll(/\/BaseFont\s*\/([^\s/\[\]<>()]+)/g)].map((m) => m[1]);
  const strip = (s) => String(s || '').replace(/^[A-Z]{6}\+/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const present = [...new Set(baseFonts.map(strip))];
  const wanted = (acceptableFamilies || []).filter(Boolean);
  let matched = null;
  let matchedToken = null;
  for (const fam of wanted) {
    const hit = latinTokens(fam).find((t) => present.some((p) => p.includes(t)));
    if (hit) {
      matched = fam;
      matchedToken = hit;
      break;
    }
  }
  return {
    expected: wanted,
    matched,
    matchedToken,
    found: !!matched,
    baseFonts: [...new Set(baseFonts)].slice(0, 16),
  };
}

module.exports = { extractText, checkFontsEmbedded, checkDeclaredFont, atsRoundTrip, scanPii, normalize };
