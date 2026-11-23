/**
 * 冒烟测试：证明这套东西真的能跑，且门禁真的会拦。
 * 正向：示例数据应通过；负向：故意注入违规文本，门禁必须报错。
 *
 * 只跑 node test/smoke.js 即可，不依赖测试框架。
 */
'use strict';

const assert = require('assert');
const path = require('path');
const languageGate = require('../src/gates/language');
const layoutGate = require('../src/gates/layout').layoutGate;
const artifactGate = require('../src/gates/artifact');

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('    ' + e.message);
  }
}

console.log('语言门禁');

t('合规文本 0 违例', () => {
  const text = '我在复旦大学攻读硕士学位，方向为群体遗传学。\n我独立完成八课时的课堂教学。';
  assert.deepStrictEqual(languageGate.check(text), []);
});

t('半角标点被拦下', () => {
  const hits = languageGate.check('我完成了课堂教学,并且整理了讲义.');
  assert.ok(hits.some((h) => h.rule === 'P1'), '应命中 P1');
});

t('直角引号被拦下', () => {
  const hits = languageGate.check('我设计了「校园生物多样性」课程。');
  assert.ok(hits.some((h) => h.rule === 'P4'), '应命中 P4');
});

t('万能动词被拦下', () => {
  const hits = languageGate.check('我进行了课堂教学。');
  assert.ok(hits.some((h) => h.rule === 'Z1'), '应命中 Z1');
});

t('中英之间缺空格被拦下', () => {
  const hits = languageGate.check('我使用Python完成分析。');
  assert.ok(hits.some((h) => h.rule === 'M1'), '应命中 M1');
});

t('第一人称情绪被拦下', () => {
  const hits = languageGate.check('我也想不通这件事。');
  assert.ok(hits.some((h) => h.rule === 'A4'), '应命中 A4');
});

console.log('体例门禁');

const baseVariant = {
  content: [{ section: 'education', title: '教育背景' }],
  pageBudget: 2,
  forbidEntities: ['某某实验学校'],
};

t('页数超预算被拦下', () => {
  const p = layoutGate({ pageCount: 3, pageBudget: 2, variant: baseVariant, text: '教育背景' });
  assert.ok(p.some((x) => x.rule === 'L1'), '应命中 L1');
});

t('机构名越界被拦下', () => {
  const p = layoutGate({ pageCount: 2, pageBudget: 2, variant: baseVariant, text: '教育背景\n某某实验学校' });
  assert.ok(p.some((x) => x.rule === 'L6'), '应命中 L6');
});

// 测试用的身份证号由片段拼成，避免把 18 位字面量写进源码（隐私门禁会拦）。
const FAKE_ID = '110101' + '19900101' + '001' + '5';

t('完整身份证号被拦下', () => {
  const p = layoutGate({ pageCount: 2, pageBudget: 2, variant: baseVariant, text: '教育背景\n' + FAKE_ID });
  assert.ok(p.some((x) => x.rule === 'L7'), '应命中 L7');
});

t('长编号不误判为身份证号', () => {
  const p = layoutGate({ pageCount: 2, pageBudget: 2, variant: baseVariant, text: '教育背景\n202600000000000001' });
  assert.ok(!p.some((x) => x.rule === 'L7'), '长编号不应命中 L7');
});

t('陈述超长被拦下', () => {
  const v = Object.assign({}, baseVariant, {
    statement: { title: '补充说明', text: '很'.repeat(320), maxChars: 300 },
  });
  const p = layoutGate({ pageCount: 2, pageBudget: 2, variant: v, text: '教育背景\n补充说明' });
  assert.ok(p.some((x) => x.rule === 'L5'), '应命中 L5');
});

t('陈述不在末尾被拦下', () => {
  const v = Object.assign({}, baseVariant, {
    content: [{ section: 'education', title: '教育背景' }, { section: 'work', title: '实践经历' }],
    statement: { title: '补充说明', text: '简短说明。', maxChars: 300 },
  });
  const p = layoutGate({ pageCount: 2, pageBudget: 2, variant: v, text: '教育背景\n补充说明\n实践经历' });
  assert.ok(p.some((x) => x.rule === 'L4'), '应命中 L4');
});

console.log('产物门禁');

t('文本归一化处理空白与间隔号', () => {
  assert.strictEqual(artifactGate.normalize('张三 · 男\n学 历'), '张三男学历');
});

t('抽取器缺失时如实报告而不假装通过', () => {
  const r = artifactGate.atsRoundTrip(path.join(__dirname, '..', 'package.json'));
  assert.ok(r.skipped === true || r.ok === false, '非 PDF 输入不应返回 ok');
});

console.log('');
console.log(`${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
