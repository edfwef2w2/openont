#
# Copyright (C) 2026 OpenONT
#
# SPDX-License-Identifier: GPL-2.0-only
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-dns
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=OpenONT

include $(INCLUDE_DIR)/package.mk

define Package/openont-dns
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenONT DNS forwarder, filter and web acceleration
  DEPENDS:=+openont-core +libmbedtls +ca-bundle +nftables-json +uclient-fetch
endef

define Package/openont-dns/description
  LAN DNS forwarder with rule filtering, upstream groups and
  optional HTTPS acceleration for listed names.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -Wall -Wextra -O2 \
		-o $(PKG_BUILD_DIR)/openont-dnsd \
		$(PKG_BUILD_DIR)/dnsd.c \
		$(PKG_BUILD_DIR)/dns_proto.c \
		$(PKG_BUILD_DIR)/rules.c \
		$(PKG_BUILD_DIR)/cache.c \
		$(PKG_BUILD_DIR)/bogus.c \
		$(PKG_BUILD_DIR)/upstream.c \
		$(PKG_BUILD_DIR)/upstream_tls.c \
		$(TARGET_LDFLAGS) -lmbedtls -lmbedx509 -lmbedcrypto -lpthread
	$(TARGET_CC) $(TARGET_CFLAGS) -Wall -Wextra -O2 \
		-o $(PKG_BUILD_DIR)/openont-tlsfront \
		$(PKG_BUILD_DIR)/tlsfront.c \
		$(PKG_BUILD_DIR)/sni.c \
		$(PKG_BUILD_DIR)/dns_proto.c \
		$(TARGET_LDFLAGS) -lmbedtls -lmbedx509 -lmbedcrypto -lpthread
endef

define Package/openont-dns/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/openont-dnsd $(1)/usr/sbin/openont-dnsd
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/openont-tlsfront $(1)/usr/sbin/openont-tlsfront
	$(INSTALL_BIN) ./files/usr/sbin/openont-dns $(1)/usr/sbin/openont-dns
	$(INSTALL_DIR) $(1)/usr/lib/openont
	$(INSTALL_DATA) ./files/usr/lib/openont/dns.sh $(1)/usr/lib/openont/dns.sh
	$(INSTALL_BIN) ./files/usr/lib/openont/dns-refresh.sh $(1)/usr/lib/openont/dns-refresh.sh
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/openont-dns $(1)/etc/init.d/openont-dns
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./files/etc/config/openont-dns $(1)/etc/config/openont-dns
endef

define Package/openont-dns/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
chmod 0755 /usr/sbin/openont-dns /usr/sbin/openont-dnsd /usr/sbin/openont-tlsfront \
	/usr/lib/openont/dns-refresh.sh /etc/init.d/openont-dns 2>/dev/null || true
/etc/init.d/openont-dns enable 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,openont-dns))
