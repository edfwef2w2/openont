#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-openont
PKG_VERSION:=1.0
PKG_RELEASE:=2

PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-openont
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  TITLE:=OpenONT theme
  DEPENDS:=+luci-base
  # Satisfy luci meta package theme dependency without shipping bootstrap.
  PROVIDES:=luci-theme-bootstrap
  PKGARCH:=all
endef

define Package/luci-theme-openont/description
 OpenONT management UI theme (blue header, left sidebar).
endef

define Build/Compile
endef

define Package/luci-theme-openont/install
	$(INSTALL_DIR) $(1)/www/luci-static/openont
	$(CP) ./htdocs/luci-static/openont/* $(1)/www/luci-static/openont/
	$(INSTALL_DIR) $(1)/usr/share/ucode/luci/template/themes/openont
	$(CP) ./ucode/template/themes/openont/* $(1)/usr/share/ucode/luci/template/themes/openont/
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/30_luci-theme-openont $(1)/etc/uci-defaults/30_luci-theme-openont
endef

define Package/luci-theme-openont/postinst
#!/bin/sh
# Live install: force theme. Image builds rely on uci-defaults (30 + 99).
if [ -z "$${IPKG_INSTROOT}" ]; then
	uci -q batch <<-EOF
		set luci.themes.OpenONT=/luci-static/openont
		set luci.main.mediaurlbase=/luci-static/openont
		delete luci.themes.Bootstrap
		commit luci
	EOF
	rm -f /tmp/luci-indexcache.* 2>/dev/null
	rm -rf /tmp/luci-modulecache/ 2>/dev/null
fi
exit 0
endef

$(eval $(call BuildPackage,luci-theme-openont))
