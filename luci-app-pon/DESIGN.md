# luci-app-pon 界面设计说明

## 1. 设计原则：跟随 Argon，不自建设计系统

luci-theme-argon 已经提供了完整的调色板、字体栈、卡片与表单样式。PON 页面**不引入第二套设计系统**，
所有颜色与字体都通过主题变量解析，因此浅色/深色主题、用户自定义主色都能自动生效。

luci-app-pon 只补充主题没有提供的三样东西，全部集中在 `view/pon/pon.css`（约 100 行）：

| 类名 | 用途 | 为什么主题不够用 |
| --- | --- | --- |
| `.pon-grid` | 自适应指标网格 | Argon 内嵌 Pure 的 `.pure-u-*` 是固定宽度，小屏不换行 |
| `.pon-tile` | 指标卡片（含计数项） | 主题只有整块 `cbi-section`，没有小尺寸指标瓦片 |
| `.pon-dot` / `.pon-state` | 状态圆点 | 主题没有状态指示件 |
| `.pon-fold` | 折叠指标组 | 主题的 `details` 无间距，且旧写法内部是表格，风格与瓦片割裂 |
| `.pon-subhead` | 卡片内分组标题 | 主题只给 `.cbi-section > h4:first-child` 加了间距 |

复用（零新增样式）：`.cbi-map`、`.cbi-section`、`.cbi-section-descr`、`.cbi-value`、
`.cbi-value-title`、`.cbi-value-field`、`.cbi-input-text`、`.cbi-input-invalid`、
`.ifacebadge`、`.cbi-page-actions`、`.cbi-button-action`、`.pull-right`、`details/summary`。

> **统一性约束**：状态页不使用 `.table`。所有数值、状态与计数项一律走 `.pon-tile`，
> 只是放在常显网格还是折叠组里的区别——避免同一页出现「卡片 + 表格」两套视觉语言。

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
| 说明文字 | `.cbi-section-descr`，small / 1.5 行高 | 卡片说明、字段描述 |
| 标识值 | `<var>`（主题：斜体 `#0069d6`） | ONU-ID、LLID、序列号、各类 ID |

`<var>` 是主题自带的等宽语义样式（对比度约 4.6:1，满足 AA），用于承载所有需要抄写的标识值，
比自己写一个 `.monospace` 更省也更一致。

## 4. 布局与断点

- 容器：`.cbi-map`（主题已为 flex 列 + 1rem 间距），卡片即 `.cbi-section`（白底、圆角、阴影）。
- 指标网格：`grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr))`，**无需媒体查询即可自适应**；
  仅在 ≤30rem（约 480px）时显式降为单列，避免小屏挤压。
- 表单行：`.cbi-value` + `.cbi-value-title`（右对齐固定宽）+ `.cbi-value-field`，沿用主题表单节奏。
- 移动端优先：先保证 320px 单列可用，再向上增强为多列。

## 5. 组件清单与状态

| 组件 | 实现 | 状态 |
| --- | --- | --- |
| 模式/协议徽章 | `.ifacebadge` | 静态文本（XGS-PON / OMCI / EPON OAM） |
| 状态指示 | `.pon-state` + `.pon-dot[data-state]` | ok / pending / error / 灰 |
| 指标瓦片 | `dl.pon-tile` + `dt` + `dd` | 值缺失显示「未知」，计数项也用它 |
| 折叠指标组 | `details.pon-fold[data-pon-details]` + 内部 `.pon-grid` | 轮询重建后保持展开态 |
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
3. **配置认证** `pon/config`
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

每张 PON 线路 = **一张卡片**：标题（线路名 + 模式徽章 + 线路状态点）→ 说明 → **常显指标网格**
（线路状态、光信号、收/发光功率、光模块温度、ONU 状态或 MPCP 状态）
→ 折叠「线路详情」网格（模式、配置状态、PHY/PCS、ONU-ID 或 LLID0、数据通路、业务就绪等）
→ 折叠「计数与诊断」网格（EPON 与 ITU-T 各自的计数项、校准状态、发射门）。

> **排序原则：状态优先于标识。** 常显网格只放"看一眼就知道线通不通"的量——
> 即设备状态（ONU state / MPCP state）和实时光功率这类会随链路变化的量。
> ONU-ID / LLID0 这类**分配下来的编号**只在注册成功后才有意义、且不随链路状态变化，
> 一律下沉到「线路详情」折叠里，需要排查时再展开。

层级由**折叠**表达，而不是由「换一种组件」表达：三层全是同一种瓦片，因此不存在风格割裂。
OMCI / EPON OAM 同为「常显指标网格 + 折叠『协议详情』网格」，并按线路模式只显示对应协议的那一张。

### 硬件身份页（板级数据与 ONU 身份统一入口）

| 区块 | 数据来源 | 说明 |
| --- | --- | --- |
| 板级身份 | `pon-board-identity`（Flash） | 按存储目标分组，独立「写入板级身份」按钮，重启后生效 |
| 校准数据 | `airoha-pon-data`（Flash） | 上传校验镜像写入所选目标，原镜像另存 `/tmp/pon-board-data.*.bin` |
| ONU 身份 — OMCI | UCI `pon.omci` | 仅当线路为 **GPON / XG-PON / XGS-PON** 时显示 |
| ONU 身份 — EPON OAM | UCI `pon.oam` | 仅当线路为 **EPON / 10G-EPON** 时显示 |

卡片顺序即上表顺序：先板级（身份 → 校准），再按线路模式分流的上报身份。
板级身份与校准数据都取自 Flash、都要重启生效，因此放在一起；
`airoha-pon-data list` 取不到目标时该卡片自动隐藏，不影响其余区块。

两个 ONU 身份区块都由 `s.filter` 按 `xpon.mode` 生效（与状态页同一套 `isEponMode()` 判据），
并在区块内显示「PON 线路」和「线路模式」两个只读字段，避免多线路设备上认错区块。
EPON 与 GPON 的字段集合不同（EPON 多了 ONU 短型号、固件版本、芯片 ID、以太网口数量，
且各字段长度上限不同），因此分两个 section 而不是合并成一个。

原 configuration 页的两个「ONU identity」标签页已移除，改为在该分区留下指向硬件身份页的说明。
原 configuration 页末尾的「PON board data」上传卡片也已移入硬件身份页，改名为「校准数据」
（它是写进 Flash 的校准镜像，性质与板级身份同类；config 页只留一行指向说明）。

### 语音配置页

`view/pon/voice.js` 是一张 `form.Map('voice')`，按运营商光猫「应用 → 宽带电话设置」的三个子页
（语音配置 / 数图配置 / 线路设置）组织成四个 section，顺序与设备一致：

| Section | 类型 | 内容 |
| --- | --- | --- |
| 语音配置 | `NamedSection('config','voice')` | 启用、语音协议、DTMF 转移模式、PayLoad 类型值、来电显示、拍叉时间间隔上下限、催挂音/忙音/久叫不应时间、Codec 协商规则、传真编码方式 |
| H.248 | `NamedSection('h248','h248')` | 四个 tab：基本配置（编码类型、主备服务器地址与端口、MG 注册方式、域名、MG 端口、授权方式、物理端点前缀）、资源（RTP 临时端点前缀/起始/对齐模式/数字长度/数目）、高级配置（ACK 消息、长定时器、PENDING 定时器、重传定时器、重传次数/间隔/时长、重注册周期）、心跳（模式、周期、次数） |
| 数图配置 | `NamedSection('digitmap','digitmap')` | 启用拨号计划、匹配模式（最大/最小匹配）、摘机不拨号时间、拨号短定时器、拨号长定时器、数图（多行文本） |
| 线路设置 | `TypedSection('line')` | 每个 FXS 端口：启用、线路终端 ID、呼出增益、呼入增益、开启回声抑制 |
| 编码设置 | `TableSection('codec')` | 每个端口的 codec 列表：语音端口、编码、打包时长、优先级 |

字段与取值来自真机（中国移动 ONT，`voice_config.cgi?v=prof|dmap|line`）实测抓取，
命名沿用 TR-104/CT 前缀（`X_CT_COM_*`、`X_ASB_COM_*` 之外的公开字段），
但 UCI 里统一改为小写下划线：例如 `X_CT_COM_ServerType` → `protocol`（`h248`/`sip`/`ims_sip`）。

注意点：

- 设备原始值是数字/驼峰（`InBand`、`ASN.1`、`RemoteFirst`），除协议类型外尽量保留原始取值，
  便于将来直接喂给守护进程，不再做一次映射；
- `dtmf_payload` 只在 `dtmf_method == RFC2833` 时显示，心跳周期/次数在心跳模式非「关闭」时显示，
  都用 `o.depends()`，隐藏字段不参与校验；
- 拍叉时间上下限用自定义 `validate` 比较（最小值留空时报的是「必填」，不重复报错）；
- 增益是 `range(-14,6)`，LuCI 的 `range()` 支持负数；
- 线路端口用 `TypedSection`（端口是硬件决定的，允许增删），codec 用 `TableSection`（一端口多行）；
- 页面只读性仍走 `m.readonly = !L.hasViewPermission()`，rpcd ACL 已预留 uci `voice` 的读写，不用再改。

菜单可见条件是 `depends.uci.voice`，即 `/etc/config/voice` 存在——该文件已随包安装，所以现在就能看到标签页。

### IPTV 页

一张卡片：`form.Map('iptv')` → 单个 `NamedSection('config')`，标题「IPTV」，卡内四个 tab：

| Tab | 字段 |
| --- | --- |
| IPTV bridge | PON interfaces（只读）、启用、IPTV LAN 口（只列 `lanN`）、上联设备、业务 VLAN |
| IPv4 | 启用 IGMP snooping、启用 IGMP proxy、启用组播查询器 |
| IPv6 | 启用 MLD snooping、启用 MLD proxy |
| 组播 VLAN | 组播 VLAN、上游连接（IGMP 上行 VLAN） |

用 `s.tab()` + `s.taboption()` 分组，而不是拆成多张卡片：运营商光猫的 IGMP 面板就是
「IPv4 / IPv6 / 组播VLAN」三个小分组挤在一个页面里，tab 既还原了这个结构，又保持「一页一卡片」。
注意一旦定义了 tab，就必须用 `taboption()`，`option()` 添加的字段不会被渲染。
除启用开关外所有字段 `depends('enabled','1')`；`depends` 按字段 id 匹配，与 tab 无关，跨 tab 依然生效。
页面加载共享的 `pon.css`，卡片/说明/表单行全部沿用主题，不新增样式。

#### Option 与 OpenWrt 能力的对应关系（四个开关不是都能独立实现）

| 开关 | 落地方式 | 说明 |
| --- | --- | --- |
| IGMP snooping | bridge `igmp_snooping` | netifd 直接支持 |
| IGMP proxy | `omcproxy` 的 `config proxy` 段 | 需要独立组播或 IGMP 上行 VLAN，且 omcproxy 已安装 |
| MLD snooping | 同上，**同一个内核开关** | 内核 `multicast_snooping` 同时管 IGMP 和 MLD，netifd 没有 `mld_snooping` 选项 → 取两者的或 |
| MLD proxy | 同上，**同一个代理实例** | omcproxy 一次同时代理 IGMPv3 与 MLDv2，无法只代理其中一种 |
| 组播查询器 | bridge `multicast_querier` | 不配查询器时 snooping 的组成员会超时断流 |

「上游连接」对应光猫界面里的 WAN 连接选择；本设备只有一条 PON 上联，因此用 VLAN 号表达，
即 `igmp_vlan`，留空时按组播 VLAN → 业务 VLAN 的顺序回落。

代理模式会改变网桥结构：`iptv-apply` 把组播/IGMP 子接口**移出** `br-iptv`，改为独立 interface
（`luci_iptv_mc` / `luci_iptv_igmp`）作为 omcproxy 的 uplink，`luci_iptv`（br-iptv）作为 downlink，
并新建一个全放行的 firewall zone 承载内核组播路由的 forward 流量。
单 VLAN（既无独立组播 VLAN 也无独立 IGMP 上行 VLAN）时无处可终止，脚本打日志并退回透明桥接。

## 8. 本次改动文件

| 文件 | 改动 |
| --- | --- |
| `htdocs/.../view/pon/pon.css` | 新增：指标网格、指标瓦片、状态圆点、分组标题 |
| `htdocs/.../view/pon/status.js` | 重构为卡片 + 指标网格 + 状态点，保留轮询与展开态 |
| `htdocs/.../view/pon/hardware.js` | 合并板级身份、校准数据与 ONU 身份，按 EPON/GPON 分流 |
| `htdocs/.../view/pon/config.js` | 移除两个 ONU 身份标签页与「PON board data」上传卡片，只保留线路模式与认证/兼容性 |
| `htdocs/.../view/pon/iptv.js` | 由 `luci-app-iptv/view/iptv/config.js` 迁入并改为 PON 子页；新增 IPv4 / IPv6 / 组播 VLAN 三个 tab 与四个 snooping/proxy 开关 |
| `htdocs/.../view/pon/voice.js` | 新增：语音配置页（语音配置 / H.248 / 数图配置 / 线路设置 / 编码设置 五个 section，字段取自真机「宽带电话设置」） |
| `root/etc/config/voice` | 新增：`voice` / `h248` / `digitmap` 三个配置段与 `line`、`codec` 段，同时作为该标签页的可见条件 |
| `root/usr/share/luci/menu.d/luci-app-pon.json` | 顶层标题 PON → ONU、order 85 → 5（排到「接口」之前）；子页顺序改为状态 / 硬件身份 / 配置认证 / IPTV / 语音配置 / 网络诊断 |
| `root/usr/share/rpcd/acl.d/luci-app-pon.json` | 并入原 `luci-app-iptv` 的 uci iptv/network 与 network.device 权限 |
| `root/etc/config/iptv`、`root/etc/init.d/iptv`、`root/usr/libexec/iptv-apply` | 由 `luci-app-iptv` 整包迁入 |
| `Makefile` | 新增 `+firewall4 +kmod-nft-bridge` 依赖，`PKG_RELEASE` 4 |
| `po/zh_Hans/pon.po` | 新增与更新译文，并入原 `iptv.po` |
| `luci-app-iptv/` | 整包删除 |

> 硬件身份页的依赖条件从「存在 `/tmp/pon-board-identity.available`」放宽为「存在 `pon` 配置」，
> 否则合并后没有板级身份的机型会整个丢掉 ONU 身份入口。板级身份与校准数据各自独立降级：
> `loadIdentity()` 失败返回 null、 `loadStorages()` 失败返回 `[]`，对应卡片自动隐藏，
> 互不牵连——校准数据取不到列表不会拖垮板级身份，反之亦然。
