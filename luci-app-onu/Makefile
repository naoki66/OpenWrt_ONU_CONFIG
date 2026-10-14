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
#
# kmod-nf-conntrack-bridge is the bridge-offload companion: the bridge family
# flowtable only produces a hardware entry when the bridge conntrack has parsed
# the frame, and it only parses an inner PPPoE / 802.1q encapsulation when the
# flow sits in a non-default conntrack zone. internet-apply sets that zone on
# every frame crossing br-wanup; without this package the `nft -c` probe fails
# and the bridge silently stays in the software path.
LUCI_DEPENDS:=+luci-base +airoha-ponctl +airoha-pond \
	+mtd +ubi-utils +nand-utils +jshn +jsonfilter \
	+firewall4 +kmod-nft-bridge +kmod-nft-offload +kmod-nf-conntrack-bridge \
	+omcproxy +ppp-mod-pppoe
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
# 20: hide parked stock WAN sections, reuse anonymous WAN zones and force-link
# the generated PON WAN so netifd does not reject it before carrier appears.
# 21: align voice with the managed luci_* / ct-* network topology and migrate
# the legacy voice_device section on the next apply.
# 22: add voice bridge/trunk delivery modes, port/vlan conflict guards
# across voice/iptv/internet, and card visibility tied to mode.
# 23: fix board identity save on current LuCI (capture before save()
# re-renders), refresh flash values in place, gate the UCI apply
# countdown on real staged changes, and default the OMCI vendor ID to
# the serial number's first four characters.
# 24: UNTAG transparent mode inlines the raw uplink into br-wanup instead of
# nesting a ct-wanup bridge in it (the Airoha kernel rejects bridge-on-bridge);
# the Internet VLAN row is hidden rather than disabled in UNTAG, because a
# disabled required field still failed validation; bridge ports are handed back
# to br-lan when bridge mode is left, so they are not orphaned; Simplified
# Chinese translations cover the transparent mode labels.
# 25: close the remaining gaps in LAN port ownership. iptv-apply now refuses
# ports the internet bridge owns (its detach sweep would otherwise steal them
# from br-wanup), internet-apply also refuses the IPTV trunk port, and
# voice-apply loads network last so detach_lan_port() no longer walks the
# wrong UCI package and silently detaches nothing. Every script skips ports
# another service still bridges when handing ports back to br-lan, and all
# three pages drop taken ports from their pickers.
PKG_RELEASE:=25

PKG_LICENSE:=Apache-2.0 GPL-2.0-only

# Scripts under root/usr/libexec and root/etc/init.d must keep their executable
# bit - 0755 in git. luci.mk copies root/ with $(CP), which preserves the mode,
# so the mode recorded in git is what ends up on the target (0775 there, from
# the build umask). Never move these to INSTALL_DATA: a non-executable
# internet-apply silently disables the whole internet page, and the same applies
# to iptv-apply / voice-apply. If the sources are ever shipped through the image
# files/ overlay instead of the package, add an explicit chmod 0755 in the build
# step - a plain shell redirect there creates the file with the umask and drops
# the x bit (0644/0664), which is exactly how it can be lost.

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
