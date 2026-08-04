#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=OpenONT UI modules
LUCI_DESCRIPTION:=OpenONT status overview, application DPI, ports, portmap, DMZ and IP groups.
LUCI_DEPENDS:=+luci-base +luci-mod-status +openont-core +openont-stats
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_RELEASE:=10

# Force executable bits (Windows checkouts often lose +x).
# Install also overwrites stock status/overview.js (single install path).
define Build/Prepare/luci-mod-openont
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/openont
endef

define Package/luci-mod-openont/postinst
#!/bin/sh
ROOT="$${IPKG_INSTROOT}"
if [ -n "$${ROOT}" ]; then
	chmod 0755 "$${ROOT}/usr/libexec/rpcd/openont" 2>/dev/null || true
	if [ -f "$${ROOT}/www/luci-static/resources/view/openont/overview.js" ]; then
		mkdir -p "$${ROOT}/www/luci-static/resources/view/status"
		cp -f "$${ROOT}/www/luci-static/resources/view/openont/overview.js" \
			"$${ROOT}/www/luci-static/resources/view/status/overview.js"
	fi
else
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	chmod 0755 /usr/libexec/rpcd/openont 2>/dev/null || true
	if [ -f /www/luci-static/resources/view/openont/overview.js ]; then
		mkdir -p /www/luci-static/resources/view/status
		cp -f /www/luci-static/resources/view/openont/overview.js \
			/www/luci-static/resources/view/status/overview.js
	fi
	/etc/init.d/rpcd reload 2>/dev/null
fi
exit 0
endef

ifneq ($(wildcard $(TOPDIR)/feeds/luci/luci.mk),)
  include $(TOPDIR)/feeds/luci/luci.mk
else ifneq ($(wildcard $(TOPDIR)/package/feeds/luci/luci.mk),)
  include $(TOPDIR)/package/feeds/luci/luci.mk
else
  include $(INCLUDE_DIR)/package.mk

  define Package/luci-mod-openont
    SECTION:=luci
    CATEGORY:=LuCI
    SUBMENU:=1. Modules
    TITLE:=$(LUCI_TITLE)
    DEPENDS:=$(LUCI_DEPENDS)
    PKGARCH:=all
  endef

  define Package/luci-mod-openont/description
    $(LUCI_DESCRIPTION)
  endef

  define Build/Compile
  endef

  define Package/luci-mod-openont/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/openont
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/openont/*.js $(1)/www/luci-static/resources/view/openont/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/openont
	$(INSTALL_DATA) ./htdocs/luci-static/resources/openont/* $(1)/www/luci-static/resources/openont/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/openont/overview.js $(1)/www/luci-static/resources/view/status/overview.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/zzz-luci-mod-openont.json $(1)/usr/share/luci/menu.d/zzz-luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-mod-openont.json $(1)/usr/share/rpcd/acl.d/luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/openont $(1)/usr/libexec/rpcd/openont
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	if command -v po2lmo >/dev/null 2>&1 && [ -f ./po/zh_Hans/openont.po ]; then \
		po2lmo ./po/zh_Hans/openont.po $(1)/usr/lib/lua/luci/i18n/openont.zh-cn.lmo; \
	fi
  endef

  $(eval $(call BuildPackage,luci-mod-openont))
endif
