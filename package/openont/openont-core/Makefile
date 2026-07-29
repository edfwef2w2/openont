#
# Copyright (C) 2026 OpenONT
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-core
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/openont-core
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenONT shared CLI and libraries
  DEPENDS:=+uci +netifd +firewall4 +jshn +jsonfilter
endef

define Package/openont-core/description
 Shared libraries and console tools for ports, NAT, offload and PPPoE.
endef

define Build/Compile
endef

define Package/openont-core/install
	$(INSTALL_DIR) $(1)/usr/lib/openont
	$(INSTALL_DATA) ./files/usr/lib/openont/common.sh $(1)/usr/lib/openont/common.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/port.sh $(1)/usr/lib/openont/port.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/nat.sh $(1)/usr/lib/openont/nat.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/ipgroup.sh $(1)/usr/lib/openont/ipgroup.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/offload.sh $(1)/usr/lib/openont/offload.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/pppoe.sh $(1)/usr/lib/openont/pppoe.sh
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/openont-port $(1)/usr/sbin/openont-port
	$(INSTALL_BIN) ./files/usr/sbin/openont-nat $(1)/usr/sbin/openont-nat
	$(INSTALL_BIN) ./files/usr/sbin/openont-ipgroup $(1)/usr/sbin/openont-ipgroup
	$(INSTALL_BIN) ./files/usr/sbin/openont-offload $(1)/usr/sbin/openont-offload
	$(INSTALL_BIN) ./files/usr/sbin/openont-pppoe $(1)/usr/sbin/openont-pppoe
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./files/etc/config/openont $(1)/etc/config/openont
endef

$(eval $(call BuildPackage,openont-core))
