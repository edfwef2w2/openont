Package/ar3k-firmware = $(call Package/firmware-default,Firmware for Qualcomm/Atheros AR3011/AR3012 Bluetooth ICs,,LICENSE.QualcommAtheros_ar3k)
define Package/ar3k-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/ar3k
	$(CP) \
		$(PKG_BUILD_DIR)/ar3k/*.dfu \
		$(1)/lib/firmware/ar3k
	$(INSTALL_DIR) $(1)/lib/firmware/qca
	$(CP) \
		$(PKG_BUILD_DIR)/qca/*.bin \
		$(1)/lib/firmware/qca
endef
$(eval $(call BuildPackage,ar3k-firmware))
