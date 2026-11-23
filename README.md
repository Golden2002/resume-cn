# resume-cn

用数据驱动中文简历，并对**体例、语言、产物**做可机器判定的门禁。

不是简历生成器。生成器遍地都是（[RenderCV](https://github.com/rendercv/rendercv)、[JSON Resume](https://jsonresume.org/media) 都已成熟）。这个项目只做一件它们不做的事：**让中文简历能被判定对错**。

---

## 它解决什么

中文简历有几类错误，人工做十份就可能犯一次，犯了还看不出来：

| 失效模式 | 后果 | 本项目的对策 |
|---|---|---|
| 加分项一加，两页变三页 | 排版承诺破了，投递时才发现 | 页数预算写进变体，超出即报错并提示压缩哪一条 |
| 上一版为 A 校定制的句子投给 B 校 | 一眼看出是套模板 | `forbidEntities` 声明禁用机构名，命中即失败 |
| 转换 PDF 的机器没装模板字体 | 字体被静默替换，字面宽度与版式全变，页数也从 1 变 2 | 比对 PDF 内 `BaseFont`，不是只看「有没有嵌入」 |
| 文件名要「学科+姓名+学历+毕业院校」 | 没按规定命名，直接被筛 | 文件名由变体与公告要求决定，人工不用记 |
| 中文 Windows 上 Python 输出 GBK | 文本抽取中途崩溃，ATS 检查形同虚设 | 抽取器统一强制 UTF-8，并在报告里标出用了几路 |
| 把真实身份证号写进公开仓库 | 无法撤回 | 隐私门禁按 GB 11643 校验位判身份证号，CI 拦截 |

---

## 四条设计原则

**一、四层分离。** 数据、模板、内容选用、渲染流程互不认识：

```
data/        私有，gitignore。事实字段（每条可追到证书扫描件）+ 岗位变体
templates/   公开。复旦红模板：颜色、字号、间距、页边距全在 template.yaml 里
policy/      公开。内容选用写在变体里，不写进数据也不写进模板
src/         公开。渲染与门禁
```

**二、门禁挂条款号。** 语言规则不写「我们觉得」，写 GB/T 15834—2011、GB/T 15835—2011、W3C《中文排版需求》、余光中《中文的常态与变态》的具体条。

**三、不自证。** 字体是否真被用上，读 PDF 结构判断，不信转换器的口头报告；ATS 是否可解析，用独立抽取器交叉比对，不信项目自己写的解析。

**四、失败要说清楚。** 缺依赖、缺字体、只有一路抽取器，都如实标注并给降级说明，不假装通过。

---

## 快速开始

```bash
git clone <this repo> && cd resume-cn
npm install

# 1. 确认字体。默认用微软雅黑（Windows 自带）；没有的话按下一节换字体
node src/cli.js fonts status --family 微软雅黑

# 2. 建自己的数据目录
node src/cli.js new my-resume

# 3. 改 my-resume/resume.yaml（填你的信息）与 my-resume/variants/teacher-biology.yaml（选这一版要什么）

# 4. 渲染
node src/cli.js build --data my-resume --variant teacher-biology

# 5. 跑门禁
node src/cli.js check --data my-resume --variant teacher-biology
```

`check` 的退出码为 1 时可直接挂进 CI。

**PDF 转换依赖**：本项目不打包 LibreOffice。按以下顺序自动探测：`--pdf-cmd` → `RESUME_CN_PDF_CMD` → PATH 里的 `soffice`/`libreoffice` → `RESUME_CN_KIT_NODE` 与 `RESUME_CN_KIT_CLI` 指定的便携版。都没有时只出 DOCX 并如实报告。

---

## 字体怎么设

**仓库不分发任何字体二进制**，只写字体名。模板默认是微软雅黑（Windows 自带，也是本项目日常在用的那款）。换字体有三条路：

```bash
# 一、系统里已经有，直接用（默认就是这条路）
node src/cli.js fonts status --family 微软雅黑

# 二、没有微软雅黑：下载思源黑体（SIL OFL 1.1）并装进用户字体目录
node src/cli.js fonts install --to-user
node src/cli.js check --data my-resume --variant teacher-biology --font "Source Han Sans SC"

# 三、用自己手上任意一款字体
node src/cli.js fonts define --family "我的字体" --regular D:\fonts\my-regular.ttf --bold D:\fonts\my-bold.ttf
node src/cli.js check --data my-resume --variant teacher-biology --font "我的字体"
```

**换字体不改版式。** 原因在 `template.yaml` 的 `lineHeightPt`：行高是显式值，不随字体度量浮动。实测把微软雅黑换成思源黑体（后者默认行高约高 9%），页数仍是两页，纵向坐标只差 1pt 以内。

**门禁会验字体是否真被用上。** `check` 比对 PDF 里的 `BaseFont`，并有一张家族别名表把中文族名映射到 PostScript 名（微软雅黑 对应 `MicrosoftYaHei`），所以不会因为 PDF 里只有拉丁名而误判失败。字体没装上时，转换器会静默替换成别的字体，这条门禁会当场报出来。

---

## 数据格式

字段命名以 **JSON Resume** 为基线，`cn` 命名空间下为中文场景扩展（求职意向、政治面貌、学历层次、任教学科、证书编号）。

```yaml
basics:
  name: 张三
  label: 中学生物教师          # 求职意向，可被变体覆盖
  phone: "130-0000-0000"       # 加引号
  cn:
    gender: 男
    birthDate: "2000-01"       # 加引号，渲染为「2000 年 1 月生」
education:
  - institution: 复旦大学
    area: 生命科学学院 · 生物学
    studyType: 硕士（在读）
    startDate: "2024.09"       # 加引号
```

> **日期与编号一律加引号。** YAML 会把 `2024.09` 解析成数字，18 位证书编号还会丢精度。工具做了兜底转换并提示，但丢精度的编号无法还原，会直接报错要求加引号。

`evidence` 段记录字段溯源，不写入简历正文：

```yaml
evidence:
  certificates[0].credentialId:
    file: evidence/teacher-certificate.pdf
    note: 与证书原件逐字核对
    checkedAt: "2026-11-20"
```

**本 schema 不接收身份证号。** 需要证明身份时，用 `evidence` 指向扫描件。

---

## 变体：内容选用写在这一层

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
    bullets: 2                # 每条目最多取 2 条 highlights
  - section: awards
    title: 荣誉与获奖           # 单行罗列型
forbidEntities:               # 这一版不得出现这些机构名
  - 某某实验学校
# statement: 个人陈述默认关闭；只有公告明确要求时才启用，且只能放最后
```

**个人陈述的处理**：默认不写。中文简历不需要开场自述，占版面且冲淡证据。只有招聘公告明确要求「研究兴趣说明」这类内容时才启用 `statement`，且：

- 渲染器强制放在最后一个分区（有一条门禁专门查这个）；
- 有字数上限 `maxChars`，默认 300 字；
- 超长或位置不对都会失败。

---

## 门禁一览

`node src/cli.js check` 会跑以下检查。

**体例门禁**（`src/gates/layout.js`）

| 编号 | 检查 | 判据 |
|---|---|---|
| L1/L2 | 页数与预算 | PDF 实际页数，PyMuPDF 优先，退化到 PDF 结构计数 |
| L3 | 分区齐全 | 变体声明的每个分区标题都要出现在正文 |
| L4 | 陈述位置 | 个人陈述之后不得再有其他分区 |
| L5 | 陈述长度 | 不超过 `maxChars` |
| L6 | 机构名越界 | `forbidEntities` 里的名字不得出现在正文 |
| L7 | 身份证号 | GB 11643 加权模 11 校验位 + 出生日期合理性 |

**语言门禁**（`src/gates/language.js`，16 条）

| 依据 | 覆盖 |
|---|---|
| GB/T 15834—2011 | 中文句内全角标点、破折号不加空格、引号用弯引号 |
| GB/T 15835—2011 | 数字与量词之间加半角空格 |
| W3C《中文排版需求》clreq | 中西文之间加半角空格 |
| 余光中《中文的常态与变态》 | 「进行／作出」万能动词、「人们」、「之一」、单字成词 |
| 去 AI 腔清单 | 空洞评价、连接词起句、钩子句、第一人称情绪、伪发现、叙事铺垫 |

**产物门禁**（`src/gates/artifact.js`）

| 检查 | 判据 | 做不到时 |
|---|---|---|
| 字体嵌入 | PDF 里每个 `FontDescriptor` 都要有 `FontFile/2/3` 流 | 失败，报告描述符数与嵌入流数 |
| 声明字体是否真被用上 | PDF 的 `BaseFont` 里要出现模板声明的字体族 | 失败，列出 PDF 内实际字体 |
| ATS 往返 | 两个以上抽取器交叉比对文本一致；只有一个时退化为单源校验并明确标注 | 一个都没有时跳过并说明装什么 |
| 隐私 | 全仓库扫描校验位成立的身份证号 | 失败，指出文件 |

---

## 模板

`templates/fudan-red/template.yaml` 是渲染器唯一的输入。颜色、字号、行距、页边距、证件照尺寸、分区标题、单行分区的标签词都在里面，**模板清单里没有代码**。

换模板＝换一份清单加一个布局实现。已知约束与建议：

- 字体默认微软雅黑，可用 `--font` 换成任意已装字体。**任何字体二进制都不要打进仓库**，包括本机常用的商业字体。
- 行高写在 `lineHeightPt` 里，是显式值。这一条是版式稳定的前提：docx 的自动行高随字体度量变化，换个字体两页就会被顶成三页。
- 证件照尺寸 72×96 pt，右上角，单元格 1500 twip。
- 分区标题条带 `keepNext`，避免标题孤零零留在页底。

---

## 已知局限

- **不判好看。** 本项目的门禁判合规，版面美观仍需人看。
- **ATS 往返只能证明机器读得对**，不能证明招聘方会给面试。
- **正文抽取质量取决于装了哪几个提取器。** 只有一路时是弱校验，报告里会写明。
- **PDF 与页数的最终一致性依赖 LibreOffice 的排版引擎。** 同一份 DOCX 用 Word 打开，分页可能不同；已在 Windows 与 Linux 上都会跑，但只以 LibreOffice 的结果为准。
- **身份证校验位只做格式判断**，不保证号码真实存在。

---

## 路线与一项公开承诺

- **M1 能复现**：与现有来源逐页对齐，产物哈希稳定。✅ 已完成（示例数据两页，全部门禁通过）
- **M2 陌生人可用**：一个没读过代码的人，只读本 README，在十分钟内产出 PDF。
- **M3 可发布**：CI 双平台、模板预览图自动生成、veraPDF 与多解析器报告随 release 附上。

**公开承诺**：M1 结束时复查一次「是否该改为给 RenderCV 写中文主题，而不是自建」。判据写在 `docs/DECISIONS.md`；若那边已能覆盖中文排版与 DOCX 输出，本项目转为贡献主题并停止自建。

---

## 许可

代码 MIT。

字体：本仓库不含任何字体文件，`.gitignore` 排除了 `fonts/`。默认字体写在模板清单里，只是一个字体名。`fonts install` 从 Adobe 官方仓库下载思源黑体（SIL OFL 1.1）并打印 SHA256，装到用户字体目录，文件不随仓库分发。本机常用的商业字体请在自有授权范围内使用，不要提交进任何公开仓库。
