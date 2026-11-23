/**
 * 字体门禁的单元测试：族名到 PDF PostScript 名的映射。
 *
 * 这张表是必需的：PDF 的 BaseFont 只有拉丁名，中文字体族名在里面是 MicrosoftYaHei。
 * 少了它，字体门禁会把「雅黑确实用上了」误判成失败。
 */
'use strict';

const assert = require('assert');
const { latinTokens, FAMILY_ALIASES, isInstalledOnSystem } = require('../src/fonts');

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

console.log('字体族名映射');

t('微软雅黑 映射到 MicrosoftYaHei', () => {
  const toks = latinTokens('微软雅黑');
  assert.ok(toks.includes('microsoftyahei'), '实际：' + toks.join(','));
});

t('思源黑体 映射到 SourceHanSans', () => {
  assert.ok(latinTokens('思源黑体').includes('sourcehansans'));
});

t('Source Han Sans SC 映射保留 SC 与通用名', () => {
  const toks = latinTokens('Source Han Sans SC');
  assert.ok(toks.includes('sourcehansanssc'));
  assert.ok(toks.includes('sourcehansans'));
});

t('未登记的名字退化为去分隔符的小写串', () => {
  assert.deepStrictEqual(latinTokens('My Fancy Font'), ['myfancyfont']);
});

t('纯中文的未知字体名不产出空 token 以外的垃圾', () => {
  assert.deepStrictEqual(latinTokens('某个没登记的字体'), []);
});

t('别名表覆盖常见中文字体', () => {
  for (const fam of ['微软雅黑', '宋体', '黑体', '楷体', '思源黑体']) {
    assert.ok(FAMILY_ALIASES[fam] && FAMILY_ALIASES[fam].length, fam + ' 缺少别名');
  }
});

t('系统字体探测返回布尔值而非抛错', () => {
  assert.strictEqual(typeof isInstalledOnSystem('微软雅黑'), 'boolean');
});

console.log('');
console.log(`${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
