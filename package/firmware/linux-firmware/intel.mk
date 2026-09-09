Package/ibt-firmware = $(call Package/firmware-default,Intel bluetooth firmware)
define Package/ibt-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/intel
	$(CP) \
		$(PKG_BUILD_DIR)/intel/*.bseq \
		$(PKG_BUILD_DIR)/intel/ibt*.sfi \
		$(PKG_BUILD_DIR)/intel/ibt*.ddc \
		$(1)/lib/firmware/intel
endef
$(eval $(call BuildPackage,ibt-firmware))

Package/ice-firmware = $(call Package/firmware-default,Intel ICE firmware)
define Package/ice-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/intel/ice/ddp
	$(CP) \
		$(PKG_BUILD_DIR)/intel/ice/ddp/*.pkg \
		$(1)/lib/firmware/intel/ice/ddp/ice.pkg
endef
$(eval $(call BuildPackage,ice-firmware))

Package/e100-firmware = $(call Package/firmware-default,Firmware for Intel e100 PCI 10/100 Ethernet chipsets)
define Package/e100-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/e100
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/e100/d101m_ucode.bin $(1)/lib/firmware/e100/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/e100/d101s_ucode.bin $(1)/lib/firmware/e100/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/e100/d102e_ucode.bin $(1)/lib/firmware/e100/
endef
$(eval $(call BuildPackage,e100-firmware))

i915_deps:=+i915-firmware-dmc +i915-firmware-guc +i915-firmware-huc +i915-firmware-gsc
Package/i915-firmware = $(call Package/firmware-default,Intel I915 firmware \(meta package\),$(i915_deps),LICENSE.i915)
define Package/i915-firmware/install
	true
endef
$(eval $(call BuildPackage,i915-firmware))

Package/i915-firmware-dmc = $(call Package/firmware-default,Intel I915 DMC firmware,,LICENSE.i915)
define Package/i915-firmware-dmc/install
	$(INSTALL_DIR) $(1)/lib/firmware/i915
	for f in $(PKG_BUILD_DIR)/i915/*_dmc*.bin; do                        \
	  t=`echo $$$${f##*/} | cut -d_ -f2 | cut -d. -f1`;                  \
	  if [ "$$$$t" = dmc ]; then $(CP) $$$$f $(1)/lib/firmware/i915/; fi \
	done
endef
$(eval $(call BuildPackage,i915-firmware-dmc))

Package/i915-firmware-guc = $(call Package/firmware-default,Intel I915 GUC firmware,,LICENSE.i915)
define Package/i915-firmware-guc/install
	$(INSTALL_DIR) $(1)/lib/firmware/i915
	for f in $(PKG_BUILD_DIR)/i915/*_guc*.bin; do                        \
	  t=`echo $$$${f##*/} | cut -d_ -f2 | cut -d. -f1`;                  \
	  if [ "$$$$t" = guc ]; then $(CP) $$$$f $(1)/lib/firmware/i915/; fi \
	done
endef
$(eval $(call BuildPackage,i915-firmware-guc))

Package/i915-firmware-huc = $(call Package/firmware-default,Intel I915 HUC firmware,,LICENSE.i915)
define Package/i915-firmware-huc/install
	$(INSTALL_DIR) $(1)/lib/firmware/i915
	for f in $(PKG_BUILD_DIR)/i915/*_huc*.bin; do                        \
	  t=`echo $$$${f##*/} | cut -d_ -f2 | cut -d. -f1`;                  \
	  if [ "$$$$t" = huc ]; then $(CP) $$$$f $(1)/lib/firmware/i915/; fi \
	done
endef
$(eval $(call BuildPackage,i915-firmware-huc))

Package/i915-firmware-gsc = $(call Package/firmware-default,Intel I915 GSC firmware,,LICENSE.i915)
define Package/i915-firmware-gsc/install
	$(INSTALL_DIR) $(1)/lib/firmware/i915
	for f in $(PKG_BUILD_DIR)/i915/*_gsc*.bin; do                        \
	  t=`echo $$$${f##*/} | cut -d_ -f2 | cut -d. -f1`;                  \
	  if [ "$$$$t" = gsc ]; then $(CP) $$$$f $(1)/lib/firmware/i915/; fi \
	done
endef
$(eval $(call BuildPackage,i915-firmware-gsc))

Package/ivpu-firmware = $(call Package/firmware-default,Intel VPU firmware,,LICENSE.intel_vpu)
define Package/ivpu-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware/intel/vpu
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/intel/vpu/*.bin $(1)/lib/firmware/intel/vpu
	for t in `cd $(1)/lib/firmware/intel/vpu && ls vpu_*.bin | cut -d. -f1 | cut -d_ -f2 | sort | uniq`; do \
	  source=`cd $(1)/lib/firmware && ls intel/vpu/vpu_$$$${t}_v*.bin | sort | tail -n1`;                   \
	  target=$(1)/lib/firmware/vpu_$$$${t}.bin;                                                             \
	  if [ -n "$$$$source" ]; then ln -sf $$$$source $$$$target; fi                                         \
	done
endef
$(eval $(call BuildPackage,ivpu-firmware))
