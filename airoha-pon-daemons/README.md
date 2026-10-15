# airoha-pond

`airoha-pond` provides OMCI for GPON-family modes and OAM for EPON-family modes.

`airoha-pond` 为 GPON 系列提供 OMCI，为 EPON 系列提供 OAM。

## Configuration / 配置

Configuration is stored in `/etc/config/pon`.

配置文件为 `/etc/config/pon`。

```uci
config xpon 'line0'
	option device 'pon0'
	option mode 'xgpon'
	option carrier 'auto'
	option onu_type '1'
	option carrier_spec ''
	option serial_number 'ABCD12345678'
	option registration_id ''

config omci 'line0_omci'
	option line 'line0'
	option device 'omci0'
	option omcc_version '0xb0'
	option disable_enhanced_security '0'
	option alloc_id_timeout '30'
	option vendor_id 'ABCD'
	option equipment_id ''
	option model ''
	option hardware_version ''
	option software_version ''
	option operator_id 'CTC'
	option loid ''
	option loid_password ''

config oam 'line0_oam'
	option line 'line0'
	option device 'oam0'
	option operator 'ctc'
	option ctc_oui '111111'
	option ctc_versions '21 30'
	option vendor_id ''
	option model ''
	option equipment_id ''
	option hardware_version ''
	option software_version ''
	option firmware_version ''
	option chipset_id ''
	option loid ''
	option loid_password ''
	option ge_ports '1'
```

`mode` accepts `xgpon`, `xgspon`, `epon-10g-1g` and `epon-10g-10g`. An empty value keeps the current driver mode. `omcc_version` accepts `0x86`, `0xa0`, `0xa8`, `0xb0` and `0xb4`, in either case, and defaults to `0xb0`.

`carrier` selects which carrier ONU capability ME the line offers, and `onu_type` is the class reported in it: `0` SFU, `1` HGU, `2` SBU, defaulting to HGU, the class this userspace implements. The capability ME is the entity an OLT reads to pick its provisioning template, and the carriers do not share one: Telecom defines class `0xFFF9` (operator ID `CTC`) and Unicom `0xFFB1` (operator ID `CUC`), both carrying the operator ID, the spec version, the ONU type and the Tx power supply control in that order. `auto` offers both and lets each OLT read its own class; `ctc` and `cuc` offer one; `cmcc` offers none, because neither the Realtek OMCI reference nor the Airoha OMCI adapter implements a China Mobile capability ME, so a Mobile line keeps the standard MIB and the OLT its own template. `carrier_spec` overrides the spec version byte each carrier ships (Telecom `0`, Unicom `3`); empty follows the carrier default. Changing any of them takes effect when the PON interface restarts.

`mode` 支持 `xgpon`、`xgspon`、`epon-10g-1g` 和 `epon-10g-10g`。空值使用驱动当前模式。`omcc_version` 支持 `0x86`、`0xa0`、`0xa8`、`0xb0` 和 `0xb4`（大小写不限），默认 `0xb0`。

`carrier` 选择这条线提供哪家运营商的 ONU 能力（ONU capability）ME，`onu_type` 是其中上报的 ONU 类型：`0` SFU、`1` HGU、`2` SBU，默认 HGU（本用户态实际实现的类型）。OLT 读的正是这个能力 ME 来决定开局模板，而三家运营商并不共用同一个：电信为 `0xFFF9`（operator ID `CTC`），联通为 `0xFFB1`（operator ID `CUC`），两者属性顺序相同——operator ID、规范版本、ONU 类型、Tx 供电控制。`auto` 同时提供两者，各 OLT 只读自己那一类；`ctc`、`cuc` 只提供对应的一类；`cmcc` 不提供——Realtek OMCI 参考实现与 Airoha OMCI 适配库都没有移动的能力 ME，因此移动线路保持标准 MIB，类型由 OLT 自身模板决定。`carrier_spec` 覆盖各运营商自带的规范版本字节（电信 `0`、联通 `3`），留空即用默认值。以上选项都在 PON 接口重启后生效。

`alloc_id_timeout` is the number of seconds an OMCI data path may wait for PLOAM to assign its Alloc-ID before the data path state becomes `alloc-id-timeout`. The kernel keeps the request, so a later assignment still applies it. `0` disables the timeout.

`alloc_id_timeout` 是 OMCI 数据通道等待 PLOAM 分配 Alloc-ID 的秒数，超时后数据通道状态变为 `alloc-id-timeout`。内核仍保留该请求，之后分配到时照常生效。`0` 表示不超时。

The identity options (`vendor_id`, `equipment_id`, `model`, `hardware_version`, `software_version`) describe the unit itself, so an empty value is read from the running system instead of being reported as a placeholder: the vendor ID follows the vendor bytes of the serial number the line registers with, the equipment ID, model and hardware version follow the board model name, and the software version follows the release of the running image (`/etc/openwrt_release`, for example `23.05.4`, or its revision on a development build). A value set here always wins; the placeholders only appear on a unit that cannot answer for itself. On the EPON side the same rule fills `vendor_id`, `software_version` and `firmware_version`; `model`, `hardware_version` and `chipset_id` are CTC's own fixed-width codes and keep their defaults.

身份字段（`vendor_id`、`equipment_id`、`model`、`hardware_version`、`software_version`）描述的是这台设备本身，因此留空时按运行中的系统取值，而不是上报占位常量：厂商 ID 取这条线注册所用序列号的厂商字节，设备标识、设备型号与硬件版本取板型名称，软件版本取当前镜像的发布版本（`/etc/openwrt_release`，如 `23.05.4`；开发版取修订号）。此处显式填写的值始终优先，占位值只在设备自己也答不上来时才出现。EPON 侧同样处理 `vendor_id`、`software_version`、`firmware_version`；`model`、`hardware_version`、`chipset_id` 是 CTC 自己的定长编码，保持原有默认值。

## CLI

```sh
/etc/init.d/airoha-pond restart

pondctl status --line line0
pondctl datapath --line line0
pondctl events --line line0
pondctl events --line line0 --after 42
```

Run one line in the foreground / 前台运行指定线路：

```sh
airoha-pond --line line0
```
