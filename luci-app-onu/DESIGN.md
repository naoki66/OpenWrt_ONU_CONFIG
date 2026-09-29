# luci-app-onu 界面设计说明

## 1. 设计原则：跟随 Argon，不自建设计系统

luci-theme-argon 已经提供了完整的调色板、字体栈、卡片与表单样式。PON 页面**不引入第二套设计系统**，
所有颜色与字体都通过主题变量解析，因此浅色/深色主题、用户自定义主色都能自动生效。

luci-app-onu 只补充主题没有提供的东西，全部集中在 `view/onu/onu.css`（约 230 行）：

| 类名 | 用途 | 为什么主题不够用 |
| --- | --- | --- |
| `.pon-grid` | 自适应指标网格 | Argon 内嵌 Pure 的 `.pure-u-*` 是固定宽度，小屏不换行 |
| `.pon-tile` | 常显指标瓦片 | 主题只有整块 `cbi-section`，没有小尺寸指标瓦片 |
| `.pon-num` / `.pon-unit` | 读数与单位分级 | 数值与单位同号会淹没读数本身 |
| `.pon-list` | 明细/计数用的键值行列表 | 主题没有无边框的键值列表；十几块瓦片会读成一张表格 |
| `.pon-block` | 常显分组（线路详情） | 主题只给 `.cbi-section > h4:first-child` 加了间距 |
| `.pon-fold` / `.pon-fold-body` | 折叠分组（计数与诊断） | 主题的 `details` 无间距 |
| `.pon-count` | 折叠标题上的条目数 | 主题没有计数徽标 |
| `.pon-dot` / `.pon-state` | 状态圆点 | 主题没有状态指示件 |
| `.pon-subhead` | 分组标题 | 主题只给 `.cbi-section > h4:first-child` 加了间距 |

复用（零新增样式）：`.cbi-map`、`.cbi-section`、`.cbi-section-descr`、`.cbi-value`、
`.cbi-value-title`、`.cbi-value-field`、`.cbi-input-text`、`.cbi-input-invalid`、
`.ifacebadge`、`.cbi-page-actions`、`.cbi-button-action`、`.pull-right`、`details/summary`。

> **统一性约束**：状态页不使用 `.table`。数值、状态与计数只用两种件——
> **瓦片**（一眼扫读的状态量）和**键值行**（明细与计数）——同一页不出现「卡片 + 表格」
> 两套视觉语言。层级由**位置与密度**表达，而不是由「换一种组件」表达：
> 瓦片有边框有阴影、键值行只有发丝分隔线，因此「把明细也做成瓦片」和「把明细做成表格」
> 是两个极端，都会毁掉层级——前者十几个方块读起来就是一张表格，后者与卡片割裂。

## 2. 配色方案

颜色**一律引用变量**，禁止在 JS/CSS 里写死色值。Argon 在 `:root` 提供的语义色：

| 变量 | 默认值 | PON 页面用途 |
| --- | --- | --- |
| `--primary` | `#5e72e4` | 链接、主按钮（主题自身使用） |
| `--success` | `#2dce89` | 正常：已注册 / 已同步 / O5 / 已应用 / 认证通过 |
| `--warning` | `#fb6340` | 进行中：等待同步 / 等待发现 / 未同步 / 待生效 |
| `--danger` | `#f5365c` | 异常：错误 / 注册被拒 / O7 / 应用失败 |
| `--info` | `#11cdef` | 中性提示 |
| `--gray` | `#8898aa` | 未知 / 不适用 / 线路已停止 |
| `--gray-dark` | `#32325d` | 标题与正文主色 |
| `--background-color` | `#f4f5f7` | 页面底色 |
| `--border-color` / `--text-primary` / `--text-secondary` / `--bg-light` | 由主题派生 | 卡片描边与文字，均带字面量兜底 |

状态语义映射（status.js 中的 `…Severity()` 函数）：

| 状态点 | 触发条件（例） |
| --- | --- |
| 绿 `ok` | `operational` / `in-sync` / `O5` / `registered` / `accepted` / `applied` / 布尔为真 |
| 橙 `pending` | `wait-line-sync` / `hunt` / `O1`–`O4` / `pending` / 等待 CTC 发现 |
| 红 `error` | `error` / `O7` / `denied` / `password-mismatch` / `apply-failed` / 布尔为假 |
| 灰 | `stopped` / `not-applicable` / `Unknown` |

**无障碍约束**：状态点始终是 `aria-hidden` 的装饰件，旁边一定有文字把状态写出来。
颜色从不单独承载语义，因此不存在"只看颜色分不清状态"的问题，也避开了
`#2dce89` / `#f5365c` 作为文字色时对比度不足（约 2:1）的 WCAG 风险。

## 3. 字体方案

字体栈直接沿用主题：

```
--font-family-sans-serif: "Google Sans", "Microsoft Yahei", "WenQuanYi Micro Hei", sans-serif
```

字号刻度（全部来自主题既有层级，未新增）：

| 层级 | 规格 | 应用位置 |
| --- | --- | --- |
| 页面标题 | `h2` | 「PON 状态」「硬件身份」 |
| 卡片标题 | `h3`，1.1rem，`--gray-dark` | 每个 PON 线路 / 身份分组 |
| 分组标题 | `.pon-subhead`，0.875rem | 板级身份下的存储目标 |
| 指标名 | `.pon-tile > dt`，0.75rem，`--text-secondary` | 接收光功率等 |
| 指标值 | `.pon-tile > dd`，1.125rem / 600 | 同上 |
| 读数 | `.pon-num`，1.375rem / 600 | 收/发光功率、温度的数字部分 |
| 读数单位 | `.pon-unit`，0.8125rem / 500，`--text-secondary` | dBm / °C |
| 明细名 | `.pon-list > dt`，0.8125rem，`--text-secondary` | 线路详情与计数的标签 |
| 明细值 | `.pon-list > dd`，0.875rem / 600 | 线路详情与计数的值 |
| 说明文字 | `.cbi-section-descr`，small / 1.5 行高 | 卡片说明、字段描述 |
| 标识值 | `<var>`（主题：斜体 `#0069d6`） | ONU-ID、LLID、序列号、各类 ID |

`<var>` 是主题自带的等宽语义样式（对比度约 4.6:1，满足 AA），用于承载所有需要抄写的标识值，
比自己写一个 `.monospace` 更省也更一致。

## 4. 布局与断点

- 容器：`.cbi-map`（主题已为 flex 列 + 1rem 间距），卡片即 `.cbi-section`（白底、圆角、阴影）。
- 指标网格：`grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr))`，**无需媒体查询即可自适应**；
  仅在 ≤30rem（约 480px）时显式降为单列，避免小屏挤压。
- 键值列表：`.pon-list` 两列 `minmax(7.5rem, 32%) 1fr`；计数加 `.pon-list--split` 后
  ≥48rem（768px）变四列、每行两对，组内间距 1rem、组间 1.5rem，窄屏自动退回一对一行。
- 表单行：`.cbi-value` + `.cbi-value-title`（右对齐固定宽）+ `.cbi-value-field`，沿用主题表单节奏。
- 移动端优先：先保证 320px 单列可用，再向上增强为多列。

## 5. 组件清单与状态

| 组件 | 实现 | 状态 |
| --- | --- | --- |
| 模式/协议徽章 | `.ifacebadge` | 静态文本（XGS-PON / OMCI / EPON OAM） |
| 状态指示 | `.pon-state` + `.pon-dot[data-state]` | ok / pending / error / 灰 |
| 常显指标瓦片 | `dl.pon-tile` + `dt` + `dd`（读数用 `.pon-num` + `.pon-unit`） | 值缺失显示「未知」 |
| 常显明细分组 | `.pon-block` + `.pon-subhead` + `dl.pon-list` | 单列，标签 32%，长文本可换行 |
| 折叠计数分组 | `details.pon-fold[data-pon-details]` + 若干 `.pon-subhead` + `dl.pon-list--split` | ≥48rem 时每行两对；数字 `tabular-nums` 对齐；轮询重建后保持展开态 |
| 折叠条目数 | `summary` 上的 `.pon-count` | 纯数字，提示是否值得展开 |
| 文本输入 | `input.cbi-input-text` | 校验失败加 `.cbi-input-invalid`（主题红色描边） |
| 操作按钮 | `.cbi-button-action` / `.cbi-button-negative` | 只读权限时 `disabled` |

## 6. 微交互

- 不新增动效：主题的按钮 hover/active 已足够，避免动画干扰长时间驻留的运维页面。
- 状态页 3 秒轮询：整块 `dom.content` 重建，重建前后读取并恢复 `details` 的展开集合，
  不会把用户展开的计数器合上。
- 写入板级身份：失败时把对应输入框标红并弹出 danger 通知；成功弹 info 通知并刷新基线值。
  「没有修改任何字段」也给出提示，避免点了按钮没反应。

## 7. 信息架构

菜单为**独立的顶级节点** `admin/onu`（不再挂在 `admin/network` 下），显示名 ONU，`order` 为 20。
父节点 `action.type` 写成 `firstchild` 即会把最靠前的叶子当作默认落地页——现在就是「状态」页。
子页顺序（自上而下，**由 `menu.d` 的 `order` 决定，与 JSON 书写顺序无关**）：

| Order | 子页 | 视图 | 可见条件 |
| --- | --- | --- | --- |
| 10 | **状态** | `onu/status` | 存在 `pon` 配置 |
| 20 | **硬件身份** | `onu/hardware` | 存在 `pon` 配置 |
| 30 | **认证配置** | `onu/config` | 存在 `pon` 配置 |
| **35** | **上网** | `onu/internet` | 存在 `internet` 配置 |
| 40 | **IPTV** | `onu/iptv` | 存在 `iptv` 配置 |
| 45 | **语音配置** | `onu/voice` | 存在 `voice` 配置 |
| 50 | **网络诊断** | `onu/diagnostics` | `/usr/libexec/airoha-pon-debug` 可执行 |

> ⚠️ **「上网」插在 30 与 40 之间，所以用的是 35 而不是 40 之后的值。** 现有两边分别是 30（认证）与
> 40（IPTV），中间还有空位；直接挤到 45/46 会把语音页顶乱。LuCI 在 `menu.d/*.json` 里按 `order`
> 排序，**书写顺序不影响显示顺序**——早期版本（`.lua` controller 时代）由 `entry()` 的注册顺序决定，
> 本树早已不在那个模型上。

> ⚠️ **`order: 20` 为什么能保证排在 Network 之前**：luci-base 的顶层
> `order` 是 **status 10 / system 20 / services 40 / network 50 / vpn 70 / logout 999**
> （不是 30），菜单由 `ui.js` 的 `getChildren()` 排序：`order` 升序，**相等时按节点名字母序**
> （`naturalCompare`）。`onu` 与 `system` 同为 20，但 `onu` < `system`，所以稳定落在
> Status 与 System 之间、Network 之前。想再往前（如排到 Status 之前）改成 **5** 即可；
> 想紧贴 Network 之前改成 **45**。注意顶层之间有 tie 时结果由节点名而非文件加载顺序决定，
> 所以在自己的节点里不要依赖"我文件写得早"。

> ⚠️ **ACL 与 UCI 名的关系**：改名只改包名/路径/ACL 名，**不改 `/etc/config/*` 的名字**
> （`pon` / `internet` / `iptv` / `voice` 保持原样），因此升级无需迁移 UCI 数据。

IPTV 原本是独立的 `luci-app-iptv` 包（菜单挂在 `admin/network/iptv`），现已整体并入
`luci-app-onu` 成为第四个子页：`/etc/config/iptv`、`/etc/init.d/iptv`、`iptv-apply`
与 ACL 全部随包迁移，ACL 合并为单一 `luci-app-onu` 条目。原因是它配置的正是
「把 LAN 口桥接到 PON 上联承载的运营商 VLAN」，本来就是 PON 业务的一部分；
代价是 `luci-app-onu` 现在依赖 `firewall4` 与 `kmod-nft-bridge`。
IPTV 页只在 `/etc/config/iptv` 存在时显示（`depends.uci`）。

### 状态页

每张 PON 线路 = **一张卡片**，自上而下三层，密度递减：

1. **常显指标网格** `.pon-grid`（瓦片）：线路状态、光信号、收/发光功率、光模块温度，
   以及 **ONU 状态 / MPCP 状态**（两个分支各留一个注册状态瓦片，数量对称）。
   收发光功率与温度用 `.pon-num` + `.pon-unit`，数字压过单位。
2. **常显「线路详情」** `.pon-block` + `.pon-list`（键值行，**不折叠**）：线路模式三项、
   PHY ready、GTC/XGTC 状态、ONU-ID 或 LLID0、数据通路、业务就绪、突发发射机就绪。
3. **折叠「计数与诊断」** `details.pon-fold`：按主题分组的计数行——
   「链路事件」「帧计数」（ITU-T）或「注册过程」（EPON）、「光模块」；
   展开后是 `.pon-list--split`（宽屏每行两对）而非十几块瓦片。

> **为什么线路详情不再折叠**：它回答的是"这条线是不是按我预期配置的"，与常显指标
> 一起读，藏进折叠里等于逼用户每次都点开。真正只在排障时才看的是计数，所以只有它折叠。

> **排序原则：状态优先于标识。** 常显网格只放"看一眼就知道线通不通"的量——
> 即设备状态（ONU state / MPCP state）和实时光功率这类会随链路变化的量。
> ONU-ID / LLID0 这类**分配下来的编号**只在注册成功后才有意义、且不随链路状态变化，
> 一律放在「线路详情」里。

> **GTC/XGTC 状态属于线路详情，不属于瓦片。** 它只是 ONU 状态之下的那一层帧同步，
> 同一信息在 EPON 侧就是详情里的「PCS synchronized」；做进瓦片会让 ITU-T 比 EPON 多一块，
> 破坏两侧对称。位置沿用改版前/上游的顺序：**PHY ready → GTC/XGTC 状态 → ONU-ID**。

层级由**密度**表达：瓦片（有边框有阴影）→ 键值行（只有发丝分隔线），折叠只改变可见性、
不改变语言，因此展开折叠不会突然换一种组件。
OMCI / EPON OAM 同为「常显指标网格 + 折叠『协议详情』键值列表」，并按线路模式只显示对应协议的那一张。

### 硬件身份页（板级数据与 ONU 身份统一入口）

| 区块 | 数据来源 | 说明 |
| --- | --- | --- |
| 板载身份 | `pon-board-identity`（Flash） | 身份字段按存储目标分组，**逐个就地改写** |
| PON board data（**最下面一块**） | `airoha-pon-data`（Flash） | 整份镜像的两个方向：**「下载备份」**与**「上传并写入」**；目标多于一个时才出现目标下拉 |
| ONU 身份 — OMCI | UCI `pon.omci` + UCI `pon.xpon`（序列号） | 仅当线路为 **GPON / XG-PON / XGS-PON** 时显示 |
| ONU 身份 — EPON OAM | UCI `pon.oam` | 仅当线路为 **EPON / 10G-EPON** 时显示 |

> ⚠️ 底部两块**顺序固定**：先「板载身份」（改字段），再「PON board data」（整份替换）。
> 上游 `config.js` 的 "PON board data" 卡片就是后者，本页把它并到硬件身份页的**最下面**，
> 与身份字段上下相邻——两者写的是同一份镜像，分开两页会让人以为是两个不相干的东西。

#### ⚠️ 页面里的东西必须挂在 form map 上，不能自己在 `m.render()` 外面拼 DOM

判定"某个区块在标签页下不显示"时，先看它是**怎么被挂上去的**，而不是先怀疑样式。
LuCI 的 `form.js` 在 `renderTabContainers()` 里只为 **section 内注册的 option** 建
`data-tab` 容器，主题（Argon）的标签 JS 只显示这些容器里的内容：

- `s.option()` / `s.taboption()` 注册的 → 一定会被渲染进对应标签页；
- 在 `m.render().then(map => E([], [ ...手写卡片..., map ]))` 里**自己拼的 DOM** →
  只是 map 的兄弟节点，既不进任何 `data-tab` 容器，也不会被标签逻辑显示。

> ⚠️ **本页原先就是这个坑**：板级身份卡片是手写的 `E('div', { class: 'cbi-section' })`，
> 被 `cards.concat([ map ])` 放在 map 外面，于是整张卡在任何情况下都不显示，
> 而被误判成"上传入口丢失"。修法是**把卡片改成 form section**（`m.section(...)` +
> `s.option(...)`），让所有内容都进入 map。上游 `pbs05/openwrt-pon-userspace` 的
> `config.js` 里那段 "PON board data" 同样是手写卡片拼在 map 后面——**照抄它的写法不行，
> 要照抄的是它的操作**（目标存储 + 上传并写入），那部分收进本页最下面的 section。

**板级身份与板级数据本来就是同一个东西的两面**，所以放在相邻的两个 section：两者都通过
`board.json` 的 `pon_data` 定位存储目标，`pon-board-identity write` 是读出镜像后
**按 offset 就地改写字段**再写回，`airoha-pon-data write` 则是**整份镜像替换**。

一台设备通常只有**一个** `pon_data` 目标（DSD 分区），因此页面上：

- **目标下拉只在真的有多个目标时才建**——单目标时下拉永远只有一项，是噪音；分区名与容量
  由 `airoha-pon-data list` 的 label 直接显示成一行文字；
- 也不存在"只能写校准、没有身份字段"的目标，所以身份字段只在 `identity.targets` 声明了
  字段时出现；`airoha-pon-data list` 失败时仍会退到 `pon-board-identity` 报告的目标；
- 全页**只有一个**「上传并写入」，在最下面的「PON board data」里——它是整份替换，
  与"改几个字段"不是一个量级的操作。

> ⚠️ **两个 section 的合成实例名必须不同**（`board` 与 `image`）。`TypedSection` 的
> `renderContents()` 用 `cbi-<config>-<sid>` 给实例节点编号，两个 section 同用 `board`
> 会产出两个同 id 的节点；同时要 `s.anonymous = true`，否则实例名会被打印成第二个 `<h3>`。

> ⚠️ **这个上传入口的措辞必须是「板级身份文件」，不能叫「校准镜像」。** 上传的就是 DSD 分区的
> 整份镜像，身份字段与校准数据都在里面；设备并不存在一个"只能写校准"的目标。早期版本把它标成
> 「校准镜像」后，用户按"板级身份"去找就完全找不到入口，等于把功能改没了——措辞本身承载了
> "这个分区是什么"的信息，不能随意降级成其中一半。

> ⚠️ 两个动作共用一份镜像：**写板级身份文件会覆盖同一目标里的身份字段**。这不是能靠 UI 规避的，
> 所以在 section 说明里直接写明，而不是把两者藏在不同的 section 里假装无关。

**备份与写入是同一份镜像的两个方向**，所以并排放进「板级身份文件」分组，不做第二个 section：

- 「**下载备份**」：`airoha-pon-data read NAME` 把整份镜像读到固定路径
  `/tmp/pon-board-backup.bin`，前端用 `fs.read_direct(..., 'blob')` 触发浏览器下载，
  文件名带目标名与时间戳——**与诊断页下载诊断包同一套路**，镜像不经过页面自身持有；
- 「**上传并写入**」：仍是 `ui.uploadFile()` + `airoha-pon-data write NAME` 整份替换、
  读回校验，原镜像另存 `/tmp/pon-board-data.*.bin`。写入前加了确认弹窗：这一步要动
  Flash，而且会连同身份字段一起覆盖。

> ⚠️ 备份只读 Flash，因此**不随 `m.readonly` 禁用**。ACL 相应地在 `read` 段放开
> `/usr/libexec/airoha-pon-data read *` 的 exec 与 `/tmp/pon-board-backup.bin` 的 read；
> 同时要在 `read` 段的 `ubus.file` 里列上 `exec`，否则 read 段里那些命令对只读用户
> 永远不可达（`fs.exec` 走的就是 `file.exec`，光在 file 列表里放行不够）。
> 写入仍留在 `write` 段，只有可写用户可用。

保存走 `handleSave()`：先 `save` 表单（UCI 的线路身份覆盖项），再逐目标
`pon-board-identity write` 写板级字段，最后 `apply`。板级写入放在 UCI 之后，
这样板级失败时不会留下"UCI 已改、镜像没动"的静默不一致。

降级仍然是各自独立：`pon-board-identity list` 失败 → 板载身份只剩一行说明，PON board data
照旧；`airoha-pon-data list` 失败 → **上传与备份按钮仍然保留**（`pon-board-identity` 的目标名同样来自
`pon_data`，可以直接当 `airoha-pon-data write` / `read` 的目标用）；两者都失败 → **两块都还在，
只是各自写明原因**，不影响下面的 ONU 身份区块。

> ⚠️ **卡片"消失"会被读成"功能被删了"**，所以底部两块**永远渲染**，缺数据时用一行
> `DummyValue` 说明缺的是什么（`identity` 没声明 / `pon_data` 没声明 / 读失败），
> 而不是 `if (!…) return` 把整块砍掉。
>
> ⚠️ **`loadIdentity()` 里每个字段的 read 必须各自 `.catch()`。** 原来的写法把所有 field 的
> read 串成一条 `sequence`，**任何一个字段读失败就会 reject 整条链**，`loadIdentity()`
> 落到外层 `.catch()` 返回 `null` —— 于是"一个字段读不出来"表现成"整块板载身份不存在"，
> PON 序列号与板载 MAC 全部消失。现在失败的字段记成 `null`（渲染成空输入框），布局照旧。

两个 ONU 身份区块都由 `s.filter` 按 `xpon.mode` 生效（与状态页同一套 `isEponMode()` 判据），
并在区块内显示「PON 线路」和「线路模式」两个只读字段，避免多线路设备上认错区块。
EPON 与 GPON 的字段集合不同（EPON 多了 ONU 短型号、固件版本、芯片 ID、以太网口数量，
且各字段长度上限不同），因此分两个 section 而不是合并成一个。

#### 序列号（SN）从「PON 线路」移到这里

序列号是**ONU 向 OLT 注册用的身份**，与板级身份同属一类，因此放在 ONU 身份—OMCI 区块，
紧挨着厂商 ID 等身份字段。**成对出现**：

| 字段 | 来源 | 可编辑 | 说明 |
| --- | --- | --- | --- |
| 序列号（SN） | UCI `pon.xpon.serial_number` | 是 | 覆盖板级烧录值；留空则按烧录值注册 |
| 板级序列号（SN） | `pon-board-identity read <target> pon_sn` | 否（在「板载身份」里改） | 烧录在 Flash 里的值 |

两者并排是为了**一眼看出不匹配**——注册失败时这是第一个要查的点。可编辑的那个仍写回
`pon.xpon.serial_number`（由 `pon.init` 下发给内核 `xpon/serial_number`），没有换存储位置，
只是换了所属区块与措辞。

`pon.init` 的回落顺序相应变为 **UCI 覆盖值 → 板级烧录值 → `default`**：留空不再直接等于
`default`，而是先用烧录值。板级读取失败（无 `pon_sn` 字段、无 `pon-board-identity`）仍
回落 `default`，行为与从前一致。

原 configuration 页的两个「ONU identity」标签页已移除，改为在该分区留下指向硬件身份页的说明。
原 configuration 页末尾的「PON board data」上传卡片也已移入硬件身份页**最下面一块**（名字沿用
"PON board data"：它就是写进 Flash 的板级身份文件，与身份字段同类；config 页只留一行指向说明）。

### 认证方式：LOID 与 Password 是二选一，不是"LOID 是否配置"

**运营商发什么凭据，就用哪种认证方式**，这是运营商的属性而不是 ONU 的偏好：

| 认证方式 | 凭据 | 上报的 ME |
| --- | --- | --- |
| LOID 认证 | `loid`（纯 LOID，或 LOID + LOID 密码） | `CLASS_CTC_LOID_AUTH`（0xfffa） |
| Password 认证 | `registration_id` | 不上报 LOID ME，`registration_id` 作为凭据 |

> ⚠️ **不要把 `loid` 为空直接解释成 `loid-not-found`。** 空 LOID 只是"没有 LOID"，而
> OLT 报 `loid-not-found` 是因为**它被要求查一个不存在的 LOID**。两者之间隔着一个真正的
> 错误：把空的 CTC LOID ME 报给 OLT。

> ⚠️ **不要把 `loid_configured=false` 当作必然失败条件。** Password 认证的线路上它就是
> 正常状态，标红是把用户的正确配置说成故障。

因此判定收敛到**一个**函数 `advertise_ctc_loid_auth()`：

```rust
match self.auth_mode {
    AuthMode::Password => false,          // 凭据是 Registration-ID，不上报 LOID
    AuthMode::Loid => !self.loid.is_empty(), // 有 LOID 才有东西可供 OLT 查
}
```

MIB 只在这个函数为真时才 `insert(CLASS_CTC_LOID_AUTH, ...)`——**没东西可查就根本不提供这个
ME**，OLT 也就无从报 `loid-not-found`，更不会对已经到 O5 的线路 Deactivate。这是
password-only 场景下 O5 反复掉线的根因。

`AuthMode` 只有 `Loid` / `Password` 两个值（`auth_mode` 未配置时不叫"第三种模式"）：
`loid` 非空 → `Loid`，否则 → `Password`。落库则在 `pon.omci.auth_mode`，下拉二选一，
`loid` / `loid_password` 仅在 LOID 认证下显示（兼容早期配置：两个 `depends()` 调用是 OR，
`auth_mode` 为空时同样显示，不至于把老配置的 LOID 藏起来）。

状态页同理由 `credentialSeverity()` 判定，不再直接用 `booleanSeverity(loid_configured)`：

| 场景 | 显示 | 严重度 |
| --- | --- | --- |
| Password 认证，未配 LOID | Registration-ID | 中性 |
| Password 认证，残留 LOID | 已保存 LOID，但当前不使用 | 中性 |
| LOID 认证，已配置 | 已配置 | ok |
| LOID 认证，已上报 LOID ME 但 LOID 为空 | 未配置 | **error**（唯一真故障） |
| LOID 认证，未上报 LOID ME | 未配置 | 中性 |
| 旧 agent 未上报 `auth_mode` | 回退为布尔显示 | 有 LOID 才 ok |

`auth_mode` 与 `ctc_loid_advertised` 都进了 OMCI 状态 JSON，所以页面判定的是
**agent 实际做了什么**，而不是**配置看起来像什么**。


### 语音配置页

`view/onu/voice.js` 是一张 `form.Map('voice')`，按运营商光猫「应用 → 宽带电话设置」的三个子页
（语音配置 / 数图配置 / 线路设置）组织成六个 section，顺序与设备一致：

| Section | 类型 | 内容 |
| --- | --- | --- |
| 语音配置 | `NamedSection('config','voice')` | 启用、语音协议（H.248 / 软交换 SIP / IMS SIP）、DTMF 转移模式、PayLoad 类型值、来电显示、拍叉时间间隔上下限、催挂音/忙音/久叫不应时间、Codec 协商规则、传真编码方式、传真协商方式、同步话机时间 |
| H.248 | `NamedSection('h248','h248')` | 仅协议为 H.248 时出现。四个 tab：基本配置（编码类型、主备服务器地址与端口、MG 注册方式、域名、MG 端口、授权方式、物理端点前缀）、资源（RTP 临时端点前缀/起始/对齐模式/数字长度/数目）、高级配置（ACK 消息、长定时器、PENDING 定时器、重传定时器、重传次数/间隔/时长、重注册周期）、心跳（模式、周期、次数） |
| SIP | `NamedSection('sip','sip')` | 软交换 SIP 与 IMS SIP 共用。四个 tab：服务器（代理/注册/出局代理/归属网关域名的地址、端口与承载协议）、备用服务器（代理/注册/出局代理的备用地址、端口与承载协议）、高级配置（信令 DSCP、媒体 DSCP、注册周期、注册重试周期、会话更新周期、最小会话更新周期）、心跳（开启心跳、周期、超时次数、模式） |
| 数图配置 | `NamedSection('digitmap','digitmap')` | 启用拨号计划、匹配模式（最大/最小匹配）、摘机不拨号时间、拨号短定时器、拨号长定时器、数图（多行文本） |
| 线路设置 | `TypedSection('line')` | 两个 FXS 端口（`port1` / `port2`）：启用、线路终端 ID、认证用户名、认证密码、电话号码（后三项仅 SIP）、呼出增益、呼入增益、开启回声抑制 |
| 编码设置 | `TableSection('codec')` | 每个端口四行 codec：语音端口、编码（G.711 A-law / G.711 u-law / G.722 / G.729）、打包时长、优先级 |

字段与取值来自真机（中国移动 ONT，`voice_config.cgi?v=prof|dmap|line`）实测抓取，
命名沿用 TR-104/CT 前缀（`X_CT_COM_*`、`X_ASB_COM_*` 之外的公开字段），
但 UCI 里统一改为小写下划线：例如 `X_CT_COM_ServerType` → `protocol`（`h248`/`sip`/`ims_sip`）。
SIP 段的字段在 H.248 机器上由 CGI 分支掉、抓不到页面，因此取自 `help.cgi?help=use_sip`，
取值范围与提示文案与设备一致；H.248 段与数图、线路段都是页面实测值。

注意点：

- 设备原始值是数字/驼峰（`InBand`、`ASN.1`、`RemoteFirst`），除协议类型外尽量保留原始取值，
  便于将来直接喂给守护进程，不再做一次映射；
- 协议下拉用**对象写法**的 `depends()`：同一个对象里的多个 key 是「与」，多次调用 `depends()`
  才是「或」；带点的 key 会被 `transformDepList()` 解析成 `cbid.<key>`，才能从 H.248 / SIP /
  线路段跨 section 引用协议字段。`forH248(o)`、`forSip(o, { heartbeat_enabled: '1' })` 两个
  助手就是把「协议 + 嵌套条件」一次性写进一个对象；
- LuCI 只会按依赖隐藏单个字段，空掉的 section 容器仍在，所以 `m.render()` 之后还要用
  `toggleProtocolSections()` 给整张卡片补 `.hidden`（取值走 `protocolOption.formvalue('config')`，
  变更走 `o.onchange`）；
- `dtmf_payload` 只在 `dtmf_method == RFC2833` 时显示，心跳周期/次数在心跳模式非「关闭」时显示，
  隐藏字段不参与校验；
- 拍叉时间上下限用自定义 `validate` 比较（最小值留空时报的是「必填」，不重复报错）；
- 增益是 `range(-14,6)`，LuCI 的 `range()` 支持负数；
- 线路按**双 FXS 口**建模：`addremove = false`，端口数由硬件决定，默认给出 `port1` / `port2`
  两段（`A0` / `A1`）；codec 用 `TableSection`（一端口多行）；
- 页面只读性仍走 `m.readonly = !L.hasViewPermission()`，rpcd ACL 已预留 uci `voice` 的读写，不用再改。

菜单可见条件是 `depends.uci.voice`，即 `/etc/config/voice` 存在——该文件已随包安装，所以现在就能看到标签页。

### 上网业务页

`view/onu/internet.js` 是一张 `form.Map('internet')` → 单个 `NamedSection('config')`，与 IPTV 页同一个套路（页面标题已经在 Map 上，section 不带标题）。
字段按"上网方式 → 各方式自己的参数 → 派生结果"排成一列，用 `depends()` 切换，而不是分 tab：这里的模式开关本身就在隐藏另一半字段，
再叠一层 tab 只会把字段藏得更深。

UCI schema（`/etc/config/internet`，同时是该标签页的可见条件）：

| Option | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `0` | 关闭时不写任何 LAN/VLAN 改动，并把原 `wan`/`wan6` 放回原位 |
| `mode` | `bridge` | `bridge` 桥接 / `dhcp` DHCP 客户端 / `pppoe` 系统拨号 **（三种）** |
| `uplink` | `pon0` | 承载运营商 VLAN 的设备 |
| `vlan` | 空（必填） | 上网业务 VLAN，例如 466 |
| `ports` | list | 桥接模式下加入上网网桥的 LAN 口（多选） |
| `ipoe` | `0` | 桥接模式下额外放行原生 IPv4/IPv6（ARP/IP/IPv6） |
| `ip_version` | `ipv4` | `ipv4` IPv4 only / `ipv4_ipv6` 双栈。**`dhcp` 与 `pppoe` 都提供这两档**，取值相同、来源不同；旧配置的 `ipv6` 仍被接受但不再提供 |
| `username` / `password` | 空 | PPPoE 凭据（`pppoe` 必填用户名） |
| `mtu` | `1492` | PPPoE 接口 MTU |
| `offload` | `1` | **本页不再显示开关**（硬件卸载迁到独立页面）。`internet-apply` 仍然读这个 option，所以既有配置的行为不变 |

#### 三种拓扑

| 模式 | 拓扑 | IPv6 从哪来 |
| --- | --- | --- |
| `bridge` | `pon0.<vlan>`（`ct-wanup`）+ 选中 LAN 口 → `br-wanup` | 不涉及：网桥只转帧，地址由下游路由器拿 |
| `dhcp` | `pon0.<vlan>`（`ct-wanup`）→ `network.wan`（proto `dhcp`） | 双栈时**另写一个真实的 `wan6`**（`@wan` + `dhcpv6`，`reqprefix auto`） |
| `pppoe` | `pon0.<vlan>`（`ct-wanup`）→ `network.wan`（proto `pppoe`） | **会话自己协商**，netifd 在 ppp 设备上起虚拟 `wan_6`；**不写 `network.wan6`** |

> ⚠️ **`wan_6` 与 `wan6` 是两个不同的东西，别混。** `wan_6`（下划线）是 netifd 在 `option ipv6 'auto'`
> 时**为 PPPoE 接口自动生成**的虚拟接口——它没有 UCI section，随会话一起生灭，proto 由 netifd 决定。
> `wan6` 是我们（或用户）在 `/etc/config/network` 里写死的 DHCPv6 客户端接口。
> 所以 PPPoE 分支的正确做法是 `ipv6='auto'` + `delegate='1'`，**而不是**写一个 `network.wan6`：
> 后者会在同一条 PPPoE 会话上再挂一个 DHCPv6 客户端。

> ⚠️ **切到 PPPoE 时必须把现有的 `wan6` 停掉。** `write_network_config()` 在 `pppoe` 分支调
> `park_wan6()`：把仍存在的 `wan6` 置 `auto=0` + `disabled=1`，并把它原来的 `auto` 记进
> `luci_wanup_prev_auto`；离开 PPPoE 时 `unpark_wan6()` 原样还回去。
> **停泊而不是删除**——删掉的 `wan6` 恢复不出来，而 stock `wan6` 本来就是靠 rename 收起的，
> 这套动作与 `take_over_stock()` / `restore_stock()` 是同一种"可逆"思路。
> 因此**前端不需要**在保存时 `uci.remove('network','wan6')`：后端已经覆盖，前端再删一次只是重复。

> ⚠️ **两种模式都写在 `network.wan` 上，而不是新建一个 `luci_wanup` 接口。** fw4 的 zone 按接口名引用成员，
> 如果新建名字而把 stock `wan` 收起，zone 里的 `network 'wan'` 就悬空了，每次 reload 都会报 "Zone 'wan' has no device(s)"。
> 反过来每个确实消失的接口（比如从双栈切回 IPv4 时的 `wan6`）都由 `drop_dead_zone_references()` 从所有 zone 里摘掉，
> 之后需要时再 `ensure_in_zone()` 加回去。

> ⚠️ **统一写在 `wan` 而不是另起一个接口名，不代表可以丢掉原来的配置。** stock `wan`/`wan6` 一律 **rename 到 `luci_wanup_stock_wan{,_wan6}`**，
> 而不是删除：`uci rename` 不动任何 option，因此原本的 proto/device/ipaddr 全都原样保留，只是被 `auto=0` + `disabled=1` 按住；
> 页面关闭时按 `luci_wanup_prev_auto` 还原。删除-再重建做不到这一点——尤其 `wan6` 通常是 `@wan`，
> 不收起来的话它会在系统拨号之后接着在上行张口要 DHCPv6。

#### 桥接模式的二层隔离

- 选中端口要独占 netifd 归属（`detach_ports()`，与 IPTV 的 `detach_lan_port()` 同一套 `device` / `interface` / `bridge-vlan` 遍历）：
  一端留在 `br-lan` 里，两个网桥会互相抢同一个端口；
- `br-wanup` 永远不合并进 `br-lan`，因此光猫自己的管理面（br-lan、dnsmasq、Web）不受影响；
- 所有桥接流量按 EtherType 在 **`bridge` 家族**里过滤（见下），只放行会话需要的帧去上行口，其余留在本地；
- 与 IPTV 机顶盒模式争同一端口时 **`fail`**：一个端口不能同属两个网桥，谁后被 netifd 应用谁胜出，属于会导致静默损坏的一类 bug。UI 侧同样先拦；
- 把全部 LAN 口都选走时只 warn 不 fail：`br-lan` 上的无线仍能提供管理面。

#### nftables：bridge 家族的 EtherType 过滤（`/etc/internet.nft`）

```
table bridge wanup
flush table bridge wanup
table bridge wanup {
	chain wanup_forward {
		iifname "lan1" oifname "ct-wanup" ether type { 0x8863, 0x8864 } counter accept
		iifname "ct-wanup" oifname "lan1" ether type { 0x8863, 0x8864 } counter accept
		... 每个端口一对，ipoe=1 时再多一对 { arp, ip, ip6 } ...
		iifname "ct-wanup" counter drop          # 上行口进来的非 PPPoE
		oifname "ct-wanup" counter drop          # 试图去上行口的非 PPPoE
		counter accept                           # LAN 口之间照常二层互通
	}
	chain forward {
		type filter hook forward priority filter; policy accept;
		meta ibrname "br-wanup" jump wanup_forward
	}
}
```

- `0x8863`（PPPoE discovery）/ `0x8864`（PPPoE session）覆盖会话的全部帧：PPPoE 场景下互联网流量都在会话帧里，
  所以按 EtherType 过滤等价于"只放行上网流量"；
- 规则由 `firewall.luci_wanup` 这个 `include` 挂载（`position ruleset-append`），与 IPTV 页完全同构；
- 落盘前先 `nft -c -f` 校验、通过再 `mv` 覆盖，跟 `iptv-apply` 一致，避免一条坏规则把整个 reload 拖死；
- **不要混用 ebtables**：固件是 fw4（nftables），旧表会各管一半。

#### NPU 卸载：什么能卸载，什么不能（已核实）

先摆结论：

| 场景 | 能否进 PPE | 原因 |
| --- | --- | --- |
| 系统拨号（PPPoE 本机终结，路由） | ✅ 可以 | 路由路径上有 conntrack → netfilter flowtable → `airoha_eth` → PPE |
| 桥接模式 + PPPoE | ❌ 主线不行 | 纯二层转发不产生 conntrack 表项，flowtable 无流可卸 |
| 桥接模式 + IPoE（原生 IP） | ⚠️ 有条件 | 需要 `br_netfilter`（`nf_call_iptables=1`）让桥上的 IPv4 帧进 ip forward 钩子才行 |
| 组播 | ❌ | 见上一节，flowtable 不卸组播 |

依据（不是推测）：

- `airoha_eth` 的 `ndo_setup_tc`（`airoha_dev_tc_setup`）只接受 `TC_SETUP_CLSFLOWER`、`TC_SETUP_CLSMATCHALL`、`TC_SETUP_QDISC_*`、**`TC_SETUP_FT`**——
  `TC_SETUP_FT` 就是 flowtable 走的那一类，所以本平台唯一的卸载入口还是 netfilter flowtable，与上一节的结论一致；
- `airoha_ppe_setup_tc_block_cb()` 里三种 `addr_type`：`IPV4_ADDRS` → `IPv4 5T`、`IPV6_ADDRS` → `IPv6 5T`、
  **`addr_type == 0` + `ETH_ADDRS` → `PPE_PKT_TYPE_BRIDGE`（L2B）**。也就是 PPE 硬件本身支持纯二层表项，
  但**主线没有任何东西自动喂它**：自动来源只有 conntrack，而桥上的 PPPoE 帧没有 conntrack 表项
  （`nftables` 侧曾有 "L2 bridge offload" 补丁能补上这条路，源自 MediaTek SDK，**截至写作时尚未进主线**）；
- 5.13 起 flowtable 会自己解析 VLAN/PPPoE 之下**真实设备**，因此要把真实设备（`lan1`、`pon0`）放进 flowtable，
  而不是 `ct-wanup` / `pppoe-wan`；
- PPE 计数可由 `airoha_ppe_debugfs` 读出：`/sys/kernel/debug/ppe/entries`（全部表项）、`/sys/kernel/debug/ppe/bind`（仅已绑定）。

> ⚠️ **fw4 只按 zone 成员推导 flowtable 设备，而且只认 `zone.network`，不认 `zone.device`。**
> 这条来自 fw4 源码本身：`related_physdevs` 只用 option `network`（`fw4.uc`），`list device` 只进 `match_devices`；
> `resolve_offload_devices()` 再对每个设备走 `resolve_lower_devices()`，后者只对 `devtype` 为 `vlan` / `bridge` 的递归展开成员。
> 于是：**想让 pon0 进 flowtable，就必须有一个 device 指向 pon0 的接口挂在某个 zone 里**——这就是系统拨号模式下额外写
> `luci_wanup_uplink`（proto `none`）的唯一理由。桥接模式不需要它：`ct-wanup` 是 `br-wanup` 的成员，顺着网桥就已经展开到 pon0 了。

#### 验收方式（到设备上可执行）

```sh
# 1. 卸载开关
uci get firewall.defaults.flow_offloading          # 应为 1
uci get firewall.defaults.flow_offloading_hw       # 应为 1

# 2. flowtable 里必须是真实设备，不能只出现 pppoe-wan / ct-wanup
nft list flowtable inet fw4 ft                     # devices = { lan1, lan2, pon0 ... }

# 3. 真的下到了硬件（[HW_OFFLOAD]，软件快路径只有 [OFFLOAD]）
conntrack -L | grep -c HW_OFFLOAD

# 4. PPE 里的表项
mount -t debugfs none /sys/kernel/debug 2>/dev/null
cat /sys/kernel/debug/ppe/entries                  # BND IPv4 5T orig=... new=... packets=...
cat /sys/kernel/debug/ppe/bind                     # 只看已绑定

# 5. 桥接模式的 EtherType 过滤有没有走在命中
nft list chain bridge wanup forward
nft list chain bridge wanup wanup_forward          # 看 counter

# 6. 二层拓扑
bridge -d link show | grep br-wanup
bridge fdb show br br-wanup
```

`ppe/entries` 的一行形如：`<index> <BND|UNB|FIN|INV> <IPv4 5T|IPv4 3T|L2B|IPv6 5T|...> orig=.. new=.. eth=.. etype=.. vlan=.. packets=.. bytes=..`；
`packets/bytes` 在涨就说明这条流确实在 NPU 里转发。

### IPTV 页

一张卡片：`form.Map('iptv')` → 单个 `NamedSection('config')`，**section 不带标题**（页面标题已经
是「IPTV」），卡内四个 tab：

| Tab | 字段 |
| --- | --- |
| IPTV bridge | PON interfaces（只读）、启用、透传方式、IPTV LAN 口 / Trunk 端口、要透传的 VLAN、上联设备、**业务 VLAN、组播 VLAN、IGMP 上行 VLAN** |
| IPv4 | 启用 IGMP snooping、启用 IGMP proxy、启用组播查询器 |
| IPv6 | 启用 MLD snooping、启用 MLD proxy |
| 组播转单播 | 把组播中继为 HTTP 单播、HTTP 端口、中继地址、**中继 VLAN（仅单线复用）**、上游设备（只读，由中继 VLAN / 组播 VLAN / 代理状态推导）、中继程序设置（rtp2httpd / udpxy / msd_lite 三个跳转按钮） |

用 `s.tab()` + `s.taboption()` 分组，而不是拆成多张卡片：运营商光猫的 IGMP 面板就是
「IPv4 / IPv6 / 组播VLAN」三个小分组挤在一个页面里，tab 既还原了这个结构，又保持「一页一卡片」。

> **组播 VLAN 不单独成 tab，紧跟业务 VLAN。** 它与业务 VLAN 是一对：留空就表示"组播也走业务
> VLAN"（校验器还会拒绝两者填成同一个值）。拆成独立 tab 会把这个"非此即彼"的关系藏起来，
> 上游 `luci-app-iptv` 也是把 `multicast_vlan` / `igmp_vlan` 平铺在 `service_vlan` 后面的。

> ⚠️ **页面标题不能重复出现。** `form.Map` 的标题已经是「IPTV」，section 再写一个「IPTV」就是
> 页面上一个「IPTV」加卡片一个「IPTV」，读起来像两个不同的东西。LuCI 只在 `title != null && != ''`
> 时才输出 `<h3>`（`form.js` renderContents），所以 section 不传标题是安全的、不会留下空的标题块；
> 原本挂在 section 上的说明要合并进 Map 的说明，不要删掉内容。
注意一旦定义了 tab，就必须用 `taboption()`，`option()` 添加的字段不会被渲染。

`depends()` 的语义是这里最容易踩的坑：**一次传对象 = 与**（`o.depends({ enabled: '1', mode: 'trunk' })`），
**多次调用 = 或**。所以「启用且机顶盒模式」必须写成对象形式，写成两次 `depends()` 会变成「启用或机顶盒模式」。
页面加载共享的 `onu.css`，卡片/说明/表单行全部沿用主题，不新增样式。

#### 两种透传方式

| 方式 | 拓扑 | 说明 |
| --- | --- | --- |
| `bridge` 机顶盒独占一个端口 | `pon0.<vid>` + 选定 LAN 口 → `br-iptv` | 端口被移出 `br-lan`；可用 snooping / querier / proxy |
| `trunk` 单线复用 | 每个 VLAN 一对 8021q 子接口 + 一个独立网桥 | 端口**留在** `br-lan`，VLAN 带标签发出；只能 snooping / querier |

单线复用必须**一个 VLAN 一个网桥**（`br-iptv-<vid>`）：8021q 子接口收进来时标签已经被剥掉，
多个 VLAN 共用一个网桥就再也无法区分，只能靠 nft 按 `iifname/oifname` 配对过滤，规则数随 VLAN 数平方增长。

Trunk 端口不需要移出 `br-lan`：内核 `vlan_do_receive()` 会先把带匹配 VID 的帧交给子接口的 rx handler，
不会再落到 `br-lan` 的 rx handler 上，所以一根网线上的 untagged 上网流量和 tagged IPTV 流量互不干扰。
前提是 **`br-lan` 不能开 `vlan_filtering`**，否则帧在 `br-lan` 这一层就被按 VLAN 过滤掉了。

代理与单线复用互斥：proxy 必须终结 VLAN（自己发成员报告、自己收组播流），而 trunk 是二层透明透传。
`resolve_proxy()` 在 `MODE=trunk` 时直接返回并打日志说明原因，UI 上对应开关也已经用 `depends` 隐藏。

#### Option 与 OpenWrt 能力的对应关系（四个开关不是都能独立实现）

| 开关 | 落地方式 | 说明 |
| --- | --- | --- |
| IGMP snooping | bridge `igmp_snooping` | netifd 直接支持 |
| IGMP proxy | `omcproxy` 的 `config proxy` 段 | 需要独立组播或 IGMP 上行 VLAN、机顶盒模式，且 omcproxy 已安装 |
| MLD snooping | 同上，**同一个内核开关** | 内核 `multicast_snooping` 同时管 IGMP 和 MLD，netifd 没有 `mld_snooping` 选项 → 取两者的或 |
| MLD proxy | 同上，**同一个代理实例** | omcproxy 一次同时代理 IGMPv3 与 MLDv2，无法只代理其中一种 |
| 组播查询器 | bridge `multicast_querier` | 不配查询器时 snooping 的组成员会超时断流 |

「上游连接」对应光猫界面里的 WAN 连接选择；本设备只有一条 PON 上联，因此用 VLAN 号表达，
即 `igmp_vlan`，留空时按组播 VLAN → 业务 VLAN 的顺序回落。

代理模式会改变网桥结构：`iptv-apply` 把组播/IGMP 子接口**移出** `br-iptv`，改为独立 interface
（`luci_iptv_mc` / `luci_iptv_igmp`）作为 omcproxy 的 uplink，`luci_iptv`（br-iptv）作为 downlink，
并新建一个全放行的 firewall zone 承载内核组播路由的 forward 流量。
单 VLAN（既无独立组播 VLAN 也无独立 IGMP 上行 VLAN）时无处可终止，脚本打日志并退回透明桥接。

#### 组播转单播（rtp2httpd）

本页**只写** rtp2httpd 的三个字段：`disabled`、`upstream_interface`、`port`。
频道列表、FCC（快速切台）、工作线程等参数留在各自程序的页面，本页只放跳转按钮，避免两处写同一个文件
互相覆盖。「中继程序设置」一行同时给出 **rtp2httpd / udpxy / msd_lite** 三个跳转：
rtp2httpd 是本页驱动的那个，udpxy 与 msd_lite 是可替换的其它中继程序，各有自己的页面、
**不由此处配置**（且只有装了对应软件包时跳转才可用）。

`upstream_interface` 必须是**能加入组播组的三层接口**，也就是网桥本身（`br-iptv` 或 `br-iptv-<vid>`），
**绝不能是网桥的成员端口**：作为 bridge slave 的端口收上来的帧不会交给本机协议栈，绑上去收不到组播。
所以中继要生效，网桥必须带 IP（`unicast_addr`），否则没有可用于 join 的源地址。

> **「上游设备」是推导出来的，不是让用户选的**——页面上它是只读的一行。`iptv-apply` 按 VLAN 配置
> 创建网桥，中继只能绑到已经存在的那个网桥上。
> ⚠️ 但**推导逻辑必须和 `resolve_unicast()` 逐分支对齐**，否则页面显示的与实际写入的不是同一个接口：
> 单线复用模式 → `br-iptv-<unicast_vlan ?? multicast ?? service>`；**组播代理激活时** → 代理的上联口
> （`ct-iptv-igmp` 或 `ct-iptv-mc`，因为该 VLAN 已从 `br-iptv` 里被拿出去终结了）；
> 其余 → `br-iptv`。早期版本漏了代理分支，代理开启时页面显示 `br-iptv`、脚本却写 `ct-iptv-mc`。

#### 中继 VLAN（`unicast_vlan`，可选）

单线复用是**唯一存在多个网桥**的模式：一个 VLAN 一个 `br-iptv-<vid>`。所以只有在这个模式下
"让中继听在另一个 VLAN 上"才是有意义的需求——例如机顶盒业务走 43、组播走 40，但希望中继听在 41 上
（41 上有可用的 IPTV 地址、或者专门给中继用）。

| 层 | 行为 |
| --- | --- |
| `/etc/config/iptv` | 新增 `option unicast_vlan ''`，留空即沿用原回落 |
| `iptv-apply` `resolve_unicast_vlan()` | 非空时：非 trunk 模式 → 警告并忽略；不是 1–4094 → `fail`；**不在 `TRUNK_VLAN_LIST` 里 → `fail`** |
| `iptv-apply` `resolve_unicast()` | trunk 分支改为 `unicast_vlan ?? multicast_vlan ?? service_vlan` |
| UI | `unicast_vlan` 字段 `depends({ enabled:'1', unicast:'1', mode:'trunk' })`；`trunkVlanList()` 镜像 `resolve_trunk_vlans()`，校验器拒绝不在列表里的值 |

> ⚠️ **必须校验 VLAN 确实在 `TRUNK_VLAN_LIST` 里，不能只校验取值范围。** 没有透传就没有
> `br-iptv-<vid>`，中继绑到一个不存在的网桥上一个包都收不到，而且这种失败是静默的——
> `rtp2httpd` 照常起来，只是没流。`fail` 而不是 `warn`：宁可应用失败，不要留下一个看起来正常的坏配置。
>
> ⚠️ **非 trunk 模式要 warn 后忽略、不能 fail。** 值本身是合法的，只是当前模式用不上；切回
> 单线复用时它还要生效。fail 会让用户被迫先清空才能保存别的改动。
>
> ⚠️ **只在 UI 加下拉而脚本不认，页面就会说谎**——选了 A 实际写 B，比没有这个选项更糟。
> schema、脚本、UI 三处必须同一次改动落地。

中继有**自己的 firewall zone**（`iptv_relay`，只含 `UNICAST_IFACE`）：firewall4 会丢弃没有 zone 的
接口上的入站流量，不给它 zone 的话 ONU 根本收不到自己 join 的组播。这个 zone 与代理的 `iptv` zone 分开，
因为两者语义不同——代理需要 `forward ACCEPT` 让内核做组播路由，中继只是在本机收流，所以 `forward REJECT`。
两者同时启用时中继监听在代理上行口上，该接口已在 `iptv` zone 里（一个接口不能同时属于两个 zone），
此时不再建 `iptv_relay`。

HTTP 监听端口不需要额外放行：rtp2httpd 监听 `0.0.0.0`，LAN 侧客户端走 `br-lan` 地址访问，
落在 lan zone 的 input ACCEPT 上。

#### 硬件加速：本平台没有组播卸载通道（已核实，勿再投入）

结论：**不要移植 `airoha_sdk/private/{gpon,xpon}_igmp`，也不要为组播找硬件卸载。**

- 那两个模块是 MediaTek/EcoNet 的内核态组播控制模块（IGMPv1/2/3 + MLDv1/2 的 snooping/proxy、
  静态与动态白名单 ACL、`check_max_group()` 每端口组数上限、CTC 规范行为、跨 VLAN 组播 VLAN 转换）。
  硬件部分在 `xpon_igmp/xpon_igmp_hw.c`，把组播流写进 **MediaTek HWNAT 的 FOE**
  （`hwnat_skb_to_foe_hook`）+ **MT7530** 交换口掩码（`macMT7530LanPortMap2Switch`）。
- 它们依赖 `ecnt_hook_pon_mac.h`、`ecnt_hook_pon_vlan.h`、`ecnt_hook_xpon_mapping.h`、
  `lan_port/lan_port_info.h`、`xpon_igmp_ioctl.h`——SDK 里连 `xpon_igmp_ioctl.h` 都没带，编译必然失败。
  我们的树（openwrt main + `target/linux/airoha`，kernel 6.18）里 `ecnt_hook` **零命中**；
  SDK 是 `arch/arm/mach-econet` 的 vendor BSP，驱动侧是 clean-room 重写的 `_pbs05-pon-drivers`，不提供这些 hook。
- 硬件也对不上：AN7581 用的是 **Airoha 自己的 PPE/NPU**（`CONFIG_NET_AIROHA_NPU=y`，mainline `airoha_eth`），
  XG2010G 设备树里没有 MT7530。
- 本平台唯一的卸载通道是 **netfilter flowtable → airoha PPE**（`airoha_ppe_flow_offload_cmd`）。
  flowtable **不卸载组播**（无 conntrack、无反向流），主线 airoha 驱动里除 MIB 统计外没有任何 multicast 卸载代码。
  rtp2httpd 这一侧同样吃不到：它的流量是本机产生的 HTTP，flowtable 只卸载 forward 的流，本机发出的不卸。
- 唯一相关的硬件开关是 `airoha_fe_init()` 里 `REG_FE_PCE_CFG` 的 `PCE_MC_EN_MASK`（组播复制一份给 CPU），
  v7.1 补丁已默认关闭。将来真要做 PPE 组播复制时要重新打开，否则 snooping/proxy 看不到报文。

**CPU 预算**：IPTV 组播通常几十 Mbps，Cortex-A53 软转发足够，不需要硬件卸载。

SDK 里真正值得借鉴的是**功能规格**而非代码：每端口最大组数、组播白名单、IGMPv3 的 SSM 源过滤、
CTC 的 fast-leave / leave retry。其中只有 fast-leave 能直接用（bridge 的 `multicast_fast_leave`），
其余需要内核态支持，纯 userspace + Linux bridge 做不到。

两边都要能触发对端重算拓扑：`/etc/init.d/iptv` 的 `service_triggers()` 同时挂了 `iptv` 和 `rtp2httpd`
两个 reload trigger——任一侧改动都会重新推导一遍网桥/子接口结构。

设备名长度受 netifd 与内核限制（≤15 字符）：`br-iptv-3169` 12、`ct-up3169` 9，均在限制内。

## 8. 本次改动文件

| 文件 | 改动 |
| --- | --- |
| `htdocs/.../view/onu/onu.css` | 新增：指标网格、指标瓦片、读数/单位、键值列表（含 `--split` / `--numeric`）、常显分组、折叠分组与条目数徽标、状态圆点、分组标题 |
| `htdocs/.../view/onu/status.js` | 重构为卡片 + 指标网格 + 状态点；线路详情改为常显键值列表，计数改为分组键值列表并折叠，保留轮询与展开态 |
| `htdocs/.../view/onu/hardware.js` | 底部由一张「校准数据」卡拆成两块：**「板载身份」**（身份字段按存储目标分组、逐个就地改写）+ **最下面「PON board data」**（移植自上游 `config.js`：目标存储 + 「下载备份」/「上传并写入」，目标多于一个时才出下拉）；两块**永远渲染**、缺数据时写原因；`loadIdentity()` 的每个 field read 各自 `.catch()`，单个字段读失败不再让整块消失；两个合成 section 用不同实例名（`board` / `image`）且 `anonymous = true`；ONU 身份仍按 EPON/GPON 分流 |
| `htdocs/.../view/onu/config.js` | 移除两个 ONU 身份标签页与「PON board data」上传卡片，只保留线路模式与认证/兼容性 |
| `htdocs/.../view/onu/iptv.js` | 由 `luci-app-iptv/view/iptv/config.js` 迁入并改为 PON 子页；四个 tab（bridge / IPv4 / IPv6 / 组播转单播），组播 VLAN 与 IGMP 上行 VLAN 归入 bridge tab 紧跟业务 VLAN；section 去掉重复的「IPTV」标题与说明（并入 Map 说明）；新增透传方式、Trunk 端口、要透传的 VLAN、组播转单播四个字段；新增「中继 VLAN」（仅单线复用，校验须在透传列表内）与 `trunkVlanList()`，`unicastUpstream()` 与之对齐；「中继程序设置」一行给出 rtp2httpd / udpxy / msd_lite 三个跳转 |
| `htdocs/.../view/onu/internet.js` | 新增：上网业务页（order 35，插在认证配置与 IPTV 之间）。单张 `form.Map('internet')` + `NamedSection('config')`，**不分 tab**，用 `depends()` 切换；字段：启用、上网方式（**桥接 / DHCP / 系统拨号三种**）、上联设备、VLAN、LAN 口（`MultiValue`，校验至少选 1 且与 IPTV 机顶盒口互斥）、IPoE、IP 版本（**IPv4 only / 双栈，DHCP 与 PPPoE 都显示**）、PPPoE 用户名 / 密码、MTU、`derivedDevices()` 只读派生设备行。**硬件卸载开关已移出本页** |
| `htdocs/.../view/onu/voice.js` | 新增：语音配置页（语音配置 / H.248 / SIP / 数图配置 / 线路设置 / 编码设置 六个 section，字段取自真机「宽带电话设置」与 `help.cgi?help=use_sip`） |
| `root/etc/config/voice` | 新增：`voice` / `h248` / `sip` / `digitmap` 四个配置段，两个 `line` 段（双 FXS 口）与八个 `codec` 段，同时作为该标签页的可见条件 |
| `root/etc/config/internet` | 新增：上网业务页的唯一数据源与标签页可见条件（`depends.uci.internet`）；`enabled` / `mode` / `uplink` / `vlan` / `ports` / `ipoe` / `ip_version` / `username` / `password` / `mtu` / `offload` |
| `root/usr/libexec/internet-apply` | 新增：把上述 UCI 翻译成 network / firewall / nftables 的后端。**三种**模式统一落在 `network.wan` 上；stock `wan`/`wan6` 用 `uci rename` 收起（保留原 option）而不是删除；桥接模式写 `ct-wanup` + `br-wanup` 并生成 `/etc/internet.nft`（`bridge` 家族按 EtherType `0x8863`/`0x8864` 过滤）；`dhcp` 模式写 DHCP，双栈时另写 `wan6`（DHCPv6 客户端）；`pppoe` 模式写 PPPoE **并且不再写 `wan6`**（IPv6 由会话协商，netifd 自起 `wan_6`），同时 `park_wan6()` 停泊现存 `wan6`、离开该模式时 `unpark_wan6()` 还原；卸载打开时额外写 `luci_wanup_uplink` 让真实设备进 flowtable；`firewall.luci_wanup` 为 `include`；页面关闭时按 `luci_wanup*` 前缀一键清扫并还原 stock 接口 |
| `root/etc/init.d/internet` | 新增：`START=18`（早于 network/firewall，与 sibling `iptv` 同构），procd 服务 + `procd_add_reload_trigger "internet"` |
| `root/usr/share/luci/menu.d/luci-app-onu.json` | 顶层标题 PON → ONU、order 85 → 5（排到「接口」之前）；子页本次新增 `admin/onu/internet`，order **35**（认证配置 30 与 IPTV 40 之间），`depends.uci.internet` |
| `root/usr/share/rpcd/acl.d/luci-app-onu.json` | 并入原 `luci-app-iptv` 的 uci iptv/network 与 network.device 权限；本次再把 uci `internet` 加入 read/write 列表 |
| `root/etc/config/iptv`、`root/etc/init.d/iptv`、`root/usr/libexec/iptv-apply` | 由 `luci-app-iptv` 整包迁入；新增 `mode` / `trunk_port` / `trunk_vlans` / `unicast` / `unicast_port` / `unicast_addr` / `unicast_vlan`，`iptv-apply` 重写为按模式推导拓扑，新增 `resolve_unicast_vlan()` 校验中继 VLAN 在 `TRUNK_VLAN_LIST` 内，并写 `/etc/config/rtp2httpd` |
| `Makefile` | 新增 `+firewall4 +kmod-nft-bridge +omcproxy` 依赖（IPTV 迁入），本次再加 `+kmod-nft-offload +ppp-mod-pppoe`（卸载与拨号），`PKG_RELEASE` 6 → 7 |
| `po/zh_Hans/onu.po` | 新增与更新译文，并入原 `iptv.po`；补齐单线复用与组播转单播的 27 条译文；本次再补上网业务页约 26 条（上网方式 / 桥接 / 系统拨号 / Internet VLAN / LAN ports / 硬件卸载 / Derived devices 等） |
| `luci-app-iptv/` | 整包删除 |

> 硬件身份页的依赖条件从「存在 `/tmp/pon-board-identity.available`」放宽为「存在 `pon` 配置」，
> 否则合并后没有板级身份的机型会整个丢掉 ONU 身份入口。板级身份与校准数据各自独立降级：
> `loadIdentity()` 失败返回 null、 `loadStorages()` 失败返回 `[]`，对应卡片自动隐藏，
> 互不牵连——校准数据取不到列表不会拖垮板级身份，反之亦然。

## 9. 改名：`luci-app-pon` → `luci-app-onu`（顶级菜单）

应用整体改名为 `luci-app-onu`，菜单从 `admin/network/pon` 提升为**顶级菜单** `admin/onu`。
**只改「包的身份」，不改「设备的身份」**：UCI 配置、后台脚本、守护进程与 ONU 侧的 `pon*` 名词一律不动。

### 改了什么

| 旧 | 新 | 备注 |
| --- | --- | --- |
| `luci-app-pon/`（目录） | `luci-app-onu/` | `luci.mk` 里 `PKG_NAME=$(notdir ${CURDIR})`，包名自动跟着变；`Makefile` 无需写 `LUCI_PKG_NAME`/`LUCI_APPNAME` |
| `htdocs/.../view/pon/` | `htdocs/.../view/onu/` | 视图路径同时变成 `onu/*` |
| `view/pon/pon.css` | `view/onu/onu.css` | 5 个页面的 `STYLESHEET` 常量同步改 |
| `menu.d/luci-app-pon.json` | `menu.d/luci-app-onu.json` | 节点 `admin/network/pon*` → `admin/onu*`，父节点新增 `admin/onu`（`order: 20`） |
| `acl.d/luci-app-pon.json` | `acl.d/luci-app-onu.json` | ACL 组名 `luci-app-pon` → `luci-app-onu`；权限清单不动 |
| `po/zh_Hans/pon.po` | `po/zh_Hans/onu.po` | i18n 包随之变成 `luci-i18n-onu-zh_Hans`；`.lmo` 文件名只影响安装名，运行时 `load_catalog()` 按语言加载目录下**全部** `*.{lang}.lmo`，所以改名不影响译文命中 |
| 菜单父节点 | `admin/network/pon` → `admin/onu` | 不再挂在 Network 下；`depends.acl` → `luci-app-onu`，`depends.uci` 保持 `pon` / `internet` / `iptv` / `voice` |

### 没改什么（故意保留）

- `/etc/config/*`：`pon`、`internet`、`iptv`、`voice`（改名不需要迁移 UCI 数据）
- 后台与工具：`ponctl`、`pondctl`、`pon-board-identity`、`airoha-pon-data`、`pon-identity-image`、
  `airoha-pon-debug` 等二进制与 `libexec` 脚本名
- CSS 类名 `.pon-*`：只做样式命名，与页面路径无关

> ⚠️ **升级提示**：sysupgrade 整包刷机没有残留问题；如果是在运行中的系统上直接 opkg 覆盖安装，
> 旧的 `/www/luci-static/resources/view/pon/` 与 `/usr/share/rpcd/acl.d/luci-app-pon.json`
> 不会被自动删除，会作为孤儿文件留在机子上，于是出现"旧菜单还在、点进去却找不到视图"。
> 手动清一次即可：
> `rm -rf /www/luci-static/resources/view/pon /usr/share/rpcd/acl.d/luci-app-pon.json`
> 再清索引缓存 `/etc/init.d/rpcd reload`（这一步包的 `postinst` 已经自带）。
