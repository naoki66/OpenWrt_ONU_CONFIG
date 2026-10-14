// SPDX-License-Identifier: GPL-2.0-only
use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

mod netlink;
mod status;

use netlink::LineMode;

const NET_CLASS: &str = "/sys/class/net";
const ARPHRD_NONE: &str = "65534";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PROJECT_URL: &str = "https://github.com/pbs05/openwrt-pon-userspace/tree/main/airoha-ponctl";

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Debug, Clone)]
struct PonDevice {
    name: String,
    net_path: PathBuf,
    xpon_path: PathBuf,
}

fn read_trimmed(path: &Path) -> Result<String> {
    Ok(fs::read_to_string(path)?.trim().to_owned())
}

fn write_value(path: &Path, value: &str) -> Result<()> {
    fs::write(path, format!("{value}\n"))?;
    Ok(())
}

fn discover_pon_devices() -> Result<Vec<PonDevice>> {
    let mut devices = Vec::new();

    for entry in fs::read_dir(NET_CLASS)? {
        let entry = entry?;
        let net_path = entry.path();
        let xpon_path = net_path.join("xpon");

        if !xpon_path.join("serial_number").is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        devices.push(PonDevice {
            name,
            net_path,
            xpon_path,
        });
    }
    devices.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(devices)
}

fn select_pon_device(requested: Option<&str>) -> Result<PonDevice> {
    let devices = discover_pon_devices()?;

    if let Some(name) = requested {
        return devices
            .into_iter()
            .find(|device| device.name == name)
            .ok_or_else(|| {
                format!("PON device '{name}' was not found or has no xpon binding").into()
            });
    }

    match devices.len() {
        0 => Err("no PON device with an xpon binding was found".into()),
        1 => Ok(devices.into_iter().next().expect("length checked")),
        _ => Err(format!(
            "multiple PON devices are present ({}); select one with --device ponX",
            devices
                .iter()
                .map(|device| device.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
        .into()),
    }
}

fn associated_controls(device: &PonDevice) -> Result<Vec<String>> {
    let pon_ifindex = read_trimmed(&device.net_path.join("ifindex"))?;
    let mut matches = Vec::new();

    for entry in fs::read_dir(NET_CLASS)? {
        let entry = entry?;
        let path = entry.path();
        if path == device.net_path {
            continue;
        }
        if read_trimmed(&path.join("type")).ok().as_deref() != Some(ARPHRD_NONE) {
            continue;
        }
        if read_trimmed(&path.join("iflink")).ok().as_deref() != Some(&pon_ifindex) {
            continue;
        }
        matches.push(entry.file_name().to_string_lossy().into_owned());
    }
    matches.sort();

    Ok(matches)
}

fn normalize_serial(input: &str) -> Result<String> {
    let input = input.trim();
    if input.is_empty() || input.eq_ignore_ascii_case("default") {
        return Ok("default".to_owned());
    }
    if input.len() == 16 && input.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(input.to_ascii_lowercase());
    }
    if input.len() == 12 {
        let bytes = input.as_bytes();
        let vendor = &bytes[..4];
        let serial = &bytes[4..];
        if vendor.iter().all(|byte| byte.is_ascii_alphanumeric())
            && serial.iter().all(|byte| byte.is_ascii_hexdigit())
        {
            let mut normalized = String::with_capacity(16);
            for byte in vendor {
                normalized.push_str(&format!("{byte:02x}"));
            }
            normalized.push_str(&input[4..].to_ascii_lowercase());
            return Ok(normalized);
        }
    }
    Err("serial must be 'default', 16 raw hex digits, or VEND followed by 8 hex digits".into())
}

fn hex_encode_padded(input: &[u8], width: usize) -> String {
    let mut output = String::with_capacity(width * 2);
    for byte in input {
        output.push_str(&format!("{byte:02x}"));
    }
    for _ in input.len()..width {
        output.push_str("00");
    }
    output
}

fn normalize_registration_id(input: &str) -> Result<String> {
    let input = input.trim();
    if input.is_empty() || input.eq_ignore_ascii_case("default") {
        return Ok("default".to_owned());
    }

    if let Some(raw) = input.strip_prefix("hex:") {
        if raw.len() == 72 && raw.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Ok(raw.to_ascii_lowercase());
        }
        return Err("hex Registration-ID must contain exactly 72 hex digits".into());
    }

    let text = input.strip_prefix("text:").unwrap_or(input);
    if input.len() == 72 && input.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(input.to_ascii_lowercase());
    }
    if text.len() > 36 {
        return Err("text Registration-ID must not exceed 36 UTF-8 bytes".into());
    }
    Ok(hex_encode_padded(text.as_bytes(), 36))
}

fn show_identity(device: &PonDevice) -> Result<()> {
    println!(
        "serial_number: {}",
        read_trimmed(&device.xpon_path.join("serial_number"))?
    );
    println!(
        "active_serial_number: {}",
        read_trimmed(&device.xpon_path.join("active_serial_number"))?
    );
    println!(
        "registration_id: {}",
        read_trimmed(&device.xpon_path.join("registration_id"))?
    );
    Ok(())
}

fn set_identity(device: &PonDevice, arguments: &[String]) -> Result<()> {
    let mut serial = None;
    let mut registration = None;
    let mut options = arguments.chunks_exact(2);

    for option in &mut options {
        match option[0].as_str() {
            "--serial" => serial = Some(normalize_serial(&option[1])?),
            "--registration-id" => registration = Some(normalize_registration_id(&option[1])?),
            name => return Err(format!("unknown argument '{name}'").into()),
        }
    }
    if let Some(name) = options.remainder().first() {
        return Err(format!("{name} requires a value").into());
    }

    if serial.is_none() && registration.is_none() {
        return Err("identity set requires --serial or --registration-id".into());
    }
    if let Some(serial) = serial {
        write_value(&device.xpon_path.join("serial_number"), &serial)?;
    }
    if let Some(registration) = registration {
        write_value(&device.xpon_path.join("registration_id"), &registration)?;
    }
    show_identity(device)
}

fn line_ifindex(device: &PonDevice) -> Result<u32> {
    Ok(read_trimmed(&device.net_path.join("ifindex"))?.parse()?)
}

/// Shared VID validation.  vid 0 is accepted on purpose: a fully-routed ONU
/// hands multicast to the LAN untagged, and the kernel reports that as 0.
/// Whether 0 is honoured depends on the kernel's mvlan_allow_untagged flag,
/// which the driver enforces; the CLI only rejects values that are never
/// valid on the wire.
fn parse_vid(text: &str) -> Result<u16> {
    let vid: u16 = text
        .parse()
        .map_err(|_| format!("'{text}' is not a valid VID"))?;
    if vid > 4094 {
        return Err(format!("VID {vid} is out of range (0-4094)").into());
    }
    Ok(vid)
}

/// Parse a multicast group address into (IP protocol number, raw bytes).
///
/// `239.1.2.3` yields (4, 4 bytes) and `ff02::1` yields (6, 16 bytes). The
/// zone suffix of a scoped IPv6 literal (`%eth0`) is rejected rather than
/// silently dropped, because the kernel lookup ignores interfaces.
fn parse_group(text: &str) -> Result<(u8, Vec<u8>)> {
    if let Ok(v4) = text.parse::<std::net::Ipv4Addr>() {
        if !v4.is_multicast() {
            return Err(format!("{v4} is not a multicast group").into());
        }
        return Ok((4, v4.octets().to_vec()));
    }
    if text.contains('%') {
        return Err(format!("'{text}': scoped IPv6 literals are not supported").into());
    }
    match text.parse::<std::net::Ipv6Addr>() {
        Ok(v6) if v6.is_multicast() => Ok((6, v6.octets().to_vec())),
        Ok(v6) => Err(format!("{v6} is not a multicast group").into()),
        Err(_) => Err(format!("'{text}' is not an IPv4 or IPv6 multicast group").into()),
    }
}

/// Render a raw group address back to text for display.
fn format_group(proto: u8, grp: &[u8]) -> String {
    if proto == 4 && grp.len() == 4 {
        format!("{}.{}.{}.{}", grp[0], grp[1], grp[2], grp[3])
    } else if grp.len() == 16 {
        let mut octets = [0u8; 16];
        octets.copy_from_slice(grp);
        std::net::Ipv6Addr::from(octets).to_string()
    } else {
        format!("{grp:02x?}")
    }
}

fn print_mvlan_state(state: &netlink::IgmpMvlanState) {
    println!("enabled={}", state.enabled.unwrap_or(false));
    println!("strict={}", state.strict.unwrap_or(false));
    println!("allow_untagged={}", state.allow_untagged.unwrap_or(true));
    println!("count={}", state.count.unwrap_or(0));
    println!(
        "allow_cnt={} deny_cnt={} ll_exempt_cnt={} commit_cnt={}",
        state.allow_cnt.unwrap_or(0),
        state.deny_cnt.unwrap_or(0),
        state.ll_exempt_cnt.unwrap_or(0),
        state.commit_cnt.unwrap_or(0)
    );
    if state.entries.is_empty() {
        println!(
            "(no mvlan entries; table empty = {})",
            if state.strict.unwrap_or(false) {
                "deny all"
            } else {
                "no filter"
            }
        );
    }
    for e in &state.entries {
        println!("vid={} port_mask={:#04x}", e.vid, e.port_mask);
    }
}

fn show_mode(device: &PonDevice) -> Result<()> {
    let state = netlink::get_line(line_ifindex(device)?)?;
    println!("configured={}", state.configured.name());
    println!(
        "active={}",
        state.active.map(LineMode::name).unwrap_or("none")
    );
    let controls = associated_controls(device)?;
    println!(
        "controls={}",
        if controls.is_empty() {
            "none".to_owned()
        } else {
            controls.join(",")
        }
    );
    Ok(())
}

fn print_help() {
    println!(
        "ponctl {VERSION}\n\
         {PROJECT_URL}\n\
         \n\
         Usage:\n\
         \x20 ponctl list\n\
         \x20 ponctl [--device ponX] status [--json]\n\
         \x20 ponctl [--device ponX] control|identity\n\
         \x20 ponctl [--device ponX] mode [show]\n\
         \x20 ponctl [--device ponX] mode set MODE\n\
         \x20 ponctl [--device ponX] identity set [--serial SN] [--registration-id ID]\n\
         \x20 ponctl [--device ponX] data-path [show]\n\
         \x20 ponctl [--device ponX] igmp [show]\n\
         \x20 ponctl [--device ponX] igmp set [--enable 0|1] [--snooping 0|1] [--mld 0|1] [--fast-leave 0|1] [--mvlan 0|1] [--mvlan-strict 0|1]\n\
         \x20 ponctl [--device ponX] igmp fwd\n\
         \x20 ponctl [--device ponX] igmp ppe GROUP\n\
         \x20 ponctl [--device ponX] igmp mvlan [list]\n\
         \x20 ponctl [--device ponX] igmp mvlan add|del VID\n\
         \x20 ponctl [--device ponX] igmp mvlan commit [--enable 0|1] [VID...]"
    );
}

fn run() -> Result<()> {
    let mut arguments: Vec<String> = env::args().skip(1).collect();
    let mut requested_device = None;

    if matches!(
        arguments.first().map(String::as_str),
        Some("-d" | "--device")
    ) {
        if arguments.len() < 2 {
            return Err("--device requires a netdev name".into());
        }
        requested_device = Some(arguments.remove(1));
        arguments.remove(0);
    }
    let command = arguments.first().map(String::as_str).unwrap_or("help");

    if command == "help" || command == "--help" || command == "-h" {
        print_help();
        return Ok(());
    }
    if command == "--version" || command == "-V" {
        println!("ponctl {VERSION}\n{PROJECT_URL}");
        return Ok(());
    }
    if command == "list" {
        if requested_device.is_some() || arguments.len() != 1 {
            return Err("list does not accept --device or additional arguments".into());
        }
        let devices = discover_pon_devices()?;
        if devices.is_empty() {
            return Err("no PON device with an xpon binding was found".into());
        }
        for device in devices {
            let controls = associated_controls(&device)?;
            println!(
                "device={} controls={} xpon={}",
                device.name,
                if controls.is_empty() {
                    "none".to_owned()
                } else {
                    controls.join(",")
                },
                device.xpon_path.display()
            );
        }
        return Ok(());
    }

    let device = select_pon_device(requested_device.as_deref())?;
    match command {
        "status" if arguments.len() == 1 || (arguments.len() == 2 && arguments[1] == "--json") => {
            let snapshot = netlink::get_status(line_ifindex(&device)?)?;
            if arguments.len() == 2 {
                println!("{}", status::json(&snapshot));
            } else {
                print!("{}", status::human(&snapshot));
            }
        }
        "control" if arguments.len() == 1 => {
            for control in associated_controls(&device)? {
                println!("{control}");
            }
        }
        "mode" if arguments.len() == 1 || arguments.get(1).map(String::as_str) == Some("show") => {
            if arguments.len() > 2 {
                return Err("mode show accepts no additional arguments".into());
            }
            show_mode(&device)?;
        }
        "mode" if arguments.get(1).map(String::as_str) == Some("set") => {
            if arguments.len() != 3 {
                return Err("mode set requires one mode name".into());
            }
            let mode = LineMode::parse(&arguments[2])
                .ok_or("mode must be gpon, xgpon, xgspon, epon-1g, epon-10g-1g, or epon-10g-10g")?;
            netlink::set_line(line_ifindex(&device)?, mode)?;
            show_mode(&device)?;
        }
        "identity"
            if arguments.len() == 1 || arguments.get(1).map(String::as_str) == Some("show") =>
        {
            if arguments.len() > 2 {
                return Err("identity show accepts no additional arguments".into());
            }
            show_identity(&device)?;
        }
        "identity" if arguments.get(1).map(String::as_str) == Some("set") => {
            set_identity(&device, &arguments[2..])?;
        }
        "data-path"
            if arguments.len() == 1 || arguments.get(1).map(String::as_str) == Some("show") =>
        {
            if arguments.len() > 2 {
                return Err("data-path show accepts no additional arguments".into());
            }
            print!(
                "{}",
                fs::read_to_string(device.xpon_path.join("data_path"))?
            );
        }
        "igmp" if arguments.len() == 1 || (arguments.len() == 2 && arguments[1] == "show") => {
            if arguments.len() > 2 {
                return Err("igmp show accepts no additional arguments".into());
            }
            let cfg = netlink::get_igmp(line_ifindex(&device)?)?;
            println!("enabled={}", cfg.enabled.unwrap_or(false));
            println!("snooping={}", cfg.snooping.unwrap_or(false));
            println!("mld={}", cfg.mld.unwrap_or(false));
            println!("fast_leave={}", cfg.fast_leave.unwrap_or(false));
            println!("mvlan={}", cfg.mvlan.unwrap_or(false));
            println!("mvlan_strict={}", cfg.mvlan_strict.unwrap_or(false));
            println!("fwd_count={}", cfg.fwd_count.unwrap_or(0));
        }
        "igmp" if arguments.get(1).map(String::as_str) == Some("set") => {
            let mut config = netlink::IgmpConfig::default();
            let mut opts = arguments[2..].chunks_exact(2);
            for opt in &mut opts {
                let val: u8 = opt[1]
                    .parse()
                    .map_err(|_| format!("{} must be 0 or 1", opt[0]))?;
                let b = val != 0;
                match opt[0].as_str() {
                    "--enable" => config.enabled = Some(b),
                    "--snooping" => config.snooping = Some(b),
                    "--mld" => config.mld = Some(b),
                    "--fast-leave" => config.fast_leave = Some(b),
                    "--mvlan" => config.mvlan = Some(b),
                    "--mvlan-strict" => config.mvlan_strict = Some(b),
                    name => return Err(format!("unknown argument '{name}'").into()),
                }
            }
            if let Some(name) = opts.remainder().first() {
                return Err(format!("{name} requires a value").into());
            }
            if config.enabled.is_none()
                && config.snooping.is_none()
                && config.mld.is_none()
                && config.fast_leave.is_none()
                && config.mvlan.is_none()
                && config.mvlan_strict.is_none()
            {
                return Err(
                    "igmp set requires at least one of --enable, --snooping, --mld, --fast-leave, --mvlan, --mvlan-strict"
                        .into(),
                );
            }
            netlink::set_igmp(line_ifindex(&device)?, &config)?;
            let cfg = netlink::get_igmp(line_ifindex(&device)?)?;
            println!("enabled={}", cfg.enabled.unwrap_or(false));
            println!("snooping={}", cfg.snooping.unwrap_or(false));
            println!("mld={}", cfg.mld.unwrap_or(false));
            println!("fast_leave={}", cfg.fast_leave.unwrap_or(false));
            println!("mvlan={}", cfg.mvlan.unwrap_or(false));
            println!("mvlan_strict={}", cfg.mvlan_strict.unwrap_or(false));
            println!("fwd_count={}", cfg.fwd_count.unwrap_or(0));
        }
        "igmp" if arguments.get(1).map(String::as_str) == Some("fwd") => {
            if arguments.len() != 2 {
                return Err("igmp fwd accepts no additional arguments".into());
            }
            let entries = netlink::get_igmp_fwd(line_ifindex(&device)?)?;
            if entries.is_empty() {
                println!("(no forwarding entries)");
            }
            for e in &entries {
                let proto = if e.proto == 4 { "IGMP" } else { "MLD" };
                let grp = if e.proto == 4 && e.grp.len() == 4 {
                    format!("{}.{}.{}.{}", e.grp[0], e.grp[1], e.grp[2], e.grp[3])
                } else if e.grp.len() == 16 {
                    e.grp
                        .chunks(2)
                        .map(|c| format!("{:02x}{:02x}", c[0], c[1]))
                        .collect::<Vec<_>>()
                        .join(":")
                } else {
                    format!("{:02x?}", e.grp)
                };
                println!(
                    "proto={} port={} vid={} ver={} grp={}",
                    proto, e.port, e.vid, e.ver, grp
                );
            }
        }
        "igmp" if arguments.get(1).map(String::as_str) == Some("ppe") => {
            /*
             * ponctl igmp ppe 239.1.2.3
             * ponctl igmp ppe ff02::1
             *
             * Reads back the PPE hardware multicast flow for a group. The
             * provider keys the lookup on the derived multicast MAC only, so
             * the VLAN the flow was programmed with is irrelevant here.
             */
            if arguments.len() != 3 {
                return Err("usage: ponctl igmp ppe <group>".into());
            }
            let (proto, grp) = parse_group(&arguments[2])?;
            let ifindex = line_ifindex(&device)?;
            let state = netlink::get_igmp_ppe(ifindex, proto, &grp)?;

            let label = match state.state {
                netlink::PpeFlowState::Absent => "absent",
                netlink::PpeFlowState::Present => "present",
                netlink::PpeFlowState::Probed => "probed",
            };
            println!(
                "proto={} grp={} ppe_state={} port_mask=0x{:x}",
                if state.proto == 4 { "IGMP" } else { "MLD" },
                format_group(state.proto, &state.grp),
                label,
                state.port_mask
            );
            match state.state {
                netlink::PpeFlowState::Absent => {
                    println!("hint: no PPE flow; the group is not hardware-offloaded")
                }
                netlink::PpeFlowState::Probed => {
                    println!("hint: flow offloaded but aggregates no LAN port")
                }
                netlink::PpeFlowState::Present => {}
            }
        }
        "igmp" if arguments.get(1).map(String::as_str) == Some("mvlan") => {
            let ifindex = line_ifindex(&device)?;
            let sub = arguments.get(2).map(String::as_str);

            if sub.is_none() || sub == Some("list") || sub == Some("show") {
                if arguments.len() > 3 {
                    return Err("igmp mvlan list accepts no additional arguments".into());
                }
                print_mvlan_state(&netlink::get_igmp_mvlan(ifindex)?);
            } else if sub == Some("add") || sub == Some("del") {
                if arguments.len() != 4 {
                    return Err(format!(
                        "igmp mvlan {} requires a VID",
                        sub.expect("checked")
                    )
                    .into());
                }
                let vid = parse_vid(&arguments[3])?;
                netlink::set_igmp_mvlan(ifindex, sub == Some("add"), vid)?;
                print_mvlan_state(&netlink::get_igmp_mvlan(ifindex)?);
            } else if sub == Some("commit") {
                /*
                 * ponctl igmp mvlan commit --enable 1 45 47
                 * Replaces the whitelist and sets the enable flag in one
                 * round trip, so no VLAN sneaks through while the table is
                 * still being filled.
                 */
                let mut enable = true;
                let mut vids: Vec<u16> = Vec::new();
                let rest = &arguments[3..];
                let mut i = 0;

                while i < rest.len() {
                    match rest[i].as_str() {
                        "--enable" => {
                            i += 1;
                            let v = rest.get(i).ok_or("--enable requires 0 or 1")?;
                            enable = match v.as_str() {
                                "1" | "true" | "yes" | "on" => true,
                                "0" | "false" | "no" | "off" => false,
                                _ => return Err("--enable must be 0 or 1".into()),
                            };
                        }
                        "--disable" => enable = false,
                        other => vids.push(parse_vid(other)?),
                    }
                    i += 1;
                }

                netlink::commit_igmp_mvlan(ifindex, enable, &vids)?;
                print_mvlan_state(&netlink::get_igmp_mvlan(ifindex)?);
            } else {
                return Err(
                    "usage: ponctl igmp mvlan [list] | add|del <vid> | \
                     commit [--enable 0|1] [vid...]"
                        .into(),
                );
            }
        }
        _ => {
            return Err(
                format!("unknown or malformed command '{command}'; run 'ponctl --help'").into(),
            );
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("ponctl: {error}");
        std::process::exit(1);
    }
}
