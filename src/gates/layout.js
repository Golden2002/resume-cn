/**
 * 体例门禁：判这份简历在「体例」上是否合规。
 *
 * 每一条都对应一次真实踩过的坑，不是凭空设的门。
 * 判定全部基于渲染结果（页数、文本），不依赖作者自述。
 */
'use strict';

const { findChineseIds } = require('./idcheck');

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** 页数与分区 */
function layoutGate({ pageCount, pageBudget, sectionsFound, variant, text }) {
  const problems = [];
  const expectedTitles = variant.content.map((c) => c.title).filter(Boolean);

  if (typeof pageCount === 'number' && pageBudget) {
    if (pageCount > pageBudget) {
      problems.push({
        rule: 'L1',
        clause: '页数预算',
        detail: `实际 ${pageCount} 页，预算 ${pageBudget} 页。压缩方式：调小某分区的 bullets，或把短条目改成 inline。`,
      });
    }
    if (pageCount < pageBudget) {
      problems.push({
        rule: 'L2',
        clause: '页数预算',
        detail: `实际 ${pageCount} 页，预算 ${pageBudget} 页。不必凑页数，把预算改成 ${pageCount} 即可。`,
        severity: 'note',
      });
    }
  }

  for (const t of expectedTitles) {
    if (!text.includes(t)) {
      problems.push({ rule: 'L3', clause: '分区齐全', detail: `变体声明了分区「${t}」，但渲染结果里找不到该标题。` });
    }
  }

  // 个人陈述必须最后
  if (variant.statement && variant.statement.text) {
    const st = variant.statement.title || '补充说明';
    const idx = text.indexOf(st);
    if (idx >= 0) {
      const tail = text.slice(idx);
      for (const t of expectedTitles) {
        if (t !== st && tail.includes(t)) {
          problems.push({
            rule: 'L4',
            clause: '陈述位置',
            detail: `个人陈述必须放在最后，但「${t}」出现在它之后。`,
          });
          break;
        }
      }
    }
    const len = variant.statement.text.length;
    const cap = variant.statement.maxChars || 300;
    if (len > cap) {
      problems.push({
        rule: 'L5',
        clause: '陈述长度',
        detail: `个人陈述 ${len} 字，超过上限 ${cap} 字。`,
      });
    }
  }

  // 机构名串味：把 A 校的定制句投给 B 校，是这类工具最容易制造的错
  if (Array.isArray(variant.forbidEntities)) {
    for (const name of variant.forbidEntities) {
      if (name && text.includes(name)) {
        problems.push({
          rule: 'L6',
          clause: '机构名越界',
          detail: `正文出现了本变体禁用的机构名「${name}」。`,
        });
      }
    }
  }

  // 完整身份证号不得出现。用 GB 11643 的校验位判定，避免把长编号误判成身份证号。
  const realIds = findChineseIds(text);
  if (realIds.length) {
    problems.push({
      rule: 'L7',
      clause: '隐私',
      detail: `出现校验位成立的身份证号（${realIds[0].slice(0, 6)}…），共 ${realIds.length} 处。简历不应含身份证号。`,
    });
  }

  return problems;
}

module.exports = { layoutGate };
