// SPDX-License-Identifier: GPL-2.0-only

use std::io;

use crate::config::Section;
use crate::runtime::HostIdentity;

/// Vendor code reported when neither the configuration nor the serial number
/// names one.
///
/// The CTC ONU serial number is reported as vendor bytes followed by the model
/// code, so an unset vendor ID follows the serial number this ONU registers
/// with instead of contradicting it.
const VENDOR_ID_FALLBACK: &[u8] = b"OWRT";

/// Software version reported when the running image does not name itself.
const SOFTWARE_VERSION_FALLBACK: &[u8] = b"OpenWrt";

#[derive(Clone, Debug)]
pub struct OamConfig {
    pub operator: String,
    pub ctc_oui: [u8; 3],
    pub ctc_versions: Vec<u8>,
    pub vendor_id: Vec<u8>,
    pub model: Vec<u8>,
    pub equipment_id: Vec<u8>,
    pub hardware_version: Vec<u8>,
    pub software_version: Vec<u8>,
    pub firmware_version: Vec<u8>,
    pub chipset_id: [u8; 8],
    pub loid: Vec<u8>,
    pub loid_password: Vec<u8>,
    pub ge_ports: u8,
}

impl Default for OamConfig {
    fn default() -> Self {
        Self {
            operator: "ctc".to_owned(),
            ctc_oui: [0x11, 0x11, 0x11],
            ctc_versions: vec![0x21, 0x30],
            vendor_id: Vec::new(),
            model: b"AN75".to_vec(),
            equipment_id: b"AN75".to_vec(),
            hardware_version: b"AN7581".to_vec(),
            software_version: Vec::new(),
            firmware_version: Vec::new(),
            chipset_id: [0x00, 0x00, 0x75, 0x81, 0x00, 0x00, 0x00, 0x00],
            loid: Vec::new(),
            loid_password: Vec::new(),
            ge_ports: 1,
        }
    }
}

impl OamConfig {
    /// Fill the fields this configuration left empty from the unit that runs it.
    ///
    /// `serial` is the serial number the line registers with, whose first four
    /// bytes are the vendor code the CTC ONU serial number carries; the software
    /// versions belong to the running image and are read from the system rather
    /// than pinned as constants. The CTC model and hardware fields are narrow
    /// fixed-width codes, so they keep their own defaults.
    pub fn adopt_system_identity(&mut self, host: &HostIdentity, serial: Option<&[u8; 8]>) {
        if self.vendor_id.is_empty() {
            self.vendor_id = serial
                .map(|serial| serial[..4].to_vec())
                .unwrap_or_else(|| VENDOR_ID_FALLBACK.to_vec());
        }

        let firmware = host
            .firmware
            .clone()
            .unwrap_or_else(|| SOFTWARE_VERSION_FALLBACK.to_vec());
        if self.software_version.is_empty() {
            self.software_version = firmware.clone();
        }
        if self.firmware_version.is_empty() {
            self.firmware_version = firmware;
        }
    }

    pub fn from_section(section: &Section) -> io::Result<Self> {
        let mut config = Self::default();

        if let Some(value) = section.option("operator").filter(|value| !value.is_empty()) {
            config.operator = value.to_owned();
        }
        if config.ctc_enabled() {
            if let Some(value) = section.option("ctc_oui").filter(|value| !value.is_empty()) {
                config.ctc_oui = parse_oui(value.as_bytes())?;
            }
            if let Some(value) = section
                .option("ctc_versions")
                .filter(|value| !value.is_empty())
            {
                config.ctc_versions = parse_versions(value.as_bytes())?;
            }
        }
        for (name, destination) in [
            ("vendor_id", &mut config.vendor_id),
            ("model", &mut config.model),
            ("equipment_id", &mut config.equipment_id),
            ("hardware_version", &mut config.hardware_version),
            ("software_version", &mut config.software_version),
            ("firmware_version", &mut config.firmware_version),
            ("loid", &mut config.loid),
            ("loid_password", &mut config.loid_password),
        ] {
            if let Some(value) = section.option(name).filter(|value| !value.is_empty()) {
                *destination = value.as_bytes().to_vec();
            }
        }
        if let Some(value) = section
            .option("chipset_id")
            .filter(|value| !value.is_empty())
        {
            config.chipset_id = parse_hex_array(value.as_bytes(), "chipset_id")?;
        }
        if let Some(value) = section.option("ge_ports").filter(|value| !value.is_empty()) {
            config.ge_ports = value.parse::<u8>().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "ge_ports must be an integer")
            })?;
        }

        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> io::Result<()> {
        if self.operator != "ieee" && self.operator != "ctc" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "operator must be ieee or ctc",
            ));
        }
        if self.ctc_enabled() && self.ctc_versions.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "ctc_versions is empty",
            ));
        }
        Ok(())
    }

    pub fn ctc_enabled(&self) -> bool {
        self.operator == "ctc"
    }
}

pub fn fixed_width(value: &[u8], width: usize) -> Vec<u8> {
    let mut output = vec![0; width];
    let copied = value.len().min(width);
    output[..copied].copy_from_slice(&value[..copied]);
    output
}

pub fn fixed_width_right(value: &[u8], width: usize) -> Vec<u8> {
    let mut output = vec![0; width];
    let copied = value.len().min(width);
    output[width - copied..].copy_from_slice(&value[..copied]);
    output
}

fn string_value(value: &[u8], key: &str) -> io::Result<String> {
    String::from_utf8(value.to_vec()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{key} is not valid UTF-8"),
        )
    })
}

fn parse_oui(value: &[u8]) -> io::Result<[u8; 3]> {
    parse_hex_array(value, "ctc_oui")
}

fn parse_hex_array<const N: usize>(value: &[u8], key: &str) -> io::Result<[u8; N]> {
    let text = string_value(value, key)?;
    let text = text.trim_start_matches("0x");
    if text.len() != N * 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{key} must contain {} hexadecimal digits", N * 2),
        ));
    }

    let mut output = [0u8; N];
    for (index, destination) in output.iter_mut().enumerate() {
        *destination = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{key} contains a non-hex digit"),
            )
        })?;
    }
    Ok(output)
}

fn parse_versions(value: &[u8]) -> io::Result<Vec<u8>> {
    let text = string_value(value, "ctc_versions")?;
    let mut versions = Vec::new();
    for field in text.split(|character: char| character.is_ascii_whitespace() || character == ',') {
        if field.is_empty() {
            continue;
        }
        let field = field.trim_start_matches("0x");
        let version = u8::from_str_radix(field, 16).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "ctc_versions contains a non-hex value",
            )
        })?;
        if !versions.contains(&version) {
            versions.push(version);
        }
    }
    Ok(versions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::PonConfig;

    #[test]
    fn chipset_id_uses_network_byte_order() {
        assert_eq!(
            parse_hex_array::<8>(b"01f2cce4010c060e", "chipset_id").unwrap(),
            [0x01, 0xf2, 0xcc, 0xe4, 0x01, 0x0c, 0x06, 0x0e]
        );
    }

    #[test]
    fn chipset_id_requires_eight_bytes() {
        assert!(parse_hex_array::<8>(b"7581", "chipset_id").is_err());
        assert!(parse_hex_array::<8>(b"01f2cce4010c06zz", "chipset_id").is_err());
    }

    #[test]
    fn empty_uci_values_are_filled_from_the_unit() {
        let config = PonConfig::parse(
            "config oam 'line0_oam'\n\
             \toption line 'line0'\n\
             \toption vendor_id ''\n\
             \toption software_version ''\n\
             \toption firmware_version ''\n\
             \toption chipset_id ''\n",
        )
        .unwrap();
        let mut oam =
            OamConfig::from_section(config.linked_section("oam", "line0").unwrap()).unwrap();

        assert_eq!(oam.chipset_id, [0x00, 0x00, 0x75, 0x81, 0, 0, 0, 0]);
        assert!(oam.vendor_id.is_empty());

        oam.adopt_system_identity(
            &HostIdentity {
                model: Some(b"Gemtek XG2010G".to_vec()),
                firmware: Some(b"23.05.4".to_vec()),
            },
            Some(b"GTKM\x12\x34\x56\x78"),
        );

        assert_eq!(oam.vendor_id, b"GTKM");
        assert_eq!(oam.software_version, b"23.05.4");
        assert_eq!(oam.firmware_version, b"23.05.4");
    }

    #[test]
    fn a_configured_identity_is_never_overwritten() {
        let config = PonConfig::parse(
            "config oam 'line0_oam'\n\
             \toption line 'line0'\n\
             \toption vendor_id 'ABCD'\n\
             \toption software_version 'V1.0.0'\n\
             \toption firmware_version 'V1.0.0'\n",
        )
        .unwrap();
        let mut oam =
            OamConfig::from_section(config.linked_section("oam", "line0").unwrap()).unwrap();

        oam.adopt_system_identity(
            &HostIdentity {
                model: Some(b"Gemtek XG2010G".to_vec()),
                firmware: Some(b"23.05.4".to_vec()),
            },
            Some(b"GTKM\x12\x34\x56\x78"),
        );

        assert_eq!(oam.vendor_id, b"ABCD");
        assert_eq!(oam.software_version, b"V1.0.0");
        assert_eq!(oam.firmware_version, b"V1.0.0");
    }

    #[test]
    fn a_line_without_a_serial_number_keeps_the_vendor_placeholder() {
        let mut oam = OamConfig::default();

        oam.adopt_system_identity(&HostIdentity::default(), None);

        assert_eq!(oam.vendor_id, VENDOR_ID_FALLBACK);
        assert_eq!(oam.software_version, SOFTWARE_VERSION_FALLBACK);
    }

    #[test]
    fn ieee_mode_ignores_ctc_parameters() {
        let config = PonConfig::parse(
            "config oam 'line0_oam'\n\
             \toption line 'line0'\n\
             \toption operator 'ieee'\n\
             \toption ctc_oui 'invalid'\n\
             \toption ctc_versions 'invalid'\n",
        )
        .unwrap();
        let oam = OamConfig::from_section(config.linked_section("oam", "line0").unwrap()).unwrap();

        assert!(!oam.ctc_enabled());
        assert_eq!(oam.ctc_oui, OamConfig::default().ctc_oui);
        assert_eq!(oam.ctc_versions, OamConfig::default().ctc_versions);
    }
}
