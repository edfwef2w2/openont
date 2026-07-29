#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-mod-openont
PKG_VERSION:=1.1
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/luci-mod-openont
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=1. Modules
  TITLE:=OpenONT UI modules
  DEPENDS:=+luci-base +openont-core
  PKGARCH:=all
endef

define Package/luci-mod-openont/description
 OpenONT overview, ports, portmap, DMZ and IP groups.
endef

define Build/Compile
endef

define Package/luci-mod-openont/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/openont
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/openont/*.js $(1)/www/luci-static/resources/view/openont/
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
endef

$(eval $(call BuildPackage,luci-mod-openont))
