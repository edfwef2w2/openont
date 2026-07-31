#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=OpenONT UI modules
LUCI_DESCRIPTION:=OpenONT status overview, ports, portmap, DMZ and IP groups.
LUCI_DEPENDS:=+luci-base +luci-mod-status +openont-core
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_RELEASE:=4

# Force executable bits (Windows checkouts often lose +x).
# Also stamp OpenONT dashboard over stock status/overview.js in the build tree
# so luci.mk packaging never ships the original overview.
define Build/Prepare/luci-mod-openont
	chmod 0755 \
		$(PKG_BUILD_DIR)/root/usr/libexec/rpcd/openont \
		$(PKG_BUILD_DIR)/root/etc/init.d/openont-stats \
		$(PKG_BUILD_DIR)/root/usr/sbin/openont-statsd \
		$(PKG_BUILD_DIR)/root/usr/sbin/openont-appclass
	mkdir -p $(PKG_BUILD_DIR)/htdocs/luci-static/resources/view/status
	cp -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/view/openont/overview.js \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/view/status/overview.js
endef

# Defined before luci.mk so its default postinst is not used (ifndef guard).
define Package/luci-mod-openont/postinst
#!/bin/sh
ROOT="$${IPKG_INSTROOT}"
if [ -n "$${ROOT}" ]; then
	chmod 0755 \
		"$${ROOT}/usr/libexec/rpcd/openont" \
		"$${ROOT}/etc/init.d/openont-stats" \
		"$${ROOT}/usr/sbin/openont-statsd" \
		"$${ROOT}/usr/sbin/openont-appclass" 2>/dev/null || true
	# Image root: always overwrite stock overview with OpenONT dashboard
	if [ -f "$${ROOT}/www/luci-static/resources/view/openont/overview.js" ]; then
		mkdir -p "$${ROOT}/www/luci-static/resources/view/status"
		cp -f "$${ROOT}/www/luci-static/resources/view/openont/overview.js" \
			"$${ROOT}/www/luci-static/resources/view/status/overview.js"
	fi
else
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	chmod 0755 \
		/usr/libexec/rpcd/openont \
		/etc/init.d/openont-stats \
		/usr/sbin/openont-statsd \
		/usr/sbin/openont-appclass 2>/dev/null || true
	# Live device: kill stock overview if luci-mod-status reinstalled it
	if [ -f /www/luci-static/resources/view/openont/overview.js ]; then
		mkdir -p /www/luci-static/resources/view/status
		cp -f /www/luci-static/resources/view/openont/overview.js \
			/www/luci-static/resources/view/status/overview.js
	fi
	/etc/init.d/rpcd reload 2>/dev/null
	if [ -x /etc/init.d/openont-stats ]; then
		/etc/init.d/openont-stats enable 2>/dev/null || true
		/etc/init.d/openont-stats restart 2>/dev/null || true
	fi
fi
exit 0
endef

# Use LuCI build rules when the luci feed is present (i18n via po2lmo).
ifneq ($(wildcard $(TOPDIR)/feeds/luci/luci.mk),)
  include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage is handled by luci.mk
else ifneq ($(wildcard $(TOPDIR)/package/feeds/luci/luci.mk),)
  include $(TOPDIR)/package/feeds/luci/luci.mk
else
  # Fallback without feeds: install package only (no luci-i18n-* auto packages).
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
	# Overwrite stock luci-mod-status overview with the OpenONT dashboard
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/openont/overview.js $(1)/www/luci-static/resources/view/status/overview.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/zzz-luci-mod-openont.json $(1)/usr/share/luci/menu.d/zzz-luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-mod-openont.json $(1)/usr/share/rpcd/acl.d/luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/openont $(1)/usr/libexec/rpcd/openont
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/openont-stats $(1)/etc/init.d/openont-stats
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./root/usr/sbin/openont-statsd $(1)/usr/sbin/openont-statsd
	$(INSTALL_BIN) ./root/usr/sbin/openont-appclass $(1)/usr/sbin/openont-appclass
	$(INSTALL_DIR) $(1)/usr/share/openont
	$(INSTALL_DATA) ./root/usr/share/openont/app-class.conf $(1)/usr/share/openont/app-class.conf
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	if command -v po2lmo >/dev/null 2>&1 && [ -f ./po/zh_Hans/openont.po ]; then \
		po2lmo ./po/zh_Hans/openont.po $(1)/usr/lib/lua/luci/i18n/openont.zh-cn.lmo; \
	fi
  endef

  $(eval $(call BuildPackage,luci-mod-openont))
endif
