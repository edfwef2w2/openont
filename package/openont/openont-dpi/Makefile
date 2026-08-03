#
# Copyright (C) 2026 OpenONT
#
# SPDX-License-Identifier: GPL-2.0-only
#

include $(TOPDIR)/rules.mk

PKG_NAME:=openont-dpi
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=OpenONT

include $(INCLUDE_DIR)/package.mk

define Package/openont-dpi
  SECTION:=net
  CATEGORY:=Network
  TITLE:=OpenONT userspace DPI classifier (NFQUEUE)
  DEPENDS:=+libnetfilter-queue +libmnl +libnfnetlink +kmod-nfnetlink-queue +kmod-nft-queue +nftables
endef

define Package/openont-dpi/description
  Userspace deep packet inspection for OpenONT traffic distribution.
  Classifies flows via TLS SNI, HTTP Host and L7 signatures on NFQUEUE,
  then sticks a category label for openont-statsd byte accounting.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -Wall -Wextra -O2 \
		-o $(PKG_BUILD_DIR)/openont-dpi \
		$(PKG_BUILD_DIR)/openont-dpi.c \
		$(PKG_BUILD_DIR)/classify.c \
		$(TARGET_LDFLAGS) -lnetfilter_queue -lnfnetlink -lmnl
endef

define Package/openont-dpi/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/openont-dpi $(1)/usr/sbin/openont-dpi
	$(INSTALL_DIR) $(1)/usr/share/openont
	$(INSTALL_DATA) ./files/dpi-buckets.conf $(1)/usr/share/openont/dpi-buckets.conf
	$(INSTALL_DIR) $(1)/usr/lib/openont
	$(INSTALL_BIN) ./files/dpi-nft.sh $(1)/usr/lib/openont/dpi-nft.sh
endef

$(eval $(call BuildPackage,openont-dpi))
