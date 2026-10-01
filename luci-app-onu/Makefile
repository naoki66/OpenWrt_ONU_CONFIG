# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

# PKG_NAME comes from the directory name: luci.mk sets
#   LUCI_NAME=$(notdir ${CURDIR}) -> luci-app-onu, PKG_NAME=$(LUCI_NAME)
# so nothing here needs renaming after the luci-app-pon -> luci-app-onu rename.
# The i18n package follows LUCI_BASENAME, i.e. luci-i18n-onu-<lang>.
LUCI_TITLE:=LuCI ONU configuration
# firewall4 and kmod-nft-bridge are required by the IPTV bridge: iptv-apply
# writes /etc/iptv.nft and reloads the firewall whenever the bridge changes.
# omcproxy backs the IGMP/MLD proxy switches; it proxies IGMPv3 and MLDv2 as a
# single instance and relies on kernel multicast routing (CONFIG_IP_MROUTE /
# CONFIG_IPV6_MROUTE). Drop it from LUCI_DEPENDS if the target has no
# multicast routing support.
# rtp2httpd backs the multicast-to-unicast tab. It is deliberately NOT a hard
# dependency: iptv-apply only writes the three fields it owns and logs a
# warning when the package is missing, so the relay tab degrades quietly.
# Add +rtp2httpd here if the target always ships the relay.
# The internet page needs pppd for the dialling mode, the bridge family of
# nftables for its EtherType filter and the netfilter flowtable for hardware
# offloading: without kmod-nft-offload the PPE never sees a flow.
LUCI_DEPENDS:=+luci-base +airoha-ponctl +airoha-pond \
	+mtd +ubi-utils +nand-utils +jshn +jsonfilter \
	+firewall4 +kmod-nft-bridge +kmod-nft-offload +omcproxy +ppp-mod-pppoe
PKG_VERSION:=0.1.0
# 10: the shipped voice configuration drops the two line sections - the board has
# a single FXS port, so its parameters moved into the voice profile.
# 11: onu-voice.config.enabled is gone. Nothing ever read it, so the page now
# has one switch only: onu-voice.network.enabled, the flag voice-apply reads.
# 12: register the top-level ONU menu independently of UCI and ACL state.
# 13: keep every ONU submenu visible; page code reports missing configuration
# or backend helpers instead of hiding the menu entry. Keep the parent action
# as firstchild so themes render it as an expandable menu.
# 14: hide the fixed internet uplink from LuCI while keeping the UCI and apply
# defaults at pon0.
# 15: omit single-port line, interface and protocol section identifiers from
# the status page while retaining them internally for backend data matching.
# 16: complete Simplified Chinese translations for the latest status,
# diagnostics and internet labels.
# 17: use an ONU-specific translation key for the Authentication menu so it
# is not overridden by the generic LuCI translation.
# 18: prefix every submenu translation key with ONU to avoid collisions with
# generic menu labels supplied by other LuCI applications.
# 19: namespace the internet, IPTV and voice UCI packages as onu-* to avoid
# collisions with configurations owned by other applications.
PKG_RELEASE:=19

PKG_LICENSE:=Apache-2.0 GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
