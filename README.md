# resume-cn

中文简历生成与检查工具。读一份个人信息和一份岗位配置，输出 Word 与 PDF，生成时检查体例、语言、字体和隐私。

![license](https://img.shields.io/badge/license-MIT-9D2235) ![node](https://img.shields.io/badge/node-%E2%89%A5%2018-43853d)

![预览](docs/assets/preview.png)

## 功能

- 一份信息，多份简历。岗位配置决定取哪些条目、按什么次序排、页数上限。
- 内容与版式分离。字号、行距、页边距在模板文件里，数据文件不含版式。
- 生成时检查。体例七项、语言十七项、产物四项，任一项不通过即中止，退出码为 1。
- 两种导出引擎。LibreOffice 与 Microsoft Word，读取同一份 DOCX。

## 环境要求

- Node.js 18 或更高
- 转 PDF 需要下面任一条件：LibreOffice（`soffice` 在 PATH 里）、Microsoft Word（仅 Windows）、自定义转换命令

## 安装

```bash
git clone https://github.com/Golden2002/resume-cn.git
cd resume-cn
npm install
```

## 快速开始

```bash
node src/cli.js new my-resume
node src/cli.js check --data my-resume --variant teacher-biology
```

`check` 渲染简历并运行全部检查。通过时输出：

```
✓ schema 校验通过
✓ DOCX  .../张三-teacher-biology.docx （104 KB，143 ms）
✓ PDF   .../张三-teacher-biology.pdf
✓ 体例门禁（3 页，判据：PyMuPDF）
✓ 语言门禁（17 条规则，0 违例）
✓ 字体嵌入（8 个字体描述符，都带嵌入流）
✓ 声明字体（PDF 内匹配到 微软雅黑）
✓ ATS 往返（单源校验：pymupdf）
✓ 隐私门禁（仓库内未发现完整身份证号）

全部通过
```

产物默认写到 `out/<数据目录>-<变体名>/`，可用 `--out` 指定。

## 数据格式

`data/<目录>/resume.yaml`，字段名沿用 [JSON Resume](https://jsonresume.org)，中文场景的字段放在 `cn` 下。

```yaml
basics:
  name: 张三
  label: 中学生物教师
  phone: "130-0000-0000"
  image: photo.jpg
  cn:
    gender: 男
    birthDate: "2000-01"
    headline: 复旦大学生命科学学院 · 生物学硕士（在读）

education:
  - id: edu-ms
    institution: 复旦大学
    area: 生命科学学院
    studyType: 生物学硕士（在读）
    startDate: "2024.09"
    endDate: "2027.06（预计）"
    highlights:
      - 我在 2024 年全国硕士研究生招生考试中取得 433 分，生物学专业课成绩位列复旦大学第一名。
```

三条约定：

- **日期与编号一律加引号。** YAML 会把 `2024.09` 解析成数字，18 位证书编号会丢精度。工具对数字做兜底转换并给出提示；超出安全整数范围的编号直接报错。
- `evidence` 段记录字段溯源，写入证书文件名与核对日期，不进入简历正文。
- schema 不接收身份证号。需要证明身份时，用 `evidence` 指向扫描件。

## 岗位配置

`data/<目录>/variants/<名称>.yaml`。取哪些条目、排什么次序、放几页，写在这一层。

```yaml
template: fudan-red
label: 初中生物教师
pageBudget: 2
photo: true

content:
  - section: education
    title: 教育背景
  - section: work
    title: 教学与实践经历
    ids: [w-competition, w-bilingual, w-igem, w-ta]
    bullets: 2
  - section: awards
    title: 荣誉与资质

forbidEntities:
  - 某民办中学
```

| 字段 | 作用 |
|---|---|
| `template` | 模板目录名 |
| `label` | 求职意向，覆盖数据文件里的值 |
| `pageBudget` | 页数上限，超出即报错 |
| `photo` | 是否放证件照 |
| `content[].section` | 分区名，可选 education、work、research、projects、awards、certificates、publications、skills、languages |
| `content[].ids` | 按给定次序取这些条目 |
| `content[].tags` | 按标签筛选 |
| `content[].bullets` | 每条目最多取几条 highlights |
| `content[].maxItems` | 分区最多取几条 |
| `statement` | 个人陈述。默认不启用；启用后强制放在末尾，字数上限默认 300 |
| `forbidEntities` | 正文不得出现的机构名 |

## 命令行

| 命令 | 作用 |
|---|---|
| `new <目录>` | 用示例数据建数据目录 |
| `build --data <目录> --variant <名>` | 渲染 DOCX 与 PDF |
| `check --data <目录> --variant <名>` | 渲染并运行全部检查 |
| `fonts status --family <族名>` | 报告字体是否已装 |
| `fonts install --to-user` | 下载思源黑体并装进当前用户字体目录 |
| `fonts define --family <族名> --regular <文件>` | 登记自备字体 |

通用参数：`--font <族名>` 覆盖模板字体，`--pdf-engine <word|libreoffice>` 指定导出引擎，`--pdf-cmd <命令>` 指定自定义转换命令，`--out <目录>` 指定产物位置，`--no-pdf` 只出 DOCX。

## 检查项

### 体例

| 编号 | 检查 | 判据 |
|---|---|---|
| L1 L2 | 页数与预算 | PDF 实际页数 |
| L3 | 分区齐全 | 变体声明的分区标题出现在正文 |
| L4 | 陈述位置 | 个人陈述之后没有其他分区 |
| L5 | 陈述长度 | 不超过 `maxChars` |
| L6 | 机构名越界 | `forbidEntities` 里的名字未出现 |
| L7 | 身份证号 | GB 11643 校验位加出生日期判断 |

### 语言

十七项，每项带条款号。

| 依据 | 内容 |
|---|---|
| GB/T 15834—2011 | 中文句内全角标点、破折号、引号 |
| GB/T 15835—2011 | 数字与量词之间的空格 |
| W3C《中文排版需求》 | 中文与西文之间的空格 |
| 余光中《中文的常态与变态》 | 拆散单音节动词、虚指主语、赘余的最高级说法、单字成词 |
| 语域 | 正式文本不用口语词 |
| 去 AI 腔 | 空心评价、连接词起句、钩子句、情绪自白、伪发现、叙事铺垫 |

规则集在 [skills/chinese-writing](skills/chinese-writing/SKILL.md)，可脱离本项目单独引用。

### 产物

| 检查 | 判据 |
|---|---|
| 字体嵌入 | 每个字体描述符都带嵌入流 |
| 声明字体生效 | PDF 的 BaseFont 含模板声明的字体族 |
| 文本可抽取 | 两个以上抽取器交叉比对；只有一个时做单源校验 |
| 仓库无隐私 | 全仓库扫描，查找校验位成立的身份证号 |

## 排版

数值写在 `templates/fudan-red/template.yaml`，来源是定稿的生成脚本。

| 层级 | 元素 | 字号 | 字重 |
|---|---|---|---|
| 焦点 | 姓名 | 20 pt | 加粗 |
| 引导 | 求职意向、分区标题 | 11 pt | 加粗 |
| 信息 | 条目主行、正文 | 10 pt | 主行加粗 |
| 辅助 | 日期、单位、联系方式 | 9.5 pt | 常规 |
| 页脚 | 页码 | 8 pt | 常规 |

页边距上下 41 pt，左右 54 pt。分区标题条高 20.4 pt，白字在条内垂直居中，左右各留 5 pt。条用单元格实现，段落的底色随行高变化，做不到垂直居中。

加粗只用于姓名、分区标题、条目主标题。灰色单位名里需要点出机构时，在数据里写双星号：

```yaml
name: "**山东省烟台第一中学** · 生物竞赛暑期培训"
```

## 字体

仓库不含字体文件，模板默认写微软雅黑。换字体有两种方式：

```bash
# 下载思源黑体（SIL OFL 1.1）并装进当前用户字体目录
node src/cli.js fonts install --to-user
node src/cli.js check --data my-resume --variant teacher-biology --font "Source Han Sans SC"

# 登记自备字体
node src/cli.js fonts define --family "我的字体" --regular D:\fonts\r.ttf
node src/cli.js check --data my-resume --variant teacher-biology --font "我的字体"
```

行高在 `lineHeightPt` 里写成固定值，换字体不影响分页。把微软雅黑换成思源黑体，页数不变。

## 导出 PDF

```bash
node src/cli.js check --data my-resume --variant teacher-biology --pdf-engine libreoffice
node src/cli.js check --data my-resume --variant teacher-biology --pdf-engine word
```

Word 引擎通过 COM 调用 `tools/convert-word.ps1`，仅在 Windows 可用。两个引擎对段落底色的处理不同：Word 铺底色时忽略左右缩进，LibreOffice 按缩进收窄。模板把缩进设为 0，另用单元格边距留白，两边结果一致。

## 已知限制

- 检查判合规，不判版面美观。
- 文本能被机器读出，不保证通过招聘方筛选。
- 文本抽取的质量取决于已安装的抽取器。只有一路时降级为单源校验，报告中注明。
- 分页以选定的引擎为准，同一份 DOCX 在两个引擎下可能分到不同页。
- 身份证校验位只判格式，不验证号码真实存在。
- Word 引擎走 COM，需要交互式桌面。在服务、计划任务、CI 等无桌面环境里可能启动失败，此时改用 LibreOffice。

## 相关项目

- [RenderCV](https://github.com/rendercv/rendercv)：内容用 YAML 写，版式交给模板。
- [JSON Resume](https://jsonresume.org)：字段名取自它的 schema。
- [paeg-teaching-language-skill](https://github.com/Golden2002/paeg-teaching-language-skill)：`skills/chinese-writing/reference/` 下三份文档的来源。

## 许可

代码 MIT。

字体不随仓库分发。`fonts install` 从 Adobe 官方仓库下载思源黑体（SIL OFL 1.1），打印 SHA256，装到当前用户的字体目录。商业字体请在自有授权范围内使用，不要提交进公开仓库。
