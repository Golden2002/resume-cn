/**
 * DOCX 渲染器：读模板清单，把数据与变体渲染成 Word 文档。
 *
 * 有一条硬约束：模板清单里只有数值与文本，没有代码。换模板时改清单加一个布局实现，
 * 不去改数据、也不去改变体配置。
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadDocx() {
  try {
    return require('docx');
  } catch (e) {
    throw new Error('缺少依赖 docx。请在项目根目录执行 npm install。');
  }
}

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType, TabStopType,
  Footer, PageNumber, VerticalAlign, LineRuleType,
} = loadDocx();

const twip = (pt) => Math.round(pt * 20);
const halfPt = (pt) => Math.round(pt * 2);

/** 固定行高，避免换字体后行高变化把页数顶掉 */
function exactLine(pt) {
  return { line: Math.round(pt * 20), lineRule: LineRuleType.EXACT };
}

/**
 * 按模板的 lineMode 组装段落间距。
 * auto 模式直接用 OOXML 的行距倍数（240 等于单倍），与定稿脚本一致；
 * exact 模式改用固定行高，页数不随字体度量漂移。
 */
function makeSpacing(template, before, after, lineMult, exactPt) {
  const out = {};
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  if (template.lineMode === 'exact') {
    Object.assign(out, exactLine(exactPt));
  } else if (lineMult !== undefined) {
    out.line = lineMult;
    out.lineRule = 'auto';
  }
  return out;
}

function makeRuns(template) {
  const FONT = {
    ascii: template.font.family,
    hAnsi: template.font.family,
    eastAsia: template.font.eastAsia || template.font.family,
    cs: template.font.family,
  };
  const C = template.colors;
  const T = template.typography;
  const LH = template.lineHeightPt || {};
  const SP = template.spacing || {};
  const records = [];

  const run = (text, o = {}) => {
    records.push(String(text ?? ''));
    return new TextRun({
      text: String(text ?? ''),
      font: FONT,
      size: halfPt(o.size || T.body),
      bold: !!o.bold,
      color: o.color || C.ink,
    });
  };

  const sectionBar = (title) => {
    const cfg = SP.section || {};
    records.push(String(title));
    // 条高用「最小行高」给绝对值，色块高度才可预期
    const barHeight = cfg.heightPt || 20.5;
    return new Paragraph({
      // keepNext：标题条必须紧跟其下第一条内容，避免标题孤零零留在页底
      keepNext: true,
      shading: { type: ShadingType.CLEAR, fill: C.primary },
      indent: { left: cfg.indentLeft === undefined ? 0 : cfg.indentLeft, right: cfg.indentRight === undefined ? 0 : cfg.indentRight },
      spacing: Object.assign(
        { before: cfg.before === undefined ? 220 : cfg.before, after: cfg.after === undefined ? 96 : cfg.after },
        { line: Math.round(barHeight * 20), lineRule: LineRuleType.AT_LEAST }
      ),
      children: [new TextRun({ text: title, font: FONT, size: halfPt(T.sectionTitle), bold: true, color: 'FFFFFF' })],
    });
  };

  /**
   * 支持行内 **局部加粗**。用于在灰色的单位名里点出关键机构，
   * 例如「山东省烟台第一中学这一类信息是重要信息，需要加粗」那种强调。
   * 加粗段同时改用正文色，形成黑体加粗的效果。
   */
  const segmentRuns = (text, o = {}) => {
    const s = String(text ?? '');
    if (s.indexOf('**') < 0) return [run(s, o)];
    const out = [];
    for (const part of s.split(/(\*\*[^*]+\*\*)/g)) {
      if (!part) continue;
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        out.push(run(part.slice(2, -2), Object.assign({}, o, { bold: true, color: C.ink })));
      } else {
        out.push(run(part, o));
      }
    }
    return out;
  };

  const entryLine = (title, right, org) => {
    const cfg = SP.entry || {};
    return new Paragraph({
      spacing: makeSpacing(template, cfg.before, cfg.after, cfg.line, LH.body || 16.5),
      tabStops: [{ type: TabStopType.RIGHT, position: template.geometry.tabStopTwip }],
      children: [
        ...segmentRuns(title, { bold: true }),
        ...(org ? [run('  ｜  ', { color: C.muted, size: T.small }), ...segmentRuns(org, { color: C.muted, size: T.small })] : []),
        ...(right ? [run('\t' + right, { color: C.muted, size: T.small })] : []),
      ],
    });
  };

  const bullet = (children) => {
    const cfg = SP.bullet || {};
    return new Paragraph({
      numbering: { reference: 'dot', level: 0 },
      spacing: makeSpacing(template, cfg.before, cfg.after, cfg.line, LH.body || 16.5),
      children: Array.isArray(children) ? children : segmentRuns(children),
    });
  };

  const para = (children) => {
    const cfg = SP.para || {};
    return new Paragraph({
      spacing: makeSpacing(template, cfg.before, cfg.after, cfg.line, LH.body || 16.5),
      children: Array.isArray(children) ? children : segmentRuns(children),
    });
  };

  const inlineRow = (label, text) => {
    const kids = [];
    if (label) {
      kids.push(run(label, { bold: true, color: C.primary }));
      kids.push(run('　'));
    }
    kids.push(...segmentRuns(text));
    return bullet(kids);
  };

  return { FONT, run, segmentRuns, sectionBar, entryLine, bullet, para, inlineRow, records };
}

/** 按变体配置从数据里挑条目。给了 ids 就按 ids 的顺序挑，可用它给不同岗位排不同的先后。 */
function pickItems(list, cfg) {
  let items = Array.isArray(list) ? list.slice() : [];
  if (cfg.ids && cfg.ids.length) {
    const byId = new Map(items.filter((it) => it.id).map((it) => [it.id, it]));
    items = cfg.ids.map((id) => byId.get(id)).filter(Boolean);
  } else if (cfg.tags && cfg.tags.length) {
    const want = new Set(cfg.tags);
    items = items.filter((it) => Array.isArray(it.tags) && it.tags.some((t) => want.has(t)));
  }
  if (cfg.maxItems) items = items.slice(0, cfg.maxItems);
  return items;
}

function dateRange(it, sep) {
  if (!it.startDate && !it.endDate) return '';
  if (!it.startDate) return it.endDate;
  if (!it.endDate) return it.startDate;
  return `${it.startDate}${sep}${it.endDate}`;
}

function takeBullets(it, cfg) {
  const hs = Array.isArray(it.highlights) ? it.highlights : [];
  const n = typeof cfg.bullets === 'number' ? cfg.bullets : hs.length;
  return hs.slice(0, n).filter(Boolean);
}

/** 把一条数据渲染成分区内容（若干段落）。 */
function renderItem(R, sectionId, it, cfg, template, inlineLabels) {
  const sep = template.dateSeparator || ' – ';
  const out = [];

  switch (sectionId) {
    case 'education': {
      const right = dateRange(it, sep);
      const sub = [it.area, it.studyType].filter(Boolean).join(template.studyTypeSeparator === undefined ? ' ' : template.studyTypeSeparator);
      out.push(R.entryLine(it.institution + (sub ? ' ｜ ' + sub : ''), right));
      for (const h of takeBullets(it, cfg)) out.push(R.bullet(h));
      break;
    }
    case 'work':
    case 'research': {
      out.push(R.entryLine(it.position || '', dateRange(it, sep), it.name));
      if (it.summary) out.push(R.bullet(it.summary));
      for (const h of takeBullets(it, cfg)) out.push(R.bullet(h));
      break;
    }
    case 'projects': {
      out.push(R.entryLine(it.name || '', dateRange(it, sep), it.description));
      if (it.summary) out.push(R.bullet(it.summary));
      for (const h of takeBullets(it, cfg)) out.push(R.bullet(h));
      break;
    }
    case 'awards': {
      const tail = [it.awarder, it.date].filter(Boolean).join('，');
      // 条目自带小标签时优先用它，这样「资质／学科／竞赛」能各占一行
      const label = it.label || inlineLabels.awards || '荣誉';
      out.push(R.inlineRow(label, it.title + (tail ? `（${tail}）` : '')));
      break;
    }
    case 'certificates': {
      const parts = [it.cn && it.cn.subject, it.credentialId, it.date].filter(Boolean);
      out.push(R.inlineRow(it.label || inlineLabels.certificates || '证书', it.name + (parts.length ? ' ｜ ' + parts.join(' ｜ ') : '')));
      break;
    }
    case 'publications': {
      const label = it.label !== undefined ? it.label : inlineLabels.publications;
      out.push(R.inlineRow(label || '', it.name + (it.publisher ? `（${it.publisher}）` : '')));
      break;
    }
    case 'skills': {
      const text = it.summary || (it.keywords || []).join('、');
      out.push(R.inlineRow(it.name, text));
      break;
    }
    case 'languages': {
      out.push(R.inlineRow(it.language, it.fluency || ''));
      break;
    }
    default:
      break;
  }
  return out;
}

function buildHeader(R, { data, variant, template, dataDir }) {
  const b = data.basics || {};
  const cn = b.cn || {};
  const C = template.colors;
  const T = template.typography;

  const metaParts = [];
  if (cn.gender) metaParts.push(cn.gender);
  if (cn.ethnicity) metaParts.push(cn.ethnicity);
  if (cn.birthDate) metaParts.push(formatBirth(cn.birthDate));
  if (cn.headline) metaParts.push(cn.headline);

  const contactParts = [];
  if (b.phone) contactParts.push(b.phone);
  if (b.email) contactParts.push(b.email);
  if (b.url) contactParts.push(b.url);

  const LH = template.lineHeightPt || {};
  const HS = (template.spacing && template.spacing.header) || {};
  const left = [
    new Paragraph({
      spacing: makeSpacing(template, 0, HS.nameAfter === undefined ? 40 : HS.nameAfter, HS.nameLine, LH.name || 26),
      children: [R.run(b.name || '', { bold: true, size: T.name, color: C.primary })],
    }),
    new Paragraph({
      spacing: makeSpacing(template, 0, HS.labelAfter === undefined ? 60 : HS.labelAfter, HS.labelLine, LH.label || 17),
      children: [
        R.run('求职意向：', { bold: true, size: T.label }),
        R.run(variant.label || b.label || '', { bold: true, size: T.label, color: C.primary }),
      ],
    }),
    new Paragraph({
      spacing: makeSpacing(template, 0, HS.metaAfter === undefined ? 30 : HS.metaAfter, HS.metaLine, LH.small || 15),
      children: [R.run(metaParts.join('　｜　'), { size: T.small, color: C.muted })],
    }),
    new Paragraph({
      spacing: makeSpacing(template, 0, 0, HS.metaLine, LH.small || 15),
      children: [R.run(contactParts.join('　｜　'), { size: T.small, color: C.muted })],
    }),
  ];

  const photoCell = template.geometry.photo.cellWidthTwip || 1500;

  const cells = [
    new TableCell({
      width: { size: template.geometry.contentWidthTwip - photoCell, type: WidthType.DXA },
      borders: noBorders(),
      margins: { top: 0, bottom: 0, left: 0, right: 120 },
      verticalAlign: VerticalAlign.CENTER,
      children: left,
    }),
  ];

  if (variant.photo !== false && b.image) {
    const imgPath = path.isAbsolute(b.image) ? b.image : path.join(dataDir, b.image);
    if (fs.existsSync(imgPath)) {
      cells.push(
        new TableCell({
          width: { size: photoCell, type: WidthType.DXA },
          borders: noBorders(),
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
              children: [
                new ImageRun({
                  type: imgPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg',
                  data: fs.readFileSync(imgPath),
                  transformation: {
                    width: template.geometry.photo.widthPx,
                    height: template.geometry.photo.heightPx,
                  },
                  altText: { title: '证件照', description: b.name || '', name: 'photo' },
                }),
              ],
            }),
          ],
        })
      );
    }
  }

  return new Table({
    width: { size: template.geometry.contentWidthTwip, type: WidthType.DXA },
    // 列宽必须显式给出，缺省会让左栏按内容自适应，正文因此折行、页首变高
    columnWidths: [template.geometry.contentWidthTwip - photoCell, photoCell],
    borders: noBorders(),
    rows: [new TableRow({ children: cells })],
  });
}

function noBorders() {
  const n = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: n, bottom: n, left: n, right: n };
}

/** 把 YYYY-MM 写成「2000 年 1 月生」。数字与量词之间留半角空格，符合 GB/T 15835。 */
function formatBirth(v) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(v));
  if (m) return `${m[1]} 年 ${parseInt(m[2], 10)} 月生`;
  return String(v) + ' 生';
}

function buildFooter(runs, template, { name, label }) {
  const C = template.colors;
  const T = template.typography;
  const { FONT } = runs;
  const head = [name, label ? '应聘：' + label : ''].filter(Boolean).join('　｜　');
  const txt = (s) => new TextRun({ text: s, font: FONT, size: halfPt(T.footer), color: C.muted });
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 6 } },
        children: [
          txt(head ? head + '　｜　第 ' : '第 '),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: halfPt(T.footer), color: C.muted }),
          txt(' 页 / 共 '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: halfPt(T.footer), color: C.muted }),
          txt(' 页'),
        ],
      }),
    ],
  });
}

async function render({ data, variant, template, dataDir, outFile }) {
  const R = makeRuns(template);
  const titles = Object.assign({}, template.sectionTitles);
  const inlineLabels = Object.assign({}, template.inlineLabels);
  const sep = template.dateSeparator || ' – ';

  const body = [buildHeader(R, { data, variant, template, dataDir })];

  // 页首细线
  const ruleCfg = (template.spacing && template.spacing.rule) || {};
  body.push(
    new Paragraph({
      spacing: { before: ruleCfg.before === undefined ? 40 : ruleCfg.before, after: ruleCfg.after === undefined ? 160 : ruleCfg.after },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: template.colors.primary, space: 1 } },
      children: [R.run('', { size: 4 })],
    })
  );

  for (const cfg of variant.content) {
    const list = pickItems(data[cfg.section], cfg);
    if (!list.length) continue;
    body.push(R.sectionBar(cfg.title || titles[cfg.section] || cfg.section));
    for (const it of list) {
      for (const p of renderItem(R, cfg.section, it, cfg, template, inlineLabels)) body.push(p);
    }
  }

  // 个人陈述：只在变体声明时出现，且按门禁要求必须在最后。
  if (variant.statement && variant.statement.text) {
    body.push(R.sectionBar(variant.statement.title || '补充说明'));
    body.push(R.para(variant.statement.text));
  }

  const doc = new Document({
    creator: data.basics.name || '',
    title: `${data.basics.name || ''} · ${variant.label || ''}`,
    description: '由 resume-cn 生成',
    styles: {
      default: { document: { run: { font: R.FONT, size: halfPt(template.typography.body), color: template.colors.ink } } },
    },
    numbering: {
      config: [
        {
          reference: 'dot',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 280, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: twip(template.page.margins.topPt),
              right: twip(template.page.margins.rightPt),
              bottom: twip(template.page.margins.bottomPt),
              left: twip(template.page.margins.leftPt),
            },
          },
        },
        footers: { default: buildFooter(R, template, { name: data.basics.name, label: variant.label || data.basics.label }) },
        children: body,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  const plainText = R.records.filter((s) => s && s.trim()).join('\n');
  return { outFile, bytes: buf.length, plainText };
}

module.exports = { render };
