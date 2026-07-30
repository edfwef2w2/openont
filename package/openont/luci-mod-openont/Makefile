#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=OpenONT UI modules
LUCI_DESCRIPTION:=OpenONT status overview, ports, portmap, DMZ and IP groups.
LUCI_DEPENDS:=+luci-base +luci-mod-status +openont-core
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0

# luci.mk installs root/ via "cp -pR" (preserves mode). Force +x on
# rpcd/init/sbin so ubus object "openont" is always registered even if
# git file modes are wrong (common on Windows checkouts).
define Build/Prepare/luci-mod-openont
	chmod 0755 \
		$(PKG_BUILD_DIR)/root/usr/libexec/rpcd/openont \
		$(PKG_BUILD_DIR)/root/etc/init.d/openont-stats \
		$(PKG_BUILD_DIR)/root/usr/sbin/openont-statsd
endef

# Defined before luci.mk so its default postinst is not used (ifndef guard).
# chmod under IPKG_INSTROOT for image builds; reload rpcd on live devices.
define Package/luci-mod-openont/postinst
#!/bin/sh
if [ -n "$${IPKG_INSTROOT}" ]; then
	chmod 0755 \
		"$${IPKG_INSTROOT}/usr/libexec/rpcd/openont" \
		"$${IPKG_INSTROOT}/etc/init.d/openont-stats" \
		"$${IPKG_INSTROOT}/usr/sbin/openont-statsd" 2>/dev/null || true
else
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	chmod 0755 \
		/usr/libexec/rpcd/openont \
		/etc/init.d/openont-stats \
		/usr/sbin/openont-statsd 2>/dev/null || true
	/etc/init.d/rpcd reload 2>/dev/null
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
	# Replace stock status overview with OpenONT dashboard
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/status/overview.js $(1)/www/luci-static/resources/view/status/overview.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-mod-openont.json $(1)/usr/share/luci/menu.d/luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-mod-openont.json $(1)/usr/share/rpcd/acl.d/luci-mod-openont.json
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/openont $(1)/usr/libexec/rpcd/openont
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/openont-stats $(1)/etc/init.d/openont-stats
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./root/usr/sbin/openont-statsd $(1)/usr/sbin/openont-statsd
	# Install zh-cn catalogue when po2lmo is available on the build host.
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	if command -v po2lmo >/dev/null 2>&1 && [ -f ./po/zh_Hans/openont.po ]; then \
		po2lmo ./po/zh_Hans/openont.po $(1)/usr/lib/lua/luci/i18n/openont.zh-cn.lmo; \
	fi
  endef

  $(eval $(call BuildPackage,luci-mod-openont))
endif
