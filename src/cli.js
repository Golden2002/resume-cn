#!/usr/bin/env node
/**
 * resume-cn 命令行。
 *
 * 三个动作：build（渲染）、check（跑三道门禁）、fonts（字体）。
 * 门禁失败时退出码为 1，可直接挂进 CI。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const ROOT = path.resolve(__dirname, '..');
const renderDocx = require('./render-docx');
const renderPdf = require('./render-pdf');
const layoutGate = require('./gates/layout').layoutGate;
const languageGate = require('./gates/language');
const artifactGate = require('./gates/artifact');
const fonts = require('./fonts');

// ---------- 小工具 ----------
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function has(name) {
  return process.argv.includes('--' + name);
}
function readStructured(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, 'utf8');
  return ext === '.json' ? JSON.parse(raw) : yaml.load(raw);
}
function c(s, code) {
  if (!process.stdout.isTTY) return s;
  return `\u001b[${code}m${s}\u001b[0m`;
}
const red = (s) => c(s, 31);
const green = (s) => c(s, 32);
const yellow = (s) => c(s, 33);
const dim = (s) => c(s, 90);

function validate(schemaFile, data, label) {
  const schema = readStructured(path.join(ROOT, schemaFile));
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
  const ok = ajv.validate(schema, data);
  if (ok) return [];
  return (ajv.errors || []).map((e) => `${label}${e.instancePath || ''} ${e.message}`);
}

/**
 * YAML 里没加引号的日期与编号会被解析成数字，大整数还会丢精度。
 * 这里做一次兜底：把已知的日期型、编号型字段统一转成字符串并提示补引号。
 * 超过安全整数范围的编号无法还原，直接报错要求加引号。
 */
const DATE_FIELDS = ['startDate', 'endDate', 'date', 'releaseDate', 'birthDate'];
const ID_FIELDS = ['credentialId', 'studentId', 'score', 'phone'];

function normalizeScalars(data, warnings) {
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const here = trail ? trail + '.' + k : k;
      if (v && typeof v === 'object') {
        walk(v, here);
        continue;
      }
      if (typeof v !== 'number') continue;
      const isDate = DATE_FIELDS.includes(k);
      const isId = ID_FIELDS.includes(k);
      if (!isDate && !isId) continue;
      if (isId && !Number.isSafeInteger(v)) {
        throw new Error(
          `${here} 的值 ${v} 超出安全整数范围，已被 YAML 解析丢失精度。请在 YAML 里给它加引号，写成字符串。`
        );
      }
      node[k] = String(v);
      warnings.push(`${here} 在 YAML 里是数字，已按字符串处理。建议加引号，例如 "${v}"。`);
    }
  };
  walk(data, '');
  return data;
}

function pageCount(pdfPath) {
  // 优先用 PyMuPDF，退化到结构计数
  const tryPython = () => {
    try {
      const { spawnSync } = require('child_process');
      const finder = process.platform === 'win32' ? 'where' : 'which';
      const probe = spawnSync(finder, ['python'], { encoding: 'utf8' });
      if (probe.status !== 0) return null;
      const r = spawnSync('python', ['-X', 'utf8', '-c', 'import sys,fitz;print(fitz.open(sys.argv[1]).page_count)', pdfPath], {
        encoding: 'utf8',
      });
      if (r.status === 0 && /^\d+$/.test(r.stdout.trim())) return parseInt(r.stdout.trim(), 10);
    } catch (e) {
      return null;
    }
    return null;
  };
  const n = tryPython();
  if (n) return { count: n, method: 'PyMuPDF' };
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const m = raw.match(/\/Type\s*\/Page[^s]/g);
  return { count: m ? m.length : null, method: 'PDF 结构计数（启发式）' };
}

// ---------- build / check ----------
function loadContext() {
  const dataDir = path.resolve(arg('data', path.join(ROOT, 'data', 'example')));
  const variantName = arg('variant', 'teacher-biology');
  const variantPath = path.isAbsolute(variantName)
    ? variantName
    : path.join(dataDir, 'variants', variantName.endsWith('.yaml') || variantName.endsWith('.json') ? variantName : variantName + '.yaml');

  if (!fs.existsSync(variantPath)) throw new Error('找不到变体文件：' + variantPath);
  const variant = readStructured(variantPath);

  const resumePath = ['resume.yaml', 'resume.yml', 'resume.json']
    .map((f) => path.join(dataDir, f))
    .find((f) => fs.existsSync(f));
  if (!resumePath) throw new Error('数据目录里没有 resume.yaml 或 resume.json：' + dataDir);
  const data = readStructured(resumePath);
  const warnings = [];
  normalizeScalars(data, warnings);
  if (warnings.length) {
    console.log(yellow(`! 有 ${warnings.length} 个字段在 YAML 里没有加引号，已按字符串处理：`));
    for (const w of warnings.slice(0, 6)) console.log(dim('  ' + w));
    if (warnings.length > 6) console.log(dim(`  …还有 ${warnings.length - 6} 个`));
  }

  const templateDir = path.join(ROOT, 'templates', variant.template);
  const templatePath = path.join(templateDir, 'template.yaml');
  if (!fs.existsSync(templatePath)) throw new Error('找不到模板清单：' + templatePath);
  const template = readStructured(templatePath);

  // --font 覆盖模板声明的字体，方便别人在没装默认字体的机器上换字体
  const fontOverride = arg('font');
  if (fontOverride) {
    template.font = Object.assign({}, template.font, { family: fontOverride, eastAsia: fontOverride });
  }

  return { dataDir, resumePath, variantPath, variant, data, templateDir, template };
}

async function cmdBuild({ runGates }) {
  const ctx = loadContext();
  const { data, variant, template, dataDir } = ctx;

  const problems = [];
  problems.push(...validate('schemas/resume.schema.json', data, '数据'));
  problems.push(...validate('schemas/variant.schema.json', variant, '变体'));
  if (problems.length) {
    console.log(red('✗ schema 校验失败'));
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log(green('✓ schema 校验通过'));

  const outDir = path.resolve(arg('out', path.join(ROOT, 'out', path.basename(dataDir) + '-' + path.basename(ctx.variantPath, '.yaml'))));
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, (data.basics.name || 'resume') + '-' + path.basename(ctx.variantPath, '.yaml'));

  const t0 = Date.now();
  const docx = await renderDocx.render({ data, variant, template, dataDir, outFile: base + '.docx' });
  console.log(green('✓ DOCX ') + dim(`${docx.outFile} （${(docx.bytes / 1024).toFixed(0)} KB，${Date.now() - t0} ms）`));

  let pdfResult = null;
  if (!has('no-pdf')) {
    pdfResult = renderPdf.convert({ input: docx.outFile, output: base + '.pdf', engine: arg('pdf-engine'), cmd: arg('pdf-cmd') });
    if (pdfResult.ok) {
      console.log(green('✓ PDF  ') + dim(`${pdfResult.pdf} （转换器：${pdfResult.conv}）`));
      if (pdfResult.missingFonts && pdfResult.missingFonts.length) {
        console.log(yellow('! 转换器报告缺字体：' + pdfResult.missingFonts.join('、')));
      }
    } else {
      console.log(yellow('! PDF 未生成：' + pdfResult.reason));
      console.log(dim('  DOCX 已生成，可自行转换。或用 --pdf-cmd 指定转换命令。'));
    }
  }

  if (runGates) runAllGates({ ctx, docx, pdfResult });
  return { ctx, docx, pdfResult };
}

function runAllGates({ ctx, docx, pdfResult }) {
  const { data, variant, template } = ctx;
  const text = docx.plainText;
  let failed = 0;

  // 1. 体例
  let pageInfo = { count: null, method: '' };
  if (pdfResult && pdfResult.ok) pageInfo = pageCount(pdfResult.pdf);
  const layoutProblems = layoutGate({
    pageCount: pageInfo.count,
    pageBudget: variant.pageBudget || template.pageBudget,
    sectionsFound: [],
    variant,
    text,
  });
  const layoutHard = layoutProblems.filter((p) => p.severity !== 'note');
  if (layoutHard.length) {
    failed += layoutHard.length;
    console.log(red(`✗ 体例门禁：${layoutHard.length} 项`));
    for (const p of layoutHard) console.log(`  [${p.rule} ${p.clause}] ${p.detail}`);
  } else {
    console.log(green('✓ 体例门禁') + dim(pageInfo.count ? `（${pageInfo.count} 页，判据：${pageInfo.method}）` : '（无 PDF，页数未判）'));
  }
  for (const p of layoutProblems.filter((x) => x.severity === 'note')) {
    console.log(yellow(`! [${p.rule}] ${p.detail}`));
  }

  // 2. 语言
  const langHits = languageGate.check(text);
  if (langHits.length) {
    failed += langHits.length;
    console.log(red(`✗ 语言门禁：${langHits.length} 项`));
    const byRule = {};
    for (const h of langHits) (byRule[h.rule] = byRule[h.rule] || []).push(h);
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`  [${rule} ${list[0].clause}] ${list.length} 处　${list[0].hint}`);
      for (const h of list.slice(0, 3)) console.log(dim(`      …${h.context}…`));
    }
  } else {
    console.log(green('✓ 语言门禁') + dim(`（${languageGate.RULES.length} 条规则，0 违例）`));
  }

  // 3. 产物
  if (pdfResult && pdfResult.ok) {
    const fontInfo = artifactGate.checkFontsEmbedded(pdfResult.pdf);
    if (template.gates && template.gates.requireFontsEmbedded && !fontInfo.embedded) {
      failed++;
      console.log(red('✗ 产物门禁：字体未全部嵌入'));
      console.log(`  FontDescriptor ${fontInfo.descriptors} 个，FontFile ${fontInfo.fontFiles} 个`);
      console.log(dim('  多半是转换 PDF 的那台机器没装模板声明的字体。跑 resume-cn fonts status 看安装指引。'));
    } else {
      console.log(green('✓ 字体嵌入') + dim(`（${fontInfo.descriptors} 个字体描述符，均带嵌入流）`));
    }

    if (template.gates && template.gates.requireDeclaredFont) {
      const fam = [template.font.family].concat(template.font.fallback || []);
      const df = artifactGate.checkDeclaredFont(pdfResult.pdf, fam);
      if (!df.found) {
        failed++;
        console.log(red('✗ 产物门禁：模板声明的字体没被用上，转换器静默替换了'));
        console.log(`  期望其一：${df.expected.join(' / ')}`);
        console.log(`  PDF 内实际：${df.baseFonts.join('、') || '（未读到 BaseFont）'}`);
        console.log(dim('  替换后字面宽度与版式都会变。跑 resume-cn fonts status 看安装指引。'));
      } else {
        console.log(green('✓ 声明字体') + dim(`（PDF 内匹配到 ${df.matched}）`));
      }
    }

    if (template.gates && template.gates.requireAtsRoundTrip) {
      const expect = [data.basics.name].concat(variant.content.map((c) => c.title).filter(Boolean));
      const ats = artifactGate.atsRoundTrip(pdfResult.pdf, expect);
      if (ats.skipped) {
        console.log(yellow('! ATS 往返未执行：' + ats.reason));
      } else if (!ats.ok) {
        failed++;
        if (ats.mode === 'single') {
          console.log(red('✗ 产物门禁：单源校验未通过，这些关键字段没被读到：' + ats.missing.join('、')));
        } else {
          console.log(red('✗ 产物门禁：多解析器抽出的文本不一致'));
          for (const m of ats.mismatches) console.log(`  ${m.tool} 与 ${m.vsTool} 不一致（${m.length} 字 vs ${m.baseLength} 字）`);
        }
      } else {
        const tag = ats.mode === 'cross' ? `交叉验证：${ats.tools.join(' / ')} 一致` : `单源校验：${ats.tools[0]}（弱校验，仅确认关键字段可读）`;
        console.log(green('✓ ATS 往返') + dim(`（${tag}）`));
      }
    }
  } else {
    console.log(yellow('! 产物门禁未执行（没有 PDF）'));
  }

  // 4. 隐私（对整个数据与模板目录）
  const pii = artifactGate.scanPii(ROOT);
  if (pii.length) {
    failed += pii.length;
    console.log(red(`✗ 隐私门禁：${pii.length} 处`));
    for (const h of pii) console.log(`  ${h.file} 出现疑似身份证号 ${h.matched}`);
  } else {
    console.log(green('✓ 隐私门禁') + dim('（仓库内未发现完整身份证号）'));
  }

  console.log('');
  if (failed) {
    console.log(red(`合计 ${failed} 项未通过`));
    process.exit(1);
  }
  console.log(green('全部通过'));
}

// ---------- fonts ----------
function cmdFonts() {
  const sub = process.argv[3];
  const fontsDir = path.resolve(arg('fonts-dir', path.join(ROOT, 'fonts')));
  const family = arg('family', 'Source Han Sans SC');

  if (sub === 'install') {
    fonts
      .install(family, fontsDir, (m) => console.log(dim(m)))
      .then((r) => {
        console.log(green(`✓ 字体已就位：${r.family} ${r.version}（许可：${r.license}）`));
        for (const f of r.files) {
          console.log(`  ${path.basename(f.file)}  ${f.skipped ? '已存在' : (f.bytes / 1024 / 1024).toFixed(1) + ' MB'}`);
          console.log(dim(`    sha256 ${f.sha256}`));
        }
        const st = fonts.status(family, fontsDir);
        if (has('to-user')) {
          const placed = fonts.installToUser(r.files.map((f) => f.file));
          console.log(green(`✓ 已装进用户字体目录：${placed.target}`));
          for (const p of placed.placed) console.log('  ' + path.basename(p));
          if (placed.registry.length) {
            const ok = placed.registry.filter((x) => x.ok).length;
            console.log(`  注册表登记 ${ok}/${placed.registry.length} 项`);
            if (ok !== placed.registry.length) console.log(yellow('  有项登记失败，可能权限不足；手动右键安装亦可。'));
          }
          console.log(dim('  重启 LibreOffice 或任何已打开的文字处理器后才生效。'));
        } else {
          console.log('');
          console.log(yellow('还要把它们装进系统，否则转换 PDF 时解析不到：'));
          for (const s of st.howToInstall.steps) console.log('  - ' + s);
          console.log('');
          console.log(dim('  或者直接加 --to-user，让本工具复制并登记到当前用户字体目录。'));
        }
      })
      .catch((e) => {
        console.log(red('✗ ' + e.message));
        process.exit(1);
      });
    return;
  }

  if (sub === 'define') {
    try {
      const r = fonts.define(fontsDir, { family: arg('family'), regular: arg('regular'), bold: arg('bold') });
      console.log(green(`✓ 已登记自定义字体族「${r.family}」`));
      console.log(dim('  清单：' + r.manifestPath));
    } catch (e) {
      console.log(red('✗ ' + e.message));
      process.exit(1);
    }
    return;
  }

  if (sub === 'status' || !sub) {
    const st = fonts.status(family, fontsDir);
    console.log(`字体族：${st.family}`);
    console.log(`系统已安装：${st.systemInstalled ? green('是') : yellow('否')}`);
    console.log(`项目内字体目录：${st.fontsDir}`);
    console.log(`已就位：${st.localFiles.length ? st.localFiles.map((f) => path.basename(f)).join('、') : '无'}`);
    if (st.missingFiles.length && !st.systemInstalled) {
      console.log(yellow(`缺：${st.missingFiles.map((f) => path.basename(f)).join('、')}`));
    }
    console.log('\n安装指引：');
    for (const s of st.howToInstall.steps) console.log('  - ' + s);
    return;
  }

  console.log('用法：resume-cn fonts [install|define|status] --family <字体族> [--fonts-dir <目录>]');
}

// ---------- new ----------
function cmdNew() {
  const dest = path.resolve(process.argv[3] || 'my-resume');
  if (fs.existsSync(dest)) {
    console.log(red('✗ 目标已存在：' + dest));
    process.exit(1);
  }
  fs.mkdirSync(path.join(dest, 'variants'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'example', 'resume.yaml'), path.join(dest, 'resume.yaml'));
  fs.copyFileSync(
    path.join(ROOT, 'data', 'example', 'variants', 'teacher-biology.yaml'),
    path.join(dest, 'variants', 'teacher-biology.yaml')
  );
  // 修正相对 schema 路径
  const fix = (p) => {
    const s = fs.readFileSync(p, 'utf8').replace(/\.\.\/\.\.\/schemas\//g, path.join(ROOT, 'schemas').replace(/\\/g, '/') + '/');
    fs.writeFileSync(p, s, 'utf8');
  };
  fix(path.join(dest, 'resume.yaml'));
  fix(path.join(dest, 'variants', 'teacher-biology.yaml'));
  console.log(green('✓ 已在 ' + dest + ' 建好数据目录'));
  console.log('  1. 编辑 resume.yaml，把你的信息填进去');
  console.log('  2. 编辑 variants/teacher-biology.yaml，声明这一版要哪些内容');
  console.log('  3. 跑 node ' + path.relative(process.cwd(), path.join(ROOT, 'src', 'cli.js')) + ' build --data ' + dest + ' --variant teacher-biology');
}

// ---------- main ----------
async function main() {
  const cmd = process.argv[2];
  if (cmd === 'build') return cmdBuild({ runGates: false });
  if (cmd === 'check') return cmdBuild({ runGates: true });
  if (cmd === 'fonts') return cmdFonts();
  if (cmd === 'new') return cmdNew();

  console.log(`resume-cn ${require('../package.json').version}

用法：
  resume-cn new <目录>                       用示例数据建一个数据目录
  resume-cn build --data <目录> --variant <名> [--font <字体族>] [--no-pdf] [--pdf-cmd <命令>]
  resume-cn check --data <目录> --variant <名>  渲染并跑三道门禁
  resume-cn fonts install|define|status  [--family <字体族>] [--fonts-dir <目录>]

字体：模板默认微软雅黑，仓库不分发字体文件。没有默认字体时用 --font 指定自己装的字体。
门禁失败退出码为 1，可直接挂 CI。`);
}

main().catch((e) => {
  console.log(red('✗ ' + e.message));
  if (process.env.RESUME_CN_DEBUG) console.error(e);
  process.exit(1);
});
