#
# Copyright (C) 2026 OpenONT
# SPDX-License-Identifier: GPL-2.0-only
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-stats
PKG_VERSION:=1.0
PKG_RELEASE:=3

PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/openont-stats
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenONT traffic stats daemon and RPC helpers
  DEPENDS:=+openont-dpi +jshn +jsonfilter +dnsmasq
  PKGARCH:=all
endef

define Package/openont-stats/description
  WAN rate sampling, DNS/IP app classification, history.jsonl,
  and ubus helpers (history / dpi_status) for OpenONT.
endef

define Build/Compile
endef

define Package/openont-stats/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/openont-statsd $(1)/usr/sbin/openont-statsd
	$(INSTALL_BIN) ./files/usr/sbin/openont-classify $(1)/usr/sbin/openont-classify
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/openont-stats $(1)/etc/init.d/openont-stats
	$(INSTALL_DIR) $(1)/usr/lib/openont
	$(INSTALL_DATA) ./files/usr/lib/openont/stats-paths.sh $(1)/usr/lib/openont/stats-paths.sh
	$(INSTALL_DATA) ./files/usr/lib/openont/stats_rpc.sh $(1)/usr/lib/openont/stats_rpc.sh
	$(INSTALL_DIR) $(1)/usr/share/openont
	$(INSTALL_DATA) ./files/usr/share/openont/buckets.schema $(1)/usr/share/openont/buckets.schema
	$(INSTALL_DATA) ./files/usr/share/openont/buckets.sh $(1)/usr/share/openont/buckets.sh
	$(INSTALL_DATA) ./files/usr/share/openont/buckets.json $(1)/usr/share/openont/buckets.json
	$(INSTALL_DATA) ./files/usr/share/openont/buckets.gen.h $(1)/usr/share/openont/buckets.gen.h
	$(INSTALL_DATA) ./files/usr/share/openont/app-class.conf $(1)/usr/share/openont/app-class.conf
endef

define Package/openont-stats/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
chmod 0755 /usr/sbin/openont-statsd /usr/sbin/openont-classify /etc/init.d/openont-stats 2>/dev/null || true
/etc/init.d/openont-stats enable 2>/dev/null || true
/etc/init.d/openont-stats restart 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,openont-stats))
