#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-port
PKG_VERSION:=1.0
PKG_RELEASE:=2

PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/openont-port
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenONT port binding (meta)
  DEPENDS:=+openont-core
  PKGARCH:=all
endef

define Package/openont-port/description
 Meta package for OpenONT port tools (provided by openont-core).
endef

define Build/Compile
endef

define Package/openont-port/install
	true
endef

$(eval $(call BuildPackage,openont-port))
