# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI PON optics, port rate and connection counters (overview card)
LUCI_DEPENDS:=+luci-base +luci-mod-status +airoha-ponctl
PKG_VERSION:=0.1.0
PKG_RELEASE:=11

PKG_LICENSE:=Apache-2.0

# The card is a view include, not a menu page: it contributes
# htdocs/luci-static/resources/view/status/include/29a_pon.js, which the status
# overview page picks up by scanning that directory. It renders between the
# port status (29_ports.js) and network (30_network.js) cards and hides itself
# when no xpon line is configured, so it is safe on non-PON targets too.

# ponstat-conn must keep its executable bit: luci.mk copies root/ with $(CP),
# so the mode recorded in git is what ends up on the target. The postinst
# chmod is a safety net for trees that lost the bit along the way.
define Package/luci-app-pon-status/postinst
[ -n "$${IPKG_INSTROOT}" ] || { \
	chmod 0755 /usr/sbin/ponstat-conn 2>/dev/null; \
	rm -f /tmp/luci-indexcache.*; \
	rm -rf /tmp/luci-modulecache/; \
	/etc/init.d/rpcd reload 2>/dev/null; \
	exit 0; \
}
endef

define Package/luci-app-pon-status/prerm
[ -n "$${IPKG_INSTROOT}" ] || { \
	rm -f /tmp/luci-indexcache.*; \
	rm -rf /tmp/luci-modulecache/; \
	exit 0; \
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage: feed scanner marker; luci.mk generates the package rules.
