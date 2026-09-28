# luci-app-pon 界面设计说明

## 1. 设计原则：跟随 Argon，不自建设计系统

luci-theme-argon 已经提供了完整的调色板、字体栈、卡片与表单样式。PON 页面**不引入第二套设计系统**，
所有颜色与字体都通过主题变量解析，因此浅色/深色主题、用户自定义主色都能自动生效。

luci-app-pon 只补充主题没有提供的东西，全部集中在 `view/pon/pon.css`（约 230 行）：

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

菜单挂在 `admin/network/pon`（路径不变），**显示名为 ONU**，`order` 为 5，排在所有网络子菜单之前。
子页顺序（自上而下）：

1. **状态** `pon/status`
2. **硬件身份** `pon/hardware`
3. **认证配置** `pon/config`
4. **IPTV** `pon/iptv`
5. **语音配置** `pon/voice`
6. **网络诊断** `pon/diagnostics`

> ⚠️ **`order: 5` 的副作用**：`admin/network` 是 luci-base 定义的
> `{"type":"firstchild","recurse":true}`，没有 `preferred`，所以点顶部「网络」会落到
> **排序最靠前的那个叶子**——现在就是 ONU → 状态页，而不是原来的「接口」页
> （`admin/network/network`，order 10；无线 15、switch 20、路由 30、DHCP 40、DNS 45、诊断 50）。
> 在 ONU 设备上这通常是想要的；若想保留「网络 → 接口」，把本节点的 order 改成 11 即可
> （夹在接口 10 与无线 15 之间）。
> 另外别试图在自己的 menu.d 里重写 `admin/network` 的 action：菜单文件按文件名排序后
> 后者覆盖前者，`luci-app-pon.json` 排在 `luci-base.json` 之前，写了也会被盖掉。

IPTV 原本是独立的 `luci-app-iptv` 包（菜单挂在 `admin/network/iptv`），现已整体并入
`luci-app-pon` 成为第四个子页：`/etc/config/iptv`、`/etc/init.d/iptv`、`iptv-apply`
与 ACL 全部随包迁移，ACL 合并为单一 `luci-app-pon` 条目。原因是它配置的正是
「把 LAN 口桥接到 PON 上联承载的运营商 VLAN」，本来就是 PON 业务的一部分；
代价是 `luci-app-pon` 现在依赖 `firewall4` 与 `kmod-nft-bridge`。
IPTV 页只在 `/etc/config/iptv` 存在时显示（`depends.uci`）。

### 状态页

每张 PON 线路 = **一张卡片**，自上而下三层，密度递减：

1. **常显指标网格** `.pon-grid`（瓦片）：线路状态、光信号、收/发光功率、光模块温度，
   以及 ONU 状态 / MPCP 状态。收发光功率与温度用 `.pon-num` + `.pon-unit`，数字压过单位。
2. **常显「线路详情」** `.pon-block` + `.pon-list`（键值行，**不折叠**）：线路模式三项、
   PHY/PCS、ONU-ID 或 LLID0、数据通路、业务就绪、突发发射机就绪。
3. **折叠「计数与诊断」** `details.pon-fold`：按主题分组的计数行——
   「链路事件」「帧计数」（ITU-T）或「注册过程」（EPON）、「光模块」；
   展开后是 `.pon-list--split`（宽屏每行两对）而非十几块瓦片。

> **为什么线路详情不再折叠**：它回答的是"这条线是不是按我预期配置的"，与常显指标
> 一起读，藏进折叠里等于逼用户每次都点开。真正只在排障时才看的是计数，所以只有它折叠。

> **排序原则：状态优先于标识。** 常显网格只放"看一眼就知道线通不通"的量——
> 即设备状态（ONU state / MPCP state）和实时光功率这类会随链路变化的量。
> ONU-ID / LLID0 这类**分配下来的编号**只在注册成功后才有意义、且不随链路状态变化，
> 一律放在「线路详情」里。

层级由**密度**表达：瓦片（有边框有阴影）→ 键值行（只有发丝分隔线），折叠只改变可见性、
不改变语言，因此展开折叠不会突然换一种组件。
OMCI / EPON OAM 同为「常显指标网格 + 折叠『协议详情』键值列表」，并按线路模式只显示对应协议的那一张。

### 硬件身份页（板级数据与 ONU 身份统一入口）

| 区块 | 数据来源 | 说明 |
| --- | --- | --- |
| 校准数据（含板级身份） | `pon-board-identity` + `airoha-pon-data`（Flash） | **一张卡片**：身份字段按存储目标分组（每组一个「写入板级身份」）+ 末尾一个「校准镜像」分组（唯一一个「上传并写入」） |
| ONU 身份 — OMCI | UCI `pon.omci` | 仅当线路为 **GPON / XG-PON / XGS-PON** 时显示 |
| ONU 身份 — EPON OAM | UCI `pon.oam` | 仅当线路为 **EPON / 10G-EPON** 时显示 |

**板级身份与校准数据本来就是同一个东西**，所以合成一张卡片「校准数据」：两者都通过
`board.json` 的 `pon_data` 定位存储目标，`pon-board-identity write` 是读出镜像后
**按 offset 就地改写字段**再写回，`airoha-pon-data write` 则是**整份镜像替换**。

一台设备只有**一个** `pon_data` 目标（DSD 分区），因此页面上：

- **不做目标选择器**——下拉永远只有一项，是噪音；分区名与容量由 `airoha-pon-data list`
  的 label 显示在身份分组的标题上（`存储目标：DSD · MTD · 128 KiB`），校准镜像就写它；
- 也不存在"只能写校准、没有身份字段"的目标，所以分组只在 `identity.targets` 声明了字段时出现；
- 全卡**只有一个**「上传并写入」，放在卡片末尾的「校准镜像」分组里，与身份分组分开——
  它是整份替换，与"改几个字段"不是一个量级的操作。

> ⚠️ 两个动作共用一份镜像：**写校准镜像会覆盖同一目标里的身份字段**。这不是能靠 UI 规避的，
> 所以在卡片说明里直接写明，而不是把两者藏在不同的卡片里假装无关。

降级仍然是各自独立：`pon-board-identity list` 失败 → 只剩存储目标与上传按钮；
`airoha-pon-data list` 失败 → 只剩身份目标与写入按钮；两者都失败 → 整张卡片隐藏，
不影响下面的 ONU 身份区块。

两个 ONU 身份区块都由 `s.filter` 按 `xpon.mode` 生效（与状态页同一套 `isEponMode()` 判据），
并在区块内显示「PON 线路」和「线路模式」两个只读字段，避免多线路设备上认错区块。
EPON 与 GPON 的字段集合不同（EPON 多了 ONU 短型号、固件版本、芯片 ID、以太网口数量，
且各字段长度上限不同），因此分两个 section 而不是合并成一个。

原 configuration 页的两个「ONU identity」标签页已移除，改为在该分区留下指向硬件身份页的说明。
原 configuration 页末尾的「PON board data」上传卡片也已移入硬件身份页，改名为「校准数据」
（它是写进 Flash 的校准镜像，性质与板级身份同类；config 页只留一行指向说明）。

### 语音配置页

`view/pon/voice.js` 是一张 `form.Map('voice')`，按运营商光猫「应用 → 宽带电话设置」的三个子页
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

### IPTV 页

一张卡片：`form.Map('iptv')` → 单个 `NamedSection('config')`，标题「IPTV」，卡内五个 tab：

| Tab | 字段 |
| --- | --- |
| IPTV bridge | PON interfaces（只读）、启用、透传方式、IPTV LAN 口 / Trunk 端口、要透传的 VLAN、上联设备、业务 VLAN |
| IPv4 | 启用 IGMP snooping、启用 IGMP proxy、启用组播查询器 |
| IPv6 | 启用 MLD snooping、启用 MLD proxy |
| 组播 VLAN | 组播 VLAN、上游连接（IGMP 上行 VLAN） |
| 组播转单播 | 把组播中继为 HTTP 单播、HTTP 端口、中继地址、上游设备（只读）、频道列表与快速切台（跳转按钮） |

用 `s.tab()` + `s.taboption()` 分组，而不是拆成多张卡片：运营商光猫的 IGMP 面板就是
「IPv4 / IPv6 / 组播VLAN」三个小分组挤在一个页面里，tab 既还原了这个结构，又保持「一页一卡片」。
注意一旦定义了 tab，就必须用 `taboption()`，`option()` 添加的字段不会被渲染。

`depends()` 的语义是这里最容易踩的坑：**一次传对象 = 与**（`o.depends({ enabled: '1', mode: 'trunk' })`），
**多次调用 = 或**。所以「启用且机顶盒模式」必须写成对象形式，写成两次 `depends()` 会变成「启用或机顶盒模式」。
页面加载共享的 `pon.css`，卡片/说明/表单行全部沿用主题，不新增样式。

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
频道列表、FCC（快速切台）、工作线程等参数留在 rtp2httpd 自己的页面，本页只放一个跳转按钮，
避免两处写同一个文件互相覆盖。

`upstream_interface` 必须是**能加入组播组的三层接口**，也就是网桥本身（`br-iptv` 或 `br-iptv-<vid>`），
**绝不能是网桥的成员端口**：作为 bridge slave 的端口收上来的帧不会交给本机协议栈，绑上去收不到组播。
所以中继要生效，网桥必须带 IP（`unicast_addr`），否则没有可用于 join 的源地址。

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
| `htdocs/.../view/pon/pon.css` | 新增：指标网格、指标瓦片、读数/单位、键值列表（含 `--split` / `--numeric`）、常显分组、折叠分组与条目数徽标、状态圆点、分组标题 |
| `htdocs/.../view/pon/status.js` | 重构为卡片 + 指标网格 + 状态点；线路详情改为常显键值列表，计数改为分组键值列表并折叠，保留轮询与展开态 |
| `htdocs/.../view/pon/hardware.js` | 板级身份与校准数据合并为一张「校准数据」卡片：身份字段按存储目标分组（每组一个「写入板级身份」），末尾一个「校准镜像」分组承载唯一的「上传并写入」，无目标选择器；写入身份改为按目标生效；ONU 身份仍按 EPON/GPON 分流 |
| `htdocs/.../view/pon/config.js` | 移除两个 ONU 身份标签页与「PON board data」上传卡片，只保留线路模式与认证/兼容性 |
| `htdocs/.../view/pon/iptv.js` | 由 `luci-app-iptv/view/iptv/config.js` 迁入并改为 PON 子页；五个 tab（bridge / IPv4 / IPv6 / 组播 VLAN / 组播转单播），新增透传方式、Trunk 端口、要透传的 VLAN、组播转单播四个字段 |
| `htdocs/.../view/pon/voice.js` | 新增：语音配置页（语音配置 / H.248 / SIP / 数图配置 / 线路设置 / 编码设置 六个 section，字段取自真机「宽带电话设置」与 `help.cgi?help=use_sip`） |
| `root/etc/config/voice` | 新增：`voice` / `h248` / `sip` / `digitmap` 四个配置段，两个 `line` 段（双 FXS 口）与八个 `codec` 段，同时作为该标签页的可见条件 |
| `root/usr/share/luci/menu.d/luci-app-pon.json` | 顶层标题 PON → ONU、order 85 → 5（排到「接口」之前）；子页顺序改为状态 / 硬件身份 / 认证配置 / IPTV / 语音配置 / 网络诊断 |
| `root/usr/share/rpcd/acl.d/luci-app-pon.json` | 并入原 `luci-app-iptv` 的 uci iptv/network 与 network.device 权限 |
| `root/etc/config/iptv`、`root/etc/init.d/iptv`、`root/usr/libexec/iptv-apply` | 由 `luci-app-iptv` 整包迁入；新增 `mode` / `trunk_port` / `trunk_vlans` / `unicast` / `unicast_port` / `unicast_addr`，`iptv-apply` 重写为按模式推导拓扑并写 `/etc/config/rtp2httpd` |
| `Makefile` | 新增 `+firewall4 +kmod-nft-bridge +omcproxy` 依赖，`PKG_RELEASE` 6 |
| `po/zh_Hans/pon.po` | 新增与更新译文，并入原 `iptv.po`；补齐单线复用与组播转单播的 27 条译文 |
| `luci-app-iptv/` | 整包删除 |

> 硬件身份页的依赖条件从「存在 `/tmp/pon-board-identity.available`」放宽为「存在 `pon` 配置」，
> 否则合并后没有板级身份的机型会整个丢掉 ONU 身份入口。板级身份与校准数据各自独立降级：
> `loadIdentity()` 失败返回 null、 `loadStorages()` 失败返回 `[]`，对应卡片自动隐藏，
> 互不牵连——校准数据取不到列表不会拖垮板级身份，反之亦然。
