/**
 * 语言门禁：判文本是否符合中文排版规范与行文规范。
 *
 * 每条规则都挂条款依据，不写「我们觉得」。依据分三类：
 *   GB/T 15834—2011《标点符号用法》
 *   GB/T 15835—2011《出版物上数字用法》
 *   W3C《中文排版需求》clreq（中西文混排、引号、连接号）
 *   余光中《中文的常态与变态》（行文病症）
 *   去 AI 腔清单（钩子句、第一人称情绪、伪发现、叙事铺垫）
 */
'use strict';

const CJK = '\\u4e00-\\u9fff';

const RULES = [
  {
    id: 'P1',
    clause: 'GB/T 15834—2011 4.1 中文句内用全角标点',
    re: new RegExp(`[${CJK}][,;:.]`, 'g'),
    hint: '中文句子里用了半角逗号、分号、冒号或句号',
  },
  {
    id: 'P2',
    clause: 'GB/T 15834—2011',
    re: new RegExp(`[,;:][${CJK}]`, 'g'),
    hint: '半角标点后紧跟中文',
  },
  {
    id: 'P3',
    clause: 'GB/T 15834—2011 破折号占两个字位，前后不加空格',
    re: / ——|—— /g,
    hint: '破折号前后有空格',
  },
  {
    id: 'P4',
    clause: 'W3C clreq 引号；本项目统一用弯引号',
    re: /[「」『』]/g,
    hint: '使用了直角引号，应改为弯引号',
  },
  {
    id: 'M1',
    clause: 'W3C clreq 中西文混排，本项目统一加半角空格',
    re: new RegExp(`([${CJK}][A-Za-z0-9])|([A-Za-z0-9][${CJK}])`, 'g'),
    hint: '中文与西文或数字之间缺半角空格',
  },
  {
    id: 'N1',
    clause: 'GB/T 15835—2011 数字与单位之间',
    re: /\d(天|分|个|次|页|周|种|年|名|月|元|人|条|届)/g,
    hint: '数字与量词之间缺半角空格',
  },
  {
    id: 'Z1',
    clause: '余光中《中文的常态与变态》拆散单音节动词',
    re: /进行|作出|予以/g,
    hint: '万能动词，应改用单音节动词',
  },
  {
    id: 'Z2',
    clause: '余光中《中文的常态与变态》第九条',
    re: /人们/g,
    hint: '「人们」应改为「大家」或直接去掉主语',
  },
  {
    id: 'Z3',
    clause: '余光中《中文的常态与变态》第三条',
    re: /之一/g,
    hint: '「之一」式表述',
  },
  {
    id: 'Z4',
    clause: '本项目词法要求：避免单字成词',
    // 只抓副词性的「另」，不误伤「另一」「另加」这类正常搭配
    re: /均|另外|另附|另设|另需|另行/g,
    hint: '单字词或副词性「另」，改为「都」「其他」等',
  },
  {
    id: 'Z8',
    clause: '语域要求：正式文本不用口语',
    // 「怎么设」这类口语缩写要写成「怎样设置」。口语词进正式文本，语域就塌了
    re: /怎么|咋|啥|搞定|弄好|搞好|其实|挺(?:好|棒|不错)/g,
    hint: '口语化表达，改写为书面语（怎么改成怎样或如何，搞定改成完成，其实删掉或换成具体说明）',
  },
  {
    id: 'A1',
    clause: '去 AI 腔清单：空洞评价',
    re: /至关重要|发挥着|具有重要意义|起到.{0,4}作用/g,
    hint: '空洞评价，应写出具体作用',
  },
  {
    id: 'A2',
    clause: '去 AI 腔清单：连接词起句',
    re: /[。；]\s*此外/g,
    hint: '「此外」起句',
  },
  {
    id: 'A3',
    clause: '去 AI 腔清单：钩子句',
    re: /让我停下来|遇到过一个|曾经有一个|还有一个问题一直/g,
    hint: '制造悬念的钩子句，中文自述不这样起句',
  },
  {
    id: 'A4',
    clause: '去 AI 腔清单：第一人称情绪',
    re: /想不通|不禁|感慨|触动|震撼|说实话/g,
    hint: '第一人称情绪自白',
  },
  {
    id: 'A5',
    clause: '去 AI 腔清单：伪发现',
    re: /让我(具体)?(看到|意识到|明白)|我(逐渐)?意识到/g,
    hint: '「让我看到／我意识到」式伪发现句',
  },
  {
    id: 'A6',
    clause: '去 AI 腔清单：叙事铺垫',
    re: /还有一件事|另一方面我也想|说来|回想起来|直到有一天/g,
    hint: '叙事铺垫连接词',
  },
];

function check(text) {
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const s = Math.max(0, m.index - 16);
      const e = Math.min(text.length, m.index + m[0].length + 16);
      hits.push({
        rule: rule.id,
        clause: rule.clause,
        hint: rule.hint,
        matched: m[0],
        context: text.slice(s, e).replace(/\s+/g, ' '),
      });
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }
  return hits;
}

module.exports = { check, RULES };
