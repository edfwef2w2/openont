#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-base
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/openont-base
  SECTION:=base
  CATEGORY:=Base system
  TITLE:=OpenONT product defaults
  DEPENDS:=+openont-core +openont-stats +luci-base +luci-theme-openont +luci-mod-openont
  PKGARCH:=all
endef

define Package/openont-base/description
 Product defaults and first-boot setup for OpenONT gateways.
endef

define Build/Compile
endef

define Package/openont-base/install
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-openont-defaults $(1)/etc/uci-defaults/99-openont-defaults
	$(INSTALL_DIR) $(1)/etc/profile.d
	$(INSTALL_DATA) ./files/etc/profile.d/openont.sh $(1)/etc/profile.d/openont.sh
endef

$(eval $(call BuildPackage,openont-base))
