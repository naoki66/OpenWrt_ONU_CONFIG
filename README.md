# OpenWrt ONU 用户态配置栈

面向 Airoha PON SoC（EN75xx 系列）的 OpenWrt 用户态软件包：OMCI/OAM 协议代理、线路控制、抓包诊断，
以及整合 PON 状态、板级身份、认证、上网、IPTV、语音与诊断的顶级 **ONU** LuCI 菜单。

An OpenWrt userspace stack for Airoha PON SoCs (EN75xx): an OMCI/OAM agent, line control,
diagnostics, and a top-level **ONU** LuCI menu for identity, authentication, internet, IPTV and VoIP.

> Fork 自 [pbs05/openwrt-pon-userspace](https://github.com/pbs05/openwrt-pon-userspace)，之后做了大量
> 重构与扩展（分叉点 `cce9d75`）。
> Forked from [pbs05/openwrt-pon-userspace](https://github.com/pbs05/openwrt-pon-userspace) and heavily
> reworked since merge base `cce9d75`.

## 软件包 / Packages

| 软件包 / Package | 版本 | 用途 / Purpose |
| --- | --- | --- |
| `airoha-pond` | 0.3.0 | OMCI（GPON/XG/XGS-PON）与 OAM（EPON/10G-EPON）协议代理 / OMCI and OAM agent |
| `airoha-ponctl` | 0.2.0 | 线路模式、身份、状态与数据通路配置 / Line control |
| `airoha-pon-debug` | 0.1.0 | 状态、日志与抓包诊断 / Diagnostics and capture |
| `luci-app-onu` | 0.1.0 | ONU 菜单：状态、硬件身份、认证、上网、IPTV、语音、诊断 / LuCI ONU menu |

## 主要特性 / Highlights

- **认证二选一**：LOID 与 Password（Registration-ID）显式区分；仅在确有 LOID 时上报 CTC LOID ME，
  修复 password-only 线路 O5 反复掉线。
  / Explicit LOID vs Password auth; the CTC LOID ME is advertised only when a LOID exists.
- **顶级 ONU 菜单**（`admin/onu`）七个子页，不依赖 UCI/rpcd 状态始终可见，完整简体中文翻译。
  / A top-level ONU node with seven pages, always registered, fully localized into Simplified Chinese.
- **硬件身份**：Flash 身份字段（SN/MAC）就地改写，与板级身份镜像整份备份/写入同一入口。
  / In-place Flash identity editing plus full-image backup/restore.
- **上网**：桥接 / DHCP / PPPoE 三种上联与业务 VLAN；nftables EtherType 过滤、stock WAN 可逆停泊、
  PPE flowtable 硬件卸载。
  / Bridge, DHCP or PPPoE uplink with EtherType filtering, reversible WAN parking and PPE offload.
- **IPTV**：机顶盒端口桥接或单线复用（每 VLAN 独立网桥）、IGMP/MLD snooping/proxy、组播转单播中继。
  / Port bridge or per-VLAN trunk, IGMP/MLD proxy and multicast-to-unicast relay.
- **语音**：H.248 / SIP / IMS SIP、FXS 参数、数图与 Codec，参数模型来自运营商光猫实机抓包。
  / H.248/SIP/IMS SIP voice profile captured from a carrier ONT.

界面设计决策见 [luci-app-onu/DESIGN.md](luci-app-onu/DESIGN.md)，板级身份布局见 [IDENTITY.md](IDENTITY.md)，
代理配置与 CLI 见 [airoha-pon-daemons/README.md](airoha-pon-daemons/README.md)。

## 与上游的差异 / Changes relative to upstream

- `luci-app-pon` 重命名为 `luci-app-onu` 并提升为顶级菜单；`/etc/config/pon` 名称不变。
  / Renamed to `luci-app-onu` and promoted to a top-level menu.
- 吸收独立的 `luci-app-iptv` 包，业务配置统一命名空间为 `onu-internet` / `onu-iptv` / `onu-voice`。
  / Merged `luci-app-iptv`; business configs namespaced as `onu-*`.
- 新增上网、语音页面及其后端（`internet-apply`、`voice-apply`、nftables 规则），IPTV 页大幅扩展。
  / Added internet and voice pages with backends; expanded IPTV.
- 重构硬件身份页与 Argon 风格状态页；协议代理新增 `auth_mode` 并修正空 LOID 误上报。
  / Reworked hardware/status pages; added `auth_mode` and fixed empty-LOID advertisement.

## 致谢 / Acknowledgments

感谢上游 [pbs05/openwrt-pon-userspace](https://github.com/pbs05/openwrt-pon-userspace) 及全体贡献者：
**pbs05**（用户态 PON 栈作者）、[nyacat](https://github.com/nyacat)（线路掉线处理、华为 OLT 兼容、抓包）、
[22p](https://github.com/22p)、[Hideo Suzumiya](https://github.com/HideoSuzumiya)、
[lotusmomo](https://github.com/lotusmomo)（界面与 CTC LOID/OMCI 修正）。

Thanks to the upstream project and its contributors: **pbs05**, **nyacat**, **22p**,
**Hideo Suzumiya** and **lotusmomo**.

## 许可证 / License

Rust 组件与 `airoha-pon-debug` 为 GPL-2.0-only；`luci-app-onu` 为 Apache-2.0 / GPL-2.0-only 双许可。
完整文本见 [LICENSES](LICENSES/)。

Rust components and `airoha-pon-debug`: GPL-2.0-only. `luci-app-onu`: Apache-2.0 / GPL-2.0-only.
See [LICENSES](LICENSES/).
