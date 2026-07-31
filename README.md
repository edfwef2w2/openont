# OpenONT

OpenONT is a streamlined OpenWrt-based gateway firmware.

Repository: https://github.com/edfwef2w2/openont

## Features

- PPPoE / DHCP WAN, LAN DHCP, SQM QoS, firewall4
- Console **and** Web UI for the same operations (shared backend)
- Port roles `lanN` / `wanN`; **one LAN may bind multiple eth** (bridge)
- Port mapping and DMZ (split from firewall UI)
- **Allow-access IP groups** for port mapping
- Custom OpenONT theme; **Status → Overview** is the OpenONT dashboard (replaces stock LuCI status overview)
- No Wi-Fi stack by default; no package-manager / theme switcher in UI

## Port binding (CLI ≡ Web)

Web: **Network → Port Binding**

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

## Address (CLI)

One-shot IPv4 on an existing `lanN` / `wanN` (bind ports first with `openont-port`).

```sh
openont-address list
openont-address set lan1 192.168.50.1/24
openont-address set wan1 10.0.0.2/24 10.0.0.1 8.8.8.8
openont-address dhcp wan1              # WAN back to DHCP
openont-address status-json
```

## Port map / DMZ / IP groups

Web: **Port Mapping** / **DMZ Host** / **IP Groups**

```sh
openont-ipgroup set office office "desk" 192.168.50.0/24 10.0.0.5
openont-nat portmap-add web 192.168.1.10 80 tcp 8080 office 1
openont-nat portmap-list
openont-nat dmz-add dmz1 192.168.1.50 1
```

## Flow offload (three modes)

Web: **Network → Flow Offload**

Modes: `off` | `software` | `hardware` (software+hardware). Detects platform capability (x86 typically software-only).

```sh
openont-offload detect
openont-offload recommend
openont-offload set software    # or off | hardware
openont-offload status
```

First boot applies the recommended mode once.

## PPPoE dial / redial

Web: **Network → PPPoE Dial**

```sh
openont-port set wan1 eth0 pppoe   # configure first
openont-pppoe status
openont-pppoe dial wan1
openont-pppoe hangup wan1
openont-pppoe redial wan1
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
| **Build Smoke** | `build-smoke.yml` | push / PR — paths, shell syntax, i18n checks |
| **Build Images** | `build.yml` | after Smoke succeeds on `main`/`master` (**all** targets); or manual / tag `v*` |

Auto chain: **Build Smoke (success on main/master) → Build Images (`all`)**.  
Chained Images runs use the same title as Smoke (usually the commit message).  
Manual targets: `x86_64`, `armsr_armv8`, or `all`.
## License

Same as OpenWrt (primarily GPL-2.0). See `COPYING`.
