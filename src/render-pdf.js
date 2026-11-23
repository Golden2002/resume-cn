/**
 * PDF 转换。
 *
 * 关键设计：DOCX 与 PDF 是两条独立路径，不做「先出 Word 再另存」。
 * 转换器由外部提供，按以下顺序解析：
 *   1. --pdf-cmd 或环境变量 RESUME_CN_PDF_CMD（命令模板，含 {input} {output}）
 *   2. 系统 PATH 里的 soffice / libreoffice
 *   3. 本项目已知的 LibreOffice Kit CLI（若存在）
 * 转换器返回的 missingFonts 会原样带出，交给产物门禁判定，不在这里吞掉。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function which(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
  return null;
}

function resolveConverter(engine, cmdTemplate) {
  const e = engine || process.env.RESUME_CN_PDF_ENGINE || 'auto';

  // Word 路径：只能走 COM，交给 tools/convert-word.ps1。
  // 基准简历就是 Word 2019 导出的，需要逐页对齐基准时选它。
  if (e === 'word') {
    const ps1 = path.join(__dirname, '..', 'tools', 'convert-word.ps1');
    return { kind: 'word', ps1 };
  }

  if (cmdTemplate) return { kind: 'custom-template', template: cmdTemplate };

  const envCmd = process.env.RESUME_CN_PDF_CMD;
  if (envCmd) return { kind: 'custom-template', template: envCmd };

  // 明确要求 LibreOffice 时只找 LO，避免悄悄换成 Word 而破坏可比性
  for (const name of ['soffice', 'libreoffice']) {
    const p = which(name);
    if (p) return { kind: 'soffice', bin: p };
  }

  // 已知的便携式 LibreOffice Kit（可选，不假设存在）
  const kitNode = process.env.RESUME_CN_KIT_NODE;
  const kitCli = process.env.RESUME_CN_KIT_CLI;
  if (kitNode && kitCli && fs.existsSync(kitNode) && fs.existsSync(kitCli)) {
    return { kind: 'kit', node: kitNode, cli: kitCli };
  }

  return null;
}

function runConverter(conv, input, output) {
  let args;
  let bin;
  if (conv.kind === 'word') {
    // 用 PowerShell 调 Word COM。脚本内部带诊断输出，失败时能看出卡在哪一步。
    bin = process.platform === 'win32' ? 'powershell' : 'pwsh';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', conv.ps1, '-Input', input, '-Output', output];
    return spawnSync(bin, args, { encoding: 'utf8', timeout: 180000 });
  }
  if (conv.kind === 'custom-template') {
    const rendered = conv.template.replace('{input}', input).replace('{output}', output);
    // 交给 shell 执行，允许用户写任意命令
    return spawnSync(rendered, { shell: true, encoding: 'utf8', timeout: 180000 });
  }
  if (conv.kind === 'soffice') {
    bin = conv.bin;
    args = ['--headless', '--norestore', `--convert-to`, 'pdf', '--outdir', path.dirname(output), input];
    return spawnSync(bin, args, { encoding: 'utf8', timeout: 180000 });
  }
  bin = conv.node;
  args = [conv.cli, 'convert', '--input', input, '--output', output];
  return spawnSync(bin, args, { encoding: 'utf8', timeout: 180000 });
}

function parseMissingFonts(stdout) {
  const m = /"missingFonts"\s*:\s*\[([^\]]*)\]/.exec(stdout || '');
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function convert({ input, output, engine, cmd }) {
  const conv = resolveConverter(engine, cmd);
  if (!conv) {
    return {
      ok: false,
      reason:
        '找不到 PDF 转换器。三条路：装 LibreOffice 让 soffice 进 PATH；' +
        '或用 --pdf-cmd 指定命令模板；或设环境变量 RESUME_CN_PDF_CMD。' +
        '也可以用 --pdf-engine word 走 Microsoft Word。',
    };
  }
  // 转换器要求目标文件不存在的情况很常见，先清掉旧产物
  for (const p of [output, path.join(path.dirname(output), path.basename(input, path.extname(input)) + '.pdf')]) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch (e) {
        return { ok: false, reason: '旧产物无法删除，可能被占用：' + p };
      }
    }
  }

  const expected = path.join(path.dirname(output), path.basename(input, path.extname(input)) + '.pdf');
  const r = runConverter(conv, input, output);
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';

  if (r.error) return { ok: false, reason: '转换器启动失败：' + r.error.message, conv: conv.kind };
  if (r.status !== 0) return { ok: false, reason: `转换器退出码 ${r.status}：${(stderr || stdout).slice(-400)}`, conv: conv.kind };

  if (conv.kind === 'soffice' && expected !== output && fs.existsSync(expected)) {
    fs.renameSync(expected, output);
  }
  if (!fs.existsSync(output)) {
    return { ok: false, reason: '转换器未产出目标文件：' + output + '；输出：' + (stdout || stderr).slice(-400), conv: conv.kind };
  }
  return { ok: true, pdf: output, conv: conv.kind, missingFonts: parseMissingFonts(stdout + stderr), raw: { stdout, stderr } };
}

module.exports = { convert, resolveConverter };
