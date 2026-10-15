// SPDX-License-Identifier: GPL-2.0-only

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Release file written into the root filesystem by the image build.
const RELEASE_FILE: &str = "/etc/openwrt_release";

/// Board model name of the running device, published by OpenWrt at boot.
const MODEL_FILE: &str = "/tmp/sysinfo/model";

/// Facts about the running unit that the identity defaults are taken from.
///
/// What an ONU reports to the OLT describes the unit, not the userspace
/// reporting it: the model name is the one on this board and the software
/// version is the one this image was built from. Both are read once at start-up
/// and stay unset when the running system cannot answer, so the caller keeps
/// its own last-resort value.
#[derive(Clone, Debug, Default)]
pub struct HostIdentity {
    /// Board model name, e.g. `Gemtek XG2010G`.
    pub model: Option<Vec<u8>>,
    /// Firmware version of the running image, e.g. `23.05.4`.
    pub firmware: Option<Vec<u8>>,
}

impl HostIdentity {
    pub fn detect() -> Self {
        Self {
            model: fs::read_to_string(MODEL_FILE)
                .ok()
                .map(|text| text.trim().as_bytes().to_vec())
                .filter(|model| !model.is_empty()),
            firmware: fs::read_to_string(RELEASE_FILE)
                .ok()
                .and_then(|text| release_version(&text))
                .map(String::into_bytes),
        }
    }
}

/// The version an OLT inventory should see, read out of a release file.
///
/// A release such as `23.05.4` is what belongs in a software-version attribute
/// and in the ONU version, and it is what an operator recognises as a firmware
/// version. A development build has no release, so the revision that tells one
/// snapshot from the next is reported instead.
pub fn release_version(text: &str) -> Option<String> {
    match release_field(text, "DISTRIB_RELEASE") {
        Some(release) if !release.eq_ignore_ascii_case("snapshot") => Some(release.to_owned()),
        _ => release_field(text, "DISTRIB_REVISION")
            .map(str::to_owned)
            .or_else(|| release_field(text, "DISTRIB_ID").map(str::to_owned)),
    }
}

/// Read one `KEY='value'` assignment out of a release file.
fn release_field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(name, _)| name.trim() == key)
        .map(|(_, value)| value.trim().trim_matches(|character| character == '\'' || character == '"'))
        .filter(|value| !value.is_empty())
}

/// ARPHRD_NONE control interfaces reference their PON netdev through iflink; OAM uses the parent MAC.
pub fn parent_interface_mac(interface: &str) -> io::Result<[u8; 6]> {
    let path = parent_interface_path(interface)?;

    parse_mac(&read_trimmed(path.join("address"))?)
}

pub fn parent_xpon_attribute(interface: &str, attribute: &str) -> io::Result<Option<PathBuf>> {
    let path = parent_interface_path(interface)?
        .join("xpon")
        .join(attribute);

    Ok(path.is_file().then_some(path))
}

/// The serial number a PON line registers with, when the driver exposes one.
pub fn active_serial(interface: &str) -> io::Result<Option<[u8; 8]>> {
    let Some(path) = parent_xpon_attribute(interface, "active_serial_number")? else {
        return Ok(None);
    };

    serial_from_attribute(&path)
}

/// Read a serial-number attribute file.
///
/// The driver publishes either the eight bytes in hexadecimal or `none` while
/// no serial number is set.
pub fn serial_from_attribute(path: &Path) -> io::Result<Option<[u8; 8]>> {
    let text = read_trimmed(path)?;
    if text == "none" {
        return Ok(None);
    }

    let bytes = decode_hex(&text).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "active PON serial number is not hexadecimal",
        )
    })?;

    bytes.try_into().map(Some).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "active PON serial number is not eight bytes",
        )
    })
}

fn decode_hex(input: &str) -> Option<Vec<u8>> {
    let bytes = input.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }

    let mut output = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        output.push((high << 4) | low);
    }
    Some(output)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn parent_interface_path(interface: &str) -> io::Result<PathBuf> {
    let iflink = read_trimmed(format!("/sys/class/net/{interface}/iflink"))?;

    for entry in fs::read_dir("/sys/class/net")? {
        let entry = entry?;
        let ifindex = match read_trimmed(entry.path().join("ifindex")) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if ifindex == iflink {
            return Ok(entry.path());
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("parent interface for {interface} was not found"),
    ))
}

fn read_trimmed(path: impl AsRef<Path>) -> io::Result<String> {
    Ok(fs::read_to_string(path)?.trim().to_owned())
}

fn parse_mac(value: &str) -> io::Result<[u8; 6]> {
    let mut mac = [0u8; 6];
    let fields: Vec<&str> = value.split(':').collect();
    if fields.len() != mac.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid MAC address",
        ));
    }
    for (destination, field) in mac.iter_mut().zip(fields) {
        *destination = u8::from_str_radix(field, 16)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid MAC address"))?;
    }
    Ok(mac)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_names_the_software_version() {
        // What the image build writes for a tagged release.
        let release = "DISTRIB_ID='ImmortalWrt'\n\
                       DISTRIB_RELEASE='23.05.4'\n\
                       DISTRIB_REVISION='r27643-7bb1c8b'\n";

        assert_eq!(release_version(release).unwrap(), "23.05.4");
    }

    #[test]
    fn a_development_build_falls_back_to_its_revision() {
        // A snapshot has no release, so the revision is what tells two images
        // apart; reporting the word SNAPSHOT would identify neither.
        let release = "DISTRIB_ID='OpenWrt'\n\
                       DISTRIB_RELEASE='SNAPSHOT'\n\
                       DISTRIB_REVISION='r27643-7bb1c8b'\n";

        assert_eq!(release_version(release).unwrap(), "r27643-7bb1c8b");
    }

    #[test]
    fn a_release_file_without_versions_names_itself() {
        assert_eq!(
            release_version("DISTRIB_ID=\"OpenWrt\"\n").unwrap(),
            "OpenWrt"
        );
        assert_eq!(release_version(""), None);
    }
}
