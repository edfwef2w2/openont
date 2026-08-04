#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-openont
PKG_VERSION:=2.0
PKG_RELEASE:=3

PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-openont
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  TITLE:=OpenONT Blue-White Sidebar theme
  DEPENDS:=+luci-base
  PKGARCH:=all
endef

define Package/luci-theme-openont/description
 OpenONT management UI: blue-white left sidebar with light/dark toggle.
 Sole LuCI theme for OpenONT images (no stock theme packages).
endef

define Build/Compile
endef

define Package/luci-theme-openont/install
	$(INSTALL_DIR) $(1)/www/luci-static/openont
	$(CP) ./htdocs/luci-static/openont/* $(1)/www/luci-static/openont/
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(CP) ./htdocs/luci-static/resources/* $(1)/www/luci-static/resources/
	$(INSTALL_DIR) $(1)/usr/share/ucode/luci/template/themes/openont
	$(CP) ./ucode/template/themes/openont/* $(1)/usr/share/ucode/luci/template/themes/openont/
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/30_luci-theme-openont $(1)/etc/uci-defaults/30_luci-theme-openont
endef

define Package/luci-theme-openont/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	uci -q set luci.themes.OpenONT=/luci-static/openont
	uci -q set luci.main.mediaurlbase=/luci-static/openont
	for opt in $$(uci -q show luci.themes 2>/dev/null | sed -n 's/^luci\.themes\.\([^=]*\)=.*/\1/p'); do
		[ "$$opt" = "OpenONT" ] && continue
		uci -q delete luci.themes.$$opt
	done
	uci -q commit luci
	rm -f /tmp/luci-indexcache.* 2>/dev/null
	rm -rf /tmp/luci-modulecache/ 2>/dev/null
fi
exit 0
endef

$(eval $(call BuildPackage,luci-theme-openont))
