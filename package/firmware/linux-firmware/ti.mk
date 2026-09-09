Package/ti-3410-firmware = $(call Package/firmware-default,TI 3410 firmware)
define Package/ti-3410-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ti_3410.fw $(1)/lib/firmware
endef
$(eval $(call BuildPackage,ti-3410-firmware))

Package/ti-5052-firmware = $(call Package/firmware-default,TI 5052 firmware)
define Package/ti-5052-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ti_5052.fw $(1)/lib/firmware
endef
$(eval $(call BuildPackage,ti-5052-firmware))
