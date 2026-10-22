# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI PON optics and port rate overview card
LUCI_DEPENDS:=+luci-base +luci-mod-status +airoha-ponctl
PKG_VERSION:=0.1.0
PKG_RELEASE:=13

PKG_LICENSE:=Apache-2.0

# The card is a view include, not a menu page: it contributes
# htdocs/luci-static/resources/view/status/include/29a_pon.js, which the status
# overview page picks up by scanning that directory. It renders between the
# port status (29_ports.js) and network (30_network.js) cards and hides itself
# when no xpon line is configured, so it is safe on non-PON targets too.

define Package/luci-app-pon-status/postinst
[ -n "$${IPKG_INSTROOT}" ] || { \
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
