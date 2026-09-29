// SPDX-License-Identifier: GPL-2.0-only

use crate::config::Section;

/// How the operator authenticates this line.
///
/// Operators do not agree on this: some issue a LOID, optionally with a
/// password, others authenticate the PLOAM registration ID and never use a LOID
/// at all. The two are mutually exclusive, so the mode is configured explicitly
/// instead of being guessed from which fields happen to be filled in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    /// The credential is `loid`, with `loid_password` only when the OLT asks for it.
    Loid,
    /// The credential is the registration ID; no LOID takes part in the exchange.
    Password,
}

impl AuthMode {
    pub fn name(self) -> &'static str {
        match self {
            Self::Loid => "loid",
            Self::Password => "password",
        }
    }
}

#[derive(Clone, Debug)]
pub struct IdentityConfig {
    pub omcc_version: u8,
    pub disable_enhanced_security: bool,
    /// Seconds a data path may wait for PLOAM Alloc-IDs before it is reported as failed; 0 never fails.
    pub alloc_id_timeout: u32,
    pub vendor_id: Vec<u8>,
    pub equipment_id: Vec<u8>,
    pub hardware_version: Vec<u8>,
    pub software_version: Vec<u8>,
    pub loid: Vec<u8>,
    pub loid_password: Vec<u8>,
    pub operator_id: Vec<u8>,
    pub serial_number: Vec<u8>,
    pub auth_mode: AuthMode,
}

impl Default for IdentityConfig {
    fn default() -> Self {
        Self {
            omcc_version: 0xb0,
            disable_enhanced_security: false,
            alloc_id_timeout: 30,
            vendor_id: b"OWRT".to_vec(),
            equipment_id: b"AN7581-XG-PON-ONU".to_vec(),
            hardware_version: b"AN7581".to_vec(),
            software_version: b"OpenWrt".to_vec(),
            loid: Vec::new(),
            loid_password: Vec::new(),
            operator_id: b"CTC".to_vec(),
            serial_number: Vec::new(),
            auth_mode: AuthMode::Loid,
        }
    }
}

impl IdentityConfig {
    pub fn from_section(section: &Section) -> Self {
        let mut config = Self::default();
        config.omcc_version = match section.option("omcc_version") {
            Some("0x86") => 0x86,
            _ => 0xb0,
        };
        config.disable_enhanced_security = section.option("disable_enhanced_security") == Some("1");
        if let Some(value) = section
            .option("alloc_id_timeout")
            .filter(|value| !value.is_empty())
        {
            match value.parse() {
                Ok(seconds) => config.alloc_id_timeout = seconds,
                Err(_) => println!(
                    "Invalid OMCI alloc_id_timeout {value:?}; using {} s",
                    config.alloc_id_timeout
                ),
            }
        }

        for (name, destination) in [
            ("vendor_id", &mut config.vendor_id),
            ("equipment_id", &mut config.equipment_id),
            ("hardware_version", &mut config.hardware_version),
            ("software_version", &mut config.software_version),
            ("loid", &mut config.loid),
            ("loid_password", &mut config.loid_password),
            ("operator_id", &mut config.operator_id),
            ("serial_number", &mut config.serial_number),
        ] {
            if let Some(value) = section.option(name).filter(|value| !value.is_empty()) {
                *destination = value.as_bytes().to_vec();
            }
        }

        /*
         * Read after the identity fields, because an unset option is not "no
         * decision": a configuration written before this option existed says which
         * mode it is by which credential it carries. A LOID is LOID
         * authentication; a line whose only identity is its registration ID
         * authenticates by that instead.
         */
        config.auth_mode = match section.option("auth_mode") {
            Some("loid") => AuthMode::Loid,
            Some("password") => AuthMode::Password,
            Some("") | None if !config.loid.is_empty() => AuthMode::Loid,
            Some("") | None => AuthMode::Password,
            Some(other) => {
                println!(
                    "Invalid OMCI auth_mode {other:?}; using {}",
                    AuthMode::Loid.name()
                );
                AuthMode::Loid
            }
        };

        config
    }

    /// Whether to expose the vendor CTC LOID Authentication ME to the OLT.
    ///
    /// The OLT authenticates a CTC LOID by looking it up in its own database and
    /// writing the result back: an empty LOID is answered with status 2,
    /// `loid-not-found`, followed by a Deactivate even on a line that had already
    /// reached O5. Leaving the ME out gives an OLT that authenticates the PLOAM
    /// registration ID nothing to reject, which is what the legacy userspace did:
    /// it carried a registration ID and no LOID at all.
    ///
    /// Within LOID authentication the password is secondary - it cannot make an
    /// empty LOID resolve - so only a configured LOID advertises the ME. That is
    /// not a failure either: without a LOID the line simply has nothing to offer
    /// the OLT and falls back to its registration ID.
    pub fn advertise_ctc_loid_auth(&self) -> bool {
        match self.auth_mode {
            // The choice is explicit: this operator authenticates the
            // registration ID, so a LOID must not be offered even if one is set.
            AuthMode::Password => false,
            AuthMode::Loid => !self.loid.is_empty(),
        }
    }

    pub fn onu_g_serial(&self) -> Vec<u8> {
        let fallback = || {
            let mut value = fixed_width(&self.vendor_id, 4);
            value.extend_from_slice(&[0; 4]);
            value
        };

        if self.serial_number.is_empty() {
            return fallback();
        }

        if self.serial_number.len() == 8 {
            return self.serial_number.clone();
        }

        let text = match std::str::from_utf8(&self.serial_number) {
            Ok(text) => text.trim(),
            Err(_) => return fallback(),
        };
        let raw_hex = text.strip_prefix("hex:").unwrap_or(text);
        if raw_hex.len() == 16 {
            if let Ok(value) = decode_hex(raw_hex) {
                return value;
            }
        }
        if text.len() == 12 && text.is_ascii() {
            if let Ok(tail) = decode_hex(&text[4..]) {
                let mut value = text.as_bytes()[..4].to_vec();
                value.extend_from_slice(&tail);
                return value;
            }
        }
        println!("Invalid OMCI serial number; using the vendor ID with a zero VSSN");
        fallback()
    }
}

pub fn fixed_width(value: &[u8], width: usize) -> Vec<u8> {
    let mut output = vec![0; width];
    let copied = value.len().min(width);
    output[..copied].copy_from_slice(&value[..copied]);
    output
}

pub fn decode_hex(input: &str) -> Result<Vec<u8>, &'static str> {
    let bytes = input.as_bytes();
    if bytes.len() % 2 != 0 {
        return Err("odd digit count");
    }

    let mut output = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let high = hex_nibble(pair[0]).ok_or("non-hex digit")?;
        let low = hex_nibble(pair[1]).ok_or("non-hex digit")?;
        output.push((high << 4) | low);
    }
    Ok(output)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::PonConfig;

    #[test]
    fn empty_uci_values_keep_protocol_defaults() {
        let config = PonConfig::parse(
            "config omci 'line0_omci'\n\
             \toption line 'line0'\n\
             \toption vendor_id ''\n\
             \toption loid ''\n",
        )
        .unwrap();
        let identity =
            IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap());

        assert_eq!(identity.vendor_id, b"OWRT");
        assert!(identity.loid.is_empty());
    }

    #[test]
    fn compatibility_options_select_the_omcc_profile() {
        let config = PonConfig::parse(
            "config omci 'line0_omci'\n\
             \toption line 'line0'\n\
             \toption omcc_version '0x86'\n\
             \toption disable_enhanced_security '1'\n\
             \toption alloc_id_timeout '0'\n",
        )
        .unwrap();
        let identity =
            IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap());

        assert_eq!(identity.omcc_version, 0x86);
        assert!(identity.disable_enhanced_security);
        assert_eq!(identity.alloc_id_timeout, 0);
        assert_eq!(IdentityConfig::default().omcc_version, 0xb0);
        assert!(!IdentityConfig::default().disable_enhanced_security);
        assert_eq!(IdentityConfig::default().alloc_id_timeout, 30);
    }

    fn identity_with(options: &str) -> IdentityConfig {
        let config = PonConfig::parse(&format!(
            "config omci 'line0_omci'\
             \n\toption line 'line0'\
             \n{options}"
        ))
        .unwrap();

        IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap())
    }

    #[test]
    fn a_line_without_a_loid_offers_no_ctc_authentication() {
        // Exposing an empty LOID only invites loid-not-found, while the
        // registration ID could have authenticated the line instead.
        let identity = identity_with("\toption loid ''\n");

        assert!(identity.loid.is_empty());
        assert!(!identity.advertise_ctc_loid_auth());
    }

    #[test]
    fn a_configured_loid_advertises_ctc_authentication() {
        let identity = identity_with("\toption loid 'operator-user'\n");

        assert_eq!(identity.auth_mode, AuthMode::Loid);
        assert!(identity.advertise_ctc_loid_auth());
    }

    #[test]
    fn a_loid_password_alone_still_has_nothing_for_the_olt_to_look_up() {
        // LOID plus password is one mode, not two: the password narrows it down,
        // it never replaces the LOID the OLT looks up.
        let identity = identity_with("\toption loid_password 'secret'\n");

        assert!(!identity.advertise_ctc_loid_auth());
    }

    #[test]
    fn password_mode_stops_offering_the_loid_even_when_one_is_stored() {
        let identity =
            identity_with("\toption loid 'stale-user'\n\toption auth_mode 'password'\n");

        assert_eq!(identity.auth_mode, AuthMode::Password);
        assert!(!identity.advertise_ctc_loid_auth());
    }

    #[test]
    fn loid_mode_is_selected_explicitly_and_by_a_stored_loid() {
        assert_eq!(
            identity_with("\toption loid 'operator-user'\n\toption auth_mode 'loid'\n").auth_mode,
            AuthMode::Loid
        );
        // An installation written before auth_mode existed.
        assert_eq!(
            identity_with("\toption loid 'operator-user'\n").auth_mode,
            AuthMode::Loid
        );
        assert_eq!(identity_with("").auth_mode, AuthMode::Password);
    }

    #[test]
    fn an_invalid_auth_mode_falls_back_to_the_stored_identity() {
        assert_eq!(
            identity_with("\toption loid 'operator-user'\n\toption auth_mode 'password-only'\n")
                .auth_mode,
            AuthMode::Loid
        );
    }
}
