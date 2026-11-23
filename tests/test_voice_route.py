#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run with sudo unshare -n python3 tests/test_voice_route.py on Linux."""

import json
import os
from pathlib import Path
import shlex
import subprocess
from tempfile import TemporaryDirectory


def ip(*args, check=True):
    return subprocess.run(["ip", "-4", *args], capture_output=True, text=True, check=check)


def write(path, text, executable=False):
    path.write_text(text, encoding="utf-8")
    if executable:
        path.chmod(0o755)


def test(helper, fixtures):
    # netifd provides the current address, subnet and inactive DHCP gateway.
    # Use the real kernel for every ip command.
    for name, address in (
        ("ct-voice", "192.0.2.15/25"),
        ("test-wan", "198.51.100.2/24"),
        ("test-lan", "203.0.113.2/27"),
    ):
        ip("link", "add", name, "type", "dummy")
        ip("addr", "add", address, "dev", name)
        ip("link", "set", name, "up")
    ip("route", "add", "default", "via", "198.51.100.1", "dev", "test-wan")

    rules = ("rule", "show", "pref", "20043")
    table = ("route", "show", "table", "20043")
    env = {**os.environ, "PATH": str(fixtures) + ":" + os.environ["PATH"]}

    def reconcile(expected=0, **changes):
        result = subprocess.run(
            ["sh", str(helper)], env={**env, **changes}, capture_output=True, text=True
        )
        assert result.returncode == expected, result.stderr

    def route(destination, source, check=True):
        return ip("route", "get", destination, "from", source, check=check)

    reconcile()
    reconcile()
    for destination in ("203.0.113.129", "203.0.113.231"):
        assert "dev ct-voice table 20043" in route(destination, "192.0.2.15").stdout
        assert "dev test-wan" in route(destination, "203.0.113.2").stdout
    assert "dev test-wan" in ip("route", "get", "203.0.113.129").stdout
    assert "via" not in route("192.0.2.30", "192.0.2.15").stdout
    assert len(ip(*rules).stdout.splitlines()) == 1

    reconcile(VOICE_UP="0")
    assert route("203.0.113.129", "192.0.2.15", check=False).returncode != 0
    assert "dev test-wan" in route("203.0.113.129", "203.0.113.2").stdout
    reconcile()

    # Model a new DHCP lease and gateway on the same logical voice interface.
    ip("addr", "del", "192.0.2.15/25", "dev", "ct-voice")
    ip("addr", "add", "192.0.2.140/25", "dev", "ct-voice")
    lease = {"VOICE_SUBNET": "192.0.2.140/25", "VOICE_GATEWAY": "192.0.2.129"}
    reconcile(**lease)
    assert "192.0.2.140" in ip(*rules).stdout
    assert "192.0.2.15" not in ip(*rules).stdout
    assert "192.0.2.0/25" not in ip(*table).stdout
    assert "via 192.0.2.129 dev ct-voice" in route("203.0.113.129", "192.0.2.140").stdout

    # A foreign rule or route cannot be adopted or flushed by voice-apply.
    ip("rule", "add", "pref", "20042", "from", "203.0.113.2", "table", "20043")
    foreign = ip("rule", "show", "pref", "20042").stdout
    reconcile(expected=1, **lease)
    assert ip("rule", "show", "pref", "20042").stdout == foreign
    ip("rule", "del", "pref", "20042")
    ip("route", "add", "203.0.113.224/28", "table", "20043", "dev", "test-wan", "proto", "99")
    foreign = ip(*table).stdout
    reconcile(expected=1, **lease)
    assert ip(*table).stdout == foreign
    ip("route", "del", "203.0.113.224/28", "table", "20043", "proto", "99")

    # The saved gateway is optional. Bridge/trunk and disable remove policy.
    reconcile(VOICE_SUBNET=lease["VOICE_SUBNET"], VOICE_GATEWAY="")
    assert not ip(*rules).stdout
    for mode in ("bridge", "trunk"):
        reconcile(**lease)
        reconcile(VOICE_MODE=mode, **lease)
        assert not ip(*rules).stdout
    reconcile(**lease)
    reconcile(VOICE_ENABLED="0", **lease)
    assert not ip(*rules).stdout


def main():
    interfaces = json.loads(ip("-j", "link", "show").stdout)
    if (os.geteuid() != 0
        or os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net")
        or [entry["ifname"] for entry in interfaces] != ["lo"]):
        raise SystemExit("Run the test as root inside a new network namespace.")

    source = Path(__file__).resolve().parents[1] / "luci-app-onu/root/usr/libexec/voice-route"
    with TemporaryDirectory(prefix="onu-voice-route-") as folder:
        temp = Path(folder)
        network_functions = temp / "network.sh"
        write(network_functions, """\
network_is_up() { [ "${VOICE_UP:-1}" = 1 ]; }
network_get_device() { [ "$2" = voice ] && device=ct-voice; }
network_get_subnet() { [ "$2" = voice ] && subnet="${VOICE_SUBNET:-192.0.2.15/25}"; }
network_get_gateway() {
    [ "$2" = voice ] && [ "$3" = true ] || return 1
    gateway="${VOICE_GATEWAY-192.0.2.1}"
    [ -n "$gateway" ]
}
""")
        write(temp / "uci", """\
#!/bin/sh
case "$3" in
    onu-voice.network.enabled) printf '%s\\n' "${VOICE_ENABLED:-1}" ;;
    onu-voice.network.mode) printf '%s\\n' "${VOICE_MODE:-route}" ;;
    network.voice.luci_voice) printf '1\\n' ;;
    *) exit 1 ;;
esac
""", executable=True)
        write(temp / "ipcalc.sh", """\
#!/usr/bin/env python3
from ipaddress import IPv4Interface
import sys
print("NETWORK=" + str(IPv4Interface(sys.argv[1]).network.network_address))
""", executable=True)
        helper = temp / "voice-route"
        # Substitute only the filesystem references needed to run outside OpenWrt.
        script = source.read_text(encoding="utf-8").replace(". /lib/functions.sh\n", "")
        script = script.replace(". /lib/functions/network.sh", ". " + shlex.quote(str(network_functions)))
        script = script.replace("/var/lock", shlex.quote(str(temp / "lock")))
        write(helper, script)
        test(helper, temp)
    print("PASS: voice routing, DHCP update, link failure, mode cleanup and rule ownership")


if __name__ == "__main__":
    main()
