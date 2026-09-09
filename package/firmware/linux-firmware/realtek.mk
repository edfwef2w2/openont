Package/r8152-firmware = $(call Package/firmware-default,RealTek RTL8152 firmware)
define Package/r8152-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/rtl_nic
	$(CP) \
		$(PKG_BUILD_DIR)/rtl_nic/rtl8153* \
		$(PKG_BUILD_DIR)/rtl_nic/rtl8156* \
		$(1)/lib/firmware/rtl_nic
endef
$(eval $(call BuildPackage,r8152-firmware))

Package/r8169-firmware = $(call Package/firmware-default,RealTek RTL8169 firmware)
define Package/r8169-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/rtl_nic
	$(CP) \
		$(PKG_BUILD_DIR)/rtl_nic/rtl810* \
		$(PKG_BUILD_DIR)/rtl_nic/rtl812* \
		$(PKG_BUILD_DIR)/rtl_nic/rtl8168* \
		$(PKG_BUILD_DIR)/rtl_nic/rtl84* \
		$(1)/lib/firmware/rtl_nic
endef
$(eval $(call BuildPackage,r8169-firmware))

Package/rtl8761a-firmware = $(call Package/firmware-default,RealTek RTL8761A firmware)
define Package/rtl8761a-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/rtl_bt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/rtl_bt/rtl8761a_fw.bin $(1)/lib/firmware/rtl_bt
endef
$(eval $(call BuildPackage,rtl8761a-firmware))

Package/rtl8761b-firmware = $(call Package/firmware-default,RealTek RTL8761B firmware)
define Package/rtl8761b-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/rtl_bt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/rtl_bt/rtl8761b_config.bin $(1)/lib/firmware/rtl_bt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/rtl_bt/rtl8761b_fw.bin $(1)/lib/firmware/rtl_bt
endef
$(eval $(call BuildPackage,rtl8761b-firmware))

Package/rtl8761bu-firmware = $(call Package/firmware-default,RealTek RTL8761BU firmware)
define Package/rtl8761bu-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/rtl_bt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/rtl_bt/rtl8761bu_config.bin $(1)/lib/firmware/rtl_bt
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/rtl_bt/rtl8761bu_fw.bin $(1)/lib/firmware/rtl_bt
endef
$(eval $(call BuildPackage,rtl8761bu-firmware))
