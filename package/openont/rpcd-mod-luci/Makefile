#
# Copyright (C) 2016-2017 Jo-Philipp Wich <jo@mein.io>
# Copyright (C) 2026 OpenONT
#
# Licensed under the Apache License, Version 2.0.
#
# OpenONT copy of luci/libs/rpcd-mod-luci with the iwinfo backend removed.
# Being a core package, it takes precedence over the luci feed's version
# (scripts/feeds will not override it), so no iwinfo headers are needed.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=rpcd-mod-luci
PKG_VERSION:=20261111
PKG_RELEASE:=1
PKG_MAINTAINER:=OpenONT

PKG_LICENSE:=Apache-2.0

PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

TARGET_CFLAGS += \
	-I$(STAGING_DIR)/usr/include/libnl-tiny \
	-I$(STAGING_DIR)/usr/include

CMAKE_OPTIONS += \
	-DLIBNL_LIBS=-lnl-tiny

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/rpcd-mod-luci
  SECTION:=libs
  CATEGORY:=Libraries
  TITLE:=LuCI rpcd module (OpenONT, no wireless)
  DEPENDS:=+rpcd +libubox +libubus +libuci +libnl-tiny
endef

define Package/rpcd-mod-luci/description
 Provides LuCI backend ubus RPC operations.
 OpenONT build: getWirelessDevices always returns an empty object.
endef

define Package/rpcd-mod-luci/install
	$(INSTALL_DIR) $(1)/usr/lib/rpcd
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/luci.so $(1)/usr/lib/rpcd/
endef

define Package/rpcd-mod-luci/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,rpcd-mod-luci))
