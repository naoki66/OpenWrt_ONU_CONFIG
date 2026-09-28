# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI PON configuration
# firewall4 and kmod-nft-bridge are required by the IPTV bridge: iptv-apply
# writes /etc/iptv.nft and reloads the firewall whenever the bridge changes.
LUCI_DEPENDS:=+luci-base +airoha-ponctl +airoha-pond \
	+mtd +ubi-utils +nand-utils +jshn +jsonfilter \
	+firewall4 +kmod-nft-bridge
PKG_VERSION:=0.1.0
PKG_RELEASE:=5

PKG_LICENSE:=Apache-2.0 GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
