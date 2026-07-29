# OpenONT

OpenONT is a streamlined OpenWrt-based gateway firmware.

Repository: https://github.com/edfwef2w2/openont

## Features

- PPPoE / DHCP WAN, LAN DHCP, SQM QoS, firewall4
- Console **and** Web UI for the same operations (shared backend)
- Port roles `lanN` / `wanN`; **one LAN may bind multiple eth** (bridge)
- Port mapping and DMZ (split from firewall UI)
- **Allow-access IP groups** for port mapping
- Custom OpenONT theme; system overview dashboard
- No Wi-Fi stack by default; no package-manager / theme switcher in UI

## Port binding (CLI ≡ Web)

Web: **网络设置 → 网口绑定**

```sh
openont-port list
openont-port set lan1 eth0 eth1          # multi-eth LAN bridge
openont-port add lan1 eth2
openont-port del-port lan1 eth1
openont-port set wan1 eth3               # dhcp
openont-port set wan1 eth3 pppoe
openont-port del lan1
```

Default LAN address after bind: `192.168.1.1/24`.

## Port map / DMZ / IP groups

Web: **端口映射** / **DMZ主机** / **IP分组**

```sh
openont-ipgroup set office office "desk" 192.168.50.0/24 10.0.0.5
openont-nat portmap-add web 192.168.1.10 80 tcp 8080 office 1
openont-nat portmap-list
openont-nat dmz-add dmz1 192.168.1.50 1
```

## Build

```sh
./scripts/feeds update -a
./scripts/feeds install -a
./scripts/openont/apply-config.sh x86_64    # or armsr_armv8
make -j$(nproc)
```

## Internationalization

UI strings use English msgids with LuCI `_()` / `translate()` and gettext catalogues:

- `package/openont/luci-mod-openont/po/templates/openont.pot`
- `package/openont/luci-mod-openont/po/zh_Hans/openont.po` → package `luci-i18n-openont-zh-cn` (via `feeds/luci/luci.mk`)

RPC returns structured fields (`enabled`, `link`, `uptime_sec`, `src_wan: "all"`); the Web UI translates labels. Select language under **System → Language and Style** (install the matching `luci-i18n-*` packages).

## CI

Only two workflows under `.github/workflows/`:

| Workflow | File | When |
|----------|------|------|
| **Test** | `test.yml` | push / PR — lint, paths, shell syntax, i18n checks |
| **Build images** | `build.yml` | manual (`workflow_dispatch`) or tag `v*` — full firmware images |

Build targets: `x86_64`, `armsr_armv8`, or `all` (manual input).
## License

Same as OpenWrt (primarily GPL-2.0). See `COPYING`.
