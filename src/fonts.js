/**
 * 字体管理：下载与自定义。
 *
 * 设计要点：
 * 1. 仓库不分发任何字体文件。默认字体为思源黑体（SIL OFL 1.1），由使用者本机下载。
 * 2. DOCX 里只写字体名。字体能否被解析，取决于转换 PDF 的那台机器是否装了该字体。
 *    因此本模块只负责「把字体文件取到本地、给出按系统安装的指令、报告状态」，
 *    真正「是否解析成功」由产物门禁（artifact gate）在 PDF 上判定，不在这里假设成功。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');

// 固定到具体发布版本的直链，不用 latest 之类的浮动地址。
const KNOWN_SOURCES = {
  'Source Han Sans SC': {
    version: '2.004R',
    license: 'SIL Open Font License 1.1',
    upstream: 'https://github.com/adobe-fonts/source-han-sans',
    files: {
      regular:
        'https://github.com/adobe-fonts/source-han-sans/raw/release/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf',
      bold:
        'https://github.com/adobe-fonts/source-han-sans/raw/release/OTF/SimplifiedChinese/SourceHanSansSC-Bold.otf',
    },
  },
};

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向次数过多：' + url));
    https
      .get(url, { headers: { 'User-Agent': 'resume-cn' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return download(next, dest, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}：${url}`));
        }
        const tmp = dest + '.part';
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(tmp, dest);
            resolve();
          });
        });
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 字体族名到 PDF 内 PostScript 名的别名表。
 * PDF 的 BaseFont 只写拉丁名，中文字体族名（微软雅黑）在里面是 MicrosoftYaHei。
 * 没有这张表，字体门禁会把「雅黑确实已生效」误判成失败。
 */
const FAMILY_ALIASES = {
  微软雅黑: ['MicrosoftYaHei', 'MicrosoftYaHeiUI', 'MSYH'],
  'Microsoft YaHei': ['MicrosoftYaHei'],
  思源黑体: ['SourceHanSans'],
  'Source Han Sans SC': ['SourceHanSansSC', 'SourceHanSans'],
  'Source Han Sans': ['SourceHanSans'],
  'Noto Sans CJK SC': ['NotoSansCJKsc', 'NotoSansCJK'],
  宋体: ['SimSun', 'NSimSun'],
  SimSun: ['SimSun'],
  黑体: ['SimHei'],
  SimHei: ['SimHei'],
  楷体: ['KaiTi'],
  KaiTi: ['KaiTi'],
  仿宋: ['FangSong'],
  FangSong: ['FangSong'],
  苹方: ['PingFang'],
  'PingFang SC': ['PingFang'],
};

/** 该字体族在 PDF 里可能出现的拉丁名（小写，去分隔符） */
function latinTokens(family) {
  const key = String(family || '').trim();
  if (FAMILY_ALIASES[key]) return FAMILY_ALIASES[key].map((t) => t.toLowerCase());
  const stripped = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return stripped ? [stripped] : [];
}

/** 系统字体清单文本（注册表或 fc-list），用于判断字体族是否已装 */
let _sysCache = null;
function systemFontText() {
  if (_sysCache !== null) return _sysCache;
  const chunks = [];
  if (process.platform === 'win32') {
    for (const key of [
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    ]) {
      const r = spawnSync('reg', ['query', key], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout) chunks.push(r.stdout);
    }
  } else {
    const fc = spawnSync('fc-list', [':', 'family'], { encoding: 'utf8' });
    if (fc.status === 0 && fc.stdout) chunks.push(fc.stdout);
  }
  _sysCache = chunks.join('\n').toLowerCase();
  return _sysCache;
}

/** 该字体族是否已在系统里可被解析 */
function isInstalledOnSystem(family) {
  const key = String(family || '').trim().toLowerCase();
  if (!key) return false;
  const text = systemFontText();
  if (text.includes(key)) return true;
  return latinTokens(family).some((t) => text.includes(t));
}

function userFontDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Fonts');
  return path.join(os.homedir(), '.local', 'share', 'fonts');
}

function readManifest(fontsDir) {
  const f = path.join(fontsDir, 'fonts.yaml');
  if (!fs.existsSync(f)) return {};
  try {
    return require('js-yaml').load(fs.readFileSync(f, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

/**
 * 下载某个已知字体族到 fontsDir。
 * 已存在且大小非零则跳过，不去重复下载 16MB 的文件。
 */
async function install(family, fontsDir, log = console.log) {
  const src = KNOWN_SOURCES[family];
  if (!src) {
    throw new Error(
      `不知道如何下载「${family}」。可用字体族：${Object.keys(KNOWN_SOURCES).join('、')}。` +
        '其他字体请用 `resume-cn fonts define` 指定本地文件。'
    );
  }
  fs.mkdirSync(fontsDir, { recursive: true });
  const results = [];
  for (const [weight, url] of Object.entries(src.files)) {
    const dest = path.join(fontsDir, path.basename(url));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      results.push({ weight, file: dest, skipped: true, sha256: sha256(dest) });
      continue;
    }
    log(`下载 ${path.basename(url)} …`);
    await download(url, dest);
    results.push({ weight, file: dest, skipped: false, sha256: sha256(dest), bytes: fs.statSync(dest).size });
  }
  return { family, version: src.version, license: src.license, upstream: src.upstream, files: results };
}

/** 登记一个自定义字体族，把族名映射到本地字体文件。 */
function define(fontsDir, { family, regular, bold }) {
  if (!family || !regular) throw new Error('define 需要 family 与 regular 两个参数');
  for (const f of [regular, bold].filter(Boolean)) {
    if (!fs.existsSync(f)) throw new Error('字体文件不存在：' + f);
  }
  fs.mkdirSync(fontsDir, { recursive: true });
  const manifestPath = path.join(fontsDir, 'fonts.yaml');
  const manifest = readManifest(fontsDir);
  manifest[family] = { regular, bold: bold || null, source: 'user' };
  fs.writeFileSync(manifestPath, require('js-yaml').dump(manifest, { lineWidth: 120 }), 'utf8');
  return { family, manifestPath, entry: manifest[family] };
}

/** 报告某个字体族在本机能否被找到，以及应当怎样处理。 */
function status(family, fontsDir) {
  const manifest = readManifest(fontsDir);
  const known = KNOWN_SOURCES[family];
  const local = manifest[family] || null;
  const expected = known
    ? Object.values(known.files).map((u) => path.join(fontsDir, path.basename(u)))
    : local
    ? [local.regular, local.bold].filter(Boolean)
    : [];
  const present = expected.filter((f) => fs.existsSync(f));
  return {
    family,
    fontsDir,
    localFiles: present,
    missingFiles: expected.filter((f) => !fs.existsSync(f)),
    userFontDir: userFontDir(),
    systemInstalled: isInstalledOnSystem(family),
    howToInstall: instructions(family, expected, fontsDir),
  };
}

/**
 * 把已下载的字体装进当前用户字体目录。
 *
 * 为什么要这一步：DOCX 只写字体名，LibreOffice 只认系统已注册的字体。
 * 文件放在项目里不会被解析，转换时会静默替换成别的字体，版式随之改变。
 * Windows 上除复制文件外还要写 HKCU 的字体注册表项，只复制不注册不生效。
 * 这是可逆操作：删除目标文件与对应注册表值即可卸下。
 */
function installToUser(files) {
  const { spawnSync } = require('child_process');
  const target = userFontDir();
  fs.mkdirSync(target, { recursive: true });
  const placed = [];
  for (const src of files) {
    if (!src || !fs.existsSync(src)) continue;
    const dest = path.join(target, path.basename(src));
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) {
      fs.copyFileSync(src, dest);
    }
    placed.push(dest);
  }

  const registry = [];
  if (process.platform === 'win32') {
    const key = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';
    for (const dest of placed) {
      const style = /-(Bold|Regular|Light|Medium)/.exec(path.basename(dest));
      const fullName = 'Source Han Sans SC' + (style ? ' ' + style[1] : '');
      const valueName = fullName + ' (OpenType)';
      const r = spawnSync('reg', ['add', key, '/v', valueName, '/t', 'REG_SZ', '/d', dest, '/f'], { encoding: 'utf8' });
      registry.push({ valueName, ok: r.status === 0 });
    }
  }
  return { target, placed, registry };
}

function instructions(family, files, fontsDir) {
  const target = userFontDir();
  const steps = [];
  if (process.platform === 'win32') {
    steps.push(`把 ${path.basename(files[0] || '字体文件')} 等字体文件复制到 ${target}，然后右键选择「安装」。`);
    steps.push('只复制文件不够，Windows 需要安装后才注册字体名。装完重启 LibreOffice 或任何已打开的文字处理器。');
  } else if (process.platform === 'darwin') {
    steps.push(`把字体文件复制到 ${target}，或在「字体册」中打开并安装。`);
  } else {
    steps.push(`把字体文件复制到 ${target}，然后执行 fc-cache -f。`);
  }
  steps.push(`也可以在项目内保留字体文件（${fontsDir}），但 LibreOffice 只认系统字体目录。`);
  steps.push('转换 PDF 后，用 `resume-cn check` 的产物门禁确认字体是否真的全部嵌入；门禁不过，说明字体没装上。');
  return { family, target, steps };
}

module.exports = {
  KNOWN_SOURCES,
  FAMILY_ALIASES,
  latinTokens,
  isInstalledOnSystem,
  install,
  define,
  status,
  installToUser,
  userFontDir,
  sha256,
};
