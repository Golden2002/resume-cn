#!/usr/bin/env node
/**
 * 文档语言审计：把简历用的那套规则用到 README 与 docs 上。
 *
 * 为什么要这一步：项目对别人的简历要求「16 条规则 0 违例」，
 * 自己的说明文档却满篇直角引号与万能动词，就没有说服力。
 * 这个脚本让文档和产物走同一套判据。
 *
 * 审计前会剥掉代码块、行内代码、链接地址与 HTML 标签，只审真正给人读的正文。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { check, RULES } = require('../src/gates/language');

const ROOT = path.resolve(__dirname, '..');

function collect(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === 'fonts') continue;
    const p = path.join(dir, e.name);
    // reference 下收录的是第三方原文，不改写，也不参与本项目的语言审计
    if (e.isDirectory() && p.endsWith(path.join('skills', 'chinese-writing', 'reference'))) continue;
    if (e.isDirectory()) collect(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/** 保留行结构，把不该审的内容换成空行，便于报行号 */
function strip(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inFence = false;
  let inIgnore = false;
  for (const line of lines) {
    // 声明豁免区：规则表必须写出被禁的词，那几行不该被自己判违规
    if (/<!--\s*audit:ignore-start\s*-->/.test(line)) {
      inIgnore = true;
      out.push('');
      continue;
    }
    if (/<!--\s*audit:ignore-end\s*-->/.test(line)) {
      inIgnore = false;
      out.push('');
      continue;
    }
    if (inIgnore) {
      out.push('');
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    if (inFence) {
      out.push('');
      continue;
    }
    let s = line;
    s = s.replace(/`[^`]*`/g, '');                    // 行内代码
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');       // 图片
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');    // 链接保留文字
    s = s.replace(/<[^>]+>/g, '');                    // HTML 与徽章
    s = s.replace(/https?:\/\/\S+/g, '');             // 裸地址
    out.push(s);
  }
  return out;
}

const files = [path.join(ROOT, 'README.md')]
  .concat(fs.existsSync(path.join(ROOT, 'docs')) ? collect(path.join(ROOT, 'docs')) : [])
  .concat(fs.existsSync(path.join(ROOT, 'skills')) ? collect(path.join(ROOT, 'skills')) : [])
  .filter((f) => fs.existsSync(f));

let total = 0;
for (const f of files) {
  const lines = strip(fs.readFileSync(f, 'utf8'));
  const hits = [];
  lines.forEach((line, i) => {
    for (const h of check(line)) hits.push(Object.assign({ line: i + 1 }, h));
  });
  const rel = path.relative(ROOT, f);
  if (!hits.length) {
    console.log(`✓ ${rel}`);
    continue;
  }
  total += hits.length;
  console.log(`✗ ${rel}  ${hits.length} 处`);
  const byRule = {};
  for (const h of hits) (byRule[h.rule] = byRule[h.rule] || []).push(h);
  for (const [rule, list] of Object.entries(byRule)) {
    console.log(`  [${rule} ${list[0].clause}] ${list.length} 处　${list[0].hint}`);
    for (const h of list.slice(0, 4)) {
      console.log(`      L${h.line}  ${h.matched}  …${h.context.slice(0, 40)}…`);
    }
    if (list.length > 4) console.log(`      还有 ${list.length - 4} 处`);
  }
}

console.log('');
if (total) {
  console.log(`文档语言审计：${total} 处违例（规则集 ${RULES.length} 条）`);
  process.exit(1);
}
console.log(`文档语言审计：0 违例（规则集 ${RULES.length} 条）`);
