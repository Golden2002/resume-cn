/**
 * 身份证号识别，供体例门禁与隐私扫描共用。
 *
 * 只做格式与校验位判断，不判真实性。依据 GB 11643 的加权模 11 校验加出生日期合理性，
 * 目的是把「18 位长编号」与「身份证号」区分开，避免把证书编号误判成身份证号。
 */
'use strict';

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3'];

function looksLikeChineseId(s) {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(s[i], 10) * WEIGHTS[i];
  if (CHECK_CODES[sum % 11] !== s[17].toUpperCase()) return false;
  const y = parseInt(s.slice(6, 10), 10);
  const mo = parseInt(s.slice(10, 12), 10);
  const d = parseInt(s.slice(12, 14), 10);
  return !(y < 1900 || y > 2020 || mo < 1 || mo > 12 || d < 1 || d > 31);
}

/** 从文本里挑出校验位成立的身份证号 */
function findChineseIds(text) {
  const all = String(text || '').match(/\d{17}[\dXx]/g) || [];
  return all.filter(looksLikeChineseId);
}

module.exports = { looksLikeChineseId, findChineseIds };
