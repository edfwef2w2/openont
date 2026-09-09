Package/mt7622bt-firmware = $(call Package/firmware-default,mt7622bt firmware,,LICENCE.mediatek)
define Package/mt7622bt-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/mt7622pr2h.bin \
		$(1)/lib/firmware/mediatek
endef
$(eval $(call BuildPackage,mt7622bt-firmware))

Package/mt7921bt-firmware = $(call Package/firmware-default,mt7921bt firmware,,LICENCE.mediatek)
define Package/mt7921bt-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/BT_RAM_CODE_MT7961_1_2_hdr.bin \
		$(1)/lib/firmware/mediatek
endef
$(eval $(call BuildPackage,mt7921bt-firmware))

Package/mt7922bt-firmware = $(call Package/firmware-default,mt7922bt firmware,,LICENCE.mediatek)
define Package/mt7922bt-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/BT_RAM_CODE_MT7922_1_1_hdr.bin \
		$(1)/lib/firmware/mediatek
endef
$(eval $(call BuildPackage,mt7922bt-firmware))

Package/mt7925bt-firmware = $(call Package/firmware-default,mt7925bt firmware,,LICENCE.mediatek)
define Package/mt7925bt-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek/mt7925
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/mt7925/BT_RAM_CODE_MT7925_1_1_hdr.bin \
		$(1)/lib/firmware/mediatek/mt7925
endef
$(eval $(call BuildPackage,mt7925bt-firmware))

Package/mt7987-2p5g-phy-firmware = $(call Package/firmware-default,MT7987 built-in 2.5G Ethernet PHY firmware,@TARGET_mediatek_filogic +LINUX_6_18:kmod-phy-mediatek-2p5g,LICENCE.mediatek,,nonshared)
define Package/mt7987-2p5g-phy-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek/mt7987
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/mt7987/i2p5ge-phy-DSPBitTb.bin \
		$(PKG_BUILD_DIR)/mediatek/mt7987/i2p5ge-phy-pmb.bin \
		$(1)/lib/firmware/mediatek/mt7987
endef
$(eval $(call BuildPackage,mt7987-2p5g-phy-firmware))

Package/mt7988-2p5g-phy-firmware = $(call Package/firmware-default,MT7988 built-in 2.5G Ethernet PHY firmware,@TARGET_mediatek_filogic +LINUX_6_18:kmod-phy-mediatek-2p5g,LICENCE.mediatek,,nonshared)
define Package/mt7988-2p5g-phy-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/mediatek/mt7988
	$(INSTALL_DATA) \
		$(PKG_BUILD_DIR)/mediatek/mt7988/i2p5ge-phy-pmb.bin \
		$(1)/lib/firmware/mediatek/mt7988
endef
$(eval $(call BuildPackage,mt7988-2p5g-phy-firmware))
