// SPDX-License-Identifier: GPL-2.0-only

use crate::config::Section;
use crate::runtime::HostIdentity;

/// Vendor code reported when neither the configuration nor the serial number
/// names one.
///
/// This is a last resort and not an answer: G.988 defines ONU-G attribute 1 as
/// the vendor bytes of the serial number, so the serial number is what names
/// the vendor on every line that has one.
const VENDOR_ID_FALLBACK: &[u8] = b"OWRT";

/// Software version reported when the running image does not name itself.
const SOFTWARE_VERSION_FALLBACK: &[u8] = b"OpenWrt";

/// Equipment ID reported when the board does not name itself.
const EQUIPMENT_ID_FALLBACK: &[u8] = b"AN7581-XG-PON-ONU";

/// Hardware version reported when the board does not name itself.
const HARDWARE_VERSION_FALLBACK: &[u8] = b"AN7581";

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

/// ONU type code points, in the order the carrier specs define them.
///
/// The OLT reads this to decide which provisioning template it applies: an SFU
/// is managed through PPTP UNIs, an HGU through a VEIP, and an SBU is the
/// business-line variant of the SFU service model. The code points are fixed by
/// the carrier specifications rather than chosen here.
pub const ONU_TYPE_SFU: u8 = 0;
pub const ONU_TYPE_HGU: u8 = 1;
pub const ONU_TYPE_SBU: u8 = 2;

/// Tx power supply control code point reported by the capability ME.
///
/// 0 is "no independent power control". This userspace implements none, so the
/// line does not claim any: the vendor stacks default to 2 (independent Tx and
/// Rx power control) because their driver implements it.
pub const ONU_TX_POWER_CONTROL_NONE: u8 = 0;

/// One carrier's ONU capability ME.
///
/// Both Chinese carrier specs carry the same four attributes in the same order
/// - operator ID, spec version, ONU type, Tx power supply control - and differ
/// in the class and in the operator ID string, so one shape with a few
/// constants describes either of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilityMe {
    pub class_id: u16,
    pub operator_id: &'static [u8],
    /// Spec version reported when the line does not name one.
    pub spec_version: u8,
}

/// China Telecom ONU capability, class 0xFFF9.
///
/// Telecom's spec-version field is left at the baseline the reference stack
/// ships (0), and the operator ID is the one the reference writes.
pub const CTC_ONU_CAPABILITY: CapabilityMe = CapabilityMe {
    class_id: 0xfff9,
    operator_id: b"CTC",
    spec_version: 0,
};

/// China Unicom ONU capability, class 0xFFB1.
///
/// Unicom numbers its spec versions V3 through V6; the reference stack reports
/// V6, which is the code point 3.
pub const CUC_ONU_CAPABILITY: CapabilityMe = CapabilityMe {
    class_id: 0xffb1,
    operator_id: b"CUC",
    spec_version: 3,
};

/// Which carrier capability ME, if any, a line offers.
///
/// The capability ME is where an OLT learns the ONU class, and the carriers do
/// not share one. Both equipment-side references available here - the Realtek
/// OMCI source and the Airoha OMCI adapter - implement a capability ME for
/// Telecom (0xFFF9) and a second one for Unicom (0xFFB1), and neither
/// implements a China Mobile one, so Mobile lines keep the standard MIB and the
/// OLT its own template.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CarrierProfile {
    /// Every capability ME this userspace knows. Each OLT reads its own class
    /// and ignores the other, so one image serves all of them.
    Auto,
    Ctc,
    Cuc,
    /// China Mobile: no capability ME, because no reference defines one here.
    Cmcc,
}

impl CarrierProfile {
    pub fn name(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Ctc => "ctc",
            Self::Cuc => "cuc",
            Self::Cmcc => "cmcc",
        }
    }

    /// Parse the `carrier` option. An unset or unknown value keeps the default
    /// rather than failing the line: a profile only decides which capability ME
    /// is offered, so guessing wrong costs a template, not the registration.
    pub fn from_option(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("ctc") => Self::Ctc,
            Some("cuc") => Self::Cuc,
            Some("cmcc") => Self::Cmcc,
            Some("") | Some("auto") | None => Self::Auto,
            Some(other) => {
                println!("Invalid OMCI carrier {other:?}; using {}", Self::Auto.name());
                Self::Auto
            }
        }
    }

    /// The capability MEs this profile offers.
    pub fn capabilities(self) -> &'static [CapabilityMe] {
        match self {
            Self::Auto => &[CTC_ONU_CAPABILITY, CUC_ONU_CAPABILITY],
            Self::Ctc => &[CTC_ONU_CAPABILITY],
            Self::Cuc => &[CUC_ONU_CAPABILITY],
            Self::Cmcc => &[],
        }
    }

    pub fn advertises(self, class_id: u16) -> bool {
        self.capabilities()
            .iter()
            .any(|capability| capability.class_id == class_id)
    }
}

#[derive(Clone, Debug)]
pub struct IdentityConfig {
    pub omcc_version: u8,
    /// ONU type reported in the carrier capability ME.
    pub onu_type: u8,
    /// Which carrier capability ME the line offers.
    pub carrier: CarrierProfile,
    /// Spec version byte for that ME; unset follows the carrier's default.
    pub carrier_spec: Option<u8>,
    pub disable_enhanced_security: bool,
    /// Seconds a data path may wait for PLOAM Alloc-IDs before it is reported as failed; 0 never fails.
    pub alloc_id_timeout: u32,
    /// Empty follows the vendor bytes of the serial number.
    pub vendor_id: Vec<u8>,
    /// Whether `vendor_id` came from the configuration.
    ///
    /// A vendor ID that follows the serial number has to keep following it: the
    /// driver latches the registration identity when the line opens, which can
    /// be after this agent starts, so the serial number may still be missing
    /// when the identity is first adopted.
    pub vendor_id_configured: bool,
    pub equipment_id: Vec<u8>,
    /// Equipment model name from the nameplate, reported with the equipment ID.
    pub model: Vec<u8>,
    /// Empty follows the board model.
    pub hardware_version: Vec<u8>,
    /// Empty follows the firmware version of the running image.
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
            onu_type: ONU_TYPE_HGU,
            carrier: CarrierProfile::Auto,
            carrier_spec: None,
            disable_enhanced_security: false,
            alloc_id_timeout: 30,
            vendor_id: Vec::new(),
            vendor_id_configured: false,
            equipment_id: Vec::new(),
            model: Vec::new(),
            hardware_version: Vec::new(),
            software_version: Vec::new(),
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
        /*
         * The OMCC version is the OMCI baseline advertised to the OLT, so it is
         * an opaque byte rather than a boolean: 0x86 has to stay selectable even
         * though it is also an unrelated CTC result code elsewhere. The value is
         * normalised to lower case first, because the constants are written both
         * ways by hand, and it is printed back as 0x{:02x}.
         */
        if let Some(value) = section.option("omcc_version") {
            let normalised = value.to_ascii_lowercase();

            match normalised.as_str() {
                "0x86" => config.omcc_version = 0x86,
                "0xa0" => config.omcc_version = 0xa0,
                "0xa8" => config.omcc_version = 0xa8,
                "0xb4" => config.omcc_version = 0xb4,
                "0xb0" => config.omcc_version = 0xb0,
                /* An empty or unknown value keeps the default. */
                "" => {}
                _ => println!("Invalid OMCI omcc_version {value:?}; using 0xb0"),
            }
        }
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
            ("model", &mut config.model),
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

        /* A vendor ID written into the configuration is a decision, an empty
         * one is not: the serial number decides what the vendor code is. */
        config.vendor_id_configured = !config.vendor_id.is_empty();

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

    /// Read the ONU type reported in the carrier capability ME.
    ///
    /// The value is kept out of `from_section` on purpose: the interface groups
    /// it with the line mode, so it is stored on the `xpon` section while every
    /// other identity field lives on the linked `omci` one. An unset or unknown
    /// value keeps the default rather than failing the line, because a wrong code
    /// point here costs the OLT its provisioning template, not the registration.
    pub fn set_onu_type(&mut self, value: Option<&str>) {
        match value.map(str::trim) {
            Some("0") => self.onu_type = ONU_TYPE_SFU,
            Some("1") => self.onu_type = ONU_TYPE_HGU,
            Some("2") => self.onu_type = ONU_TYPE_SBU,
            Some("") | None => {}
            Some(other) => println!("Invalid OMCI onu_type {other:?}; using {}", self.onu_type),
        }
    }

    /// Read which carrier capability ME the line offers.
    ///
    /// Like the ONU type it lives on the line section, because it describes how
    /// the line registers with the operator rather than how OMCI negotiates.
    pub fn set_carrier(&mut self, value: Option<&str>) {
        self.carrier = CarrierProfile::from_option(value);
    }

    /// Read the operator spec version byte, when the line names one.
    ///
    /// Operators revise their capability ME between spec versions, so the value
    /// is a byte rather than a boolean; an unset option keeps the default each
    /// carrier ships, and an unparsable one is reported and ignored.
    pub fn set_carrier_spec(&mut self, value: Option<&str>) {
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return;
        };
        let parsed = value
            .strip_prefix("0x")
            .or_else(|| value.strip_prefix("0X"))
            .map(|hex| u8::from_str_radix(hex, 16))
            .unwrap_or_else(|| value.parse());

        match parsed {
            Ok(spec) => self.carrier_spec = Some(spec),
            Err(_) => println!("Invalid OMCI carrier_spec {value:?}; using the carrier default"),
        }
    }

    /// The spec version byte to report for one capability ME.
    pub fn spec_version_for(&self, capability: &CapabilityMe) -> u8 {
        self.carrier_spec.unwrap_or(capability.spec_version)
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
        match self.parsed_serial() {
            Some(serial) => serial,
            None => {
                if !self.serial_number.is_empty() {
                    println!("Invalid OMCI serial number; using the vendor ID with a zero VSSN");
                }

                let mut value = fixed_width(&self.vendor_id, 4);
                value.extend_from_slice(&[0; 4]);
                value
            }
        }
    }

    /// Fill the fields this configuration left empty from the unit that runs it.
    ///
    /// The identity an OLT reads describes the unit rather than the userspace
    /// reporting it. The vendor ID is defined as the vendor bytes of the serial
    /// number the ONU registers with, so a placeholder there would contradict
    /// the serial number the OLT has just registered; the software version
    /// belongs to the running image and the hardware version to the board, and
    /// both are read from the system instead of being pinned as constants. A
    /// field the configuration names explicitly is never overwritten, and the
    /// placeholders below only cover a unit that cannot answer for itself.
    pub fn adopt_system_identity(&mut self, host: &HostIdentity) {
        if !self.vendor_id_configured {
            self.vendor_id = self
                .serial_vendor_id()
                .unwrap_or_else(|| VENDOR_ID_FALLBACK.to_vec());
        }
        if self.equipment_id.is_empty() {
            self.equipment_id = host
                .model
                .clone()
                .unwrap_or_else(|| EQUIPMENT_ID_FALLBACK.to_vec());
        }
        if self.model.is_empty() {
            self.model = host
                .model
                .clone()
                .unwrap_or_else(|| EQUIPMENT_ID_FALLBACK.to_vec());
        }
        if self.hardware_version.is_empty() {
            self.hardware_version = host
                .model
                .clone()
                .unwrap_or_else(|| HARDWARE_VERSION_FALLBACK.to_vec());
        }
        if self.software_version.is_empty() {
            self.software_version = host
                .firmware
                .clone()
                .unwrap_or_else(|| SOFTWARE_VERSION_FALLBACK.to_vec());
        }
    }

    /// The vendor bytes of the serial number this ONU registers with.
    fn serial_vendor_id(&self) -> Option<Vec<u8>> {
        self.parsed_serial()
            .map(|serial| serial[..4].to_vec())
    }

    /// The eight-byte serial number, when one is configured or has been learned
    /// from the active PLOAM registration.
    fn parsed_serial(&self) -> Option<Vec<u8>> {
        if self.serial_number.is_empty() {
            return None;
        }

        if self.serial_number.len() == 8 {
            return Some(self.serial_number.clone());
        }

        let text = std::str::from_utf8(&self.serial_number).ok()?.trim();
        let raw_hex = text.strip_prefix("hex:").unwrap_or(text);
        if raw_hex.len() == 16 {
            if let Ok(value) = decode_hex(raw_hex) {
                return Some(value);
            }
        }
        if text.len() == 12 && text.is_ascii() {
            if let Ok(tail) = decode_hex(&text[4..]) {
                let mut value = text.as_bytes()[..4].to_vec();
                value.extend_from_slice(&tail);
                return Some(value);
            }
        }

        None
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
    fn empty_uci_values_are_filled_from_the_unit() {
        // An empty option means "not decided here", so the identity comes from
        // the unit itself: the vendor bytes of the registered serial number, the
        // model on the board, and the firmware the image was built from.
        let config = PonConfig::parse(
            "config omci 'line0_omci'\n\
             \toption line 'line0'\n\
             \toption vendor_id ''\n\
             \toption equipment_id ''\n\
             \toption hardware_version ''\n\
             \toption software_version ''\n\
             \toption serial_number 'GTKM12345678'\n\
             \toption loid ''\n",
        )
        .unwrap();
        let mut identity =
            IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap());

        assert!(identity.vendor_id.is_empty());
        assert!(identity.loid.is_empty());

        identity.adopt_system_identity(&HostIdentity {
            model: Some(b"Gemtek XG2010G".to_vec()),
            firmware: Some(b"23.05.4".to_vec()),
        });

        assert_eq!(identity.vendor_id, b"GTKM");
        assert_eq!(identity.equipment_id, b"Gemtek XG2010G");
        assert_eq!(identity.hardware_version, b"Gemtek XG2010G");
        assert_eq!(identity.software_version, b"23.05.4");
        // The eight ASCII digits of the serial are the four binary serial bytes.
        assert_eq!(identity.onu_g_serial(), b"GTKM\x12\x34\x56\x78");
    }

    #[test]
    fn a_configured_identity_is_never_overwritten() {
        let config = PonConfig::parse(
            "config omci 'line0_omci'\n\
             \toption line 'line0'\n\
             \toption vendor_id 'ABCD'\n\
             \toption model 'NAME-PLATE'\n\
             \toption hardware_version 'V1.0'\n\
             \toption software_version 'V1.0.0'\n\
             \toption serial_number 'GTKM12345678'\n",
        )
        .unwrap();
        let mut identity =
            IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap());

        identity.adopt_system_identity(&HostIdentity {
            model: Some(b"Gemtek XG2010G".to_vec()),
            firmware: Some(b"23.05.4".to_vec()),
        });

        assert_eq!(identity.vendor_id, b"ABCD");
        assert_eq!(identity.model, b"NAME-PLATE");
        assert_eq!(identity.hardware_version, b"V1.0");
        assert_eq!(identity.software_version, b"V1.0.0");
    }

    #[test]
    fn a_unit_that_cannot_name_itself_keeps_the_placeholders() {
        // Nothing configured and nothing readable: the placeholders are the last
        // resort so the attributes are never blank.
        let mut identity = IdentityConfig::default();

        identity.adopt_system_identity(&HostIdentity::default());

        assert_eq!(identity.vendor_id, VENDOR_ID_FALLBACK);
        assert_eq!(identity.equipment_id, EQUIPMENT_ID_FALLBACK);
        assert_eq!(identity.hardware_version, HARDWARE_VERSION_FALLBACK);
        assert_eq!(identity.software_version, SOFTWARE_VERSION_FALLBACK);
        assert_eq!(identity.onu_g_serial(), b"OWRT\0\0\0\0");
    }

    #[test]
    fn the_vendor_id_follows_the_serial_learned_from_the_registration() {
        // The kernel reports the active serial number as eight raw bytes, which
        // is what the OLT has just registered the ONU under.
        let mut identity = IdentityConfig {
            serial_number: b"HWTC\0\x12\x34\x56".to_vec(),
            ..IdentityConfig::default()
        };

        identity.adopt_system_identity(&HostIdentity::default());

        assert_eq!(identity.vendor_id, b"HWTC");
        assert_eq!(identity.onu_g_serial(), b"HWTC\0\x12\x34\x56");
    }

    #[test]
    fn a_late_serial_number_still_names_the_vendor() {
        // The driver only latches the registration identity when the line opens,
        // so the first adoption can find no serial number at all. The placeholder
        // must not survive once the serial number does arrive.
        let mut identity = IdentityConfig::default();

        identity.adopt_system_identity(&HostIdentity::default());
        assert_eq!(identity.vendor_id, VENDOR_ID_FALLBACK);

        identity.serial_number = b"ZTEG\x10\x50\x2e\x88".to_vec();
        identity.adopt_system_identity(&HostIdentity::default());

        assert_eq!(identity.vendor_id, b"ZTEG");
        assert_eq!(identity.onu_g_serial(), b"ZTEG\x10\x50\x2e\x88");
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

    fn omcc_version_with(value: &str) -> u8 {
        let config = PonConfig::parse(&format!(
            "config omci 'line0_omci'\
             \n\toption line 'line0'\
             \n\toption omcc_version '{value}'\n"
        ))
        .unwrap();

        IdentityConfig::from_section(config.linked_section("omci", "line0").unwrap()).omcc_version
    }

    fn onu_type_with(value: Option<&str>) -> u8 {
        let mut identity = IdentityConfig::default();

        identity.set_onu_type(value);

        identity.onu_type
    }

    #[test]
    fn every_offered_onu_type_round_trips() {
        // The interface offers these three types; each has to survive parsing
        // unchanged instead of collapsing onto the default.
        assert_eq!(onu_type_with(Some("0")), ONU_TYPE_SFU);
        assert_eq!(onu_type_with(Some("1")), ONU_TYPE_HGU);
        assert_eq!(onu_type_with(Some("2")), ONU_TYPE_SBU);
    }

    #[test]
    fn an_unset_onu_type_stays_an_hgu() {
        // A line written before this option existed still has to register, and
        // the home gateway is the class this userspace actually implements.
        assert_eq!(onu_type_with(None), ONU_TYPE_HGU);
        assert_eq!(onu_type_with(Some("")), ONU_TYPE_HGU);
        assert_eq!(IdentityConfig::default().onu_type, ONU_TYPE_HGU);
    }

    #[test]
    fn an_unknown_onu_type_keeps_the_default() {
        // Code points past the offered set are a different MIB model, not a
        // typo to guess at, so the line keeps registering as an HGU.
        assert_eq!(onu_type_with(Some("3")), ONU_TYPE_HGU);
        assert_eq!(onu_type_with(Some("hgu")), ONU_TYPE_HGU);
    }

    fn carrier_with(value: Option<&str>) -> CarrierProfile {
        let mut identity = IdentityConfig::default();

        identity.set_carrier(value);

        identity.carrier
    }

    #[test]
    fn every_offered_carrier_round_trips() {
        assert_eq!(carrier_with(Some("ctc")), CarrierProfile::Ctc);
        assert_eq!(carrier_with(Some("cuc")), CarrierProfile::Cuc);
        assert_eq!(carrier_with(Some("cmcc")), CarrierProfile::Cmcc);
        assert_eq!(carrier_with(Some(" auto ")), CarrierProfile::Auto);
    }

    #[test]
    fn an_unset_carrier_offers_every_capability_me() {
        // No decision means the line works on any of the operators this
        // userspace has a capability ME for.
        assert_eq!(carrier_with(None), CarrierProfile::Auto);
        assert_eq!(carrier_with(Some("")), CarrierProfile::Auto);
        assert_eq!(IdentityConfig::default().carrier, CarrierProfile::Auto);
        assert_eq!(
            CarrierProfile::Auto.capabilities(),
            &[CTC_ONU_CAPABILITY, CUC_ONU_CAPABILITY]
        );
    }

    #[test]
    fn a_named_carrier_offers_only_its_own_capability_me() {
        assert_eq!(
            CarrierProfile::Ctc.capabilities(),
            &[CTC_ONU_CAPABILITY]
        );
        assert_eq!(
            CarrierProfile::Cuc.capabilities(),
            &[CUC_ONU_CAPABILITY]
        );
        // No reference here defines a China Mobile capability ME, so the line
        // keeps the standard MIB rather than claiming one it cannot fill in.
        assert!(CarrierProfile::Cmcc.capabilities().is_empty());
        assert!(!CarrierProfile::Cmcc.advertises(CTC_ONU_CAPABILITY.class_id));
        assert!(CarrierProfile::Auto.advertises(CUC_ONU_CAPABILITY.class_id));
    }

    #[test]
    fn an_unknown_carrier_keeps_every_capability_me() {
        // A typo must not strand the line without a capability ME: the OLT would
        // fall back to its own template, which is the behaviour this option
        // exists to fix.
        assert_eq!(carrier_with(Some("telecom")), CarrierProfile::Auto);
    }

    #[test]
    fn the_capability_me_carries_its_carrier_identity() {
        assert_eq!(CTC_ONU_CAPABILITY.class_id, 0xfff9);
        assert_eq!(CTC_ONU_CAPABILITY.operator_id, b"CTC");
        assert_eq!(CUC_ONU_CAPABILITY.class_id, 0xffb1);
        assert_eq!(CUC_ONU_CAPABILITY.operator_id, b"CUC");
    }

    #[test]
    fn the_spec_version_follows_the_line_then_the_carrier() {
        let mut identity = IdentityConfig::default();

        assert_eq!(identity.spec_version_for(&CTC_ONU_CAPABILITY), 0);
        assert_eq!(identity.spec_version_for(&CUC_ONU_CAPABILITY), 3);

        identity.set_carrier_spec(Some("2"));

        assert_eq!(identity.spec_version_for(&CTC_ONU_CAPABILITY), 2);
        assert_eq!(identity.spec_version_for(&CUC_ONU_CAPABILITY), 2);
    }

    #[test]
    fn an_unknown_spec_version_keeps_the_carrier_default() {
        let mut identity = IdentityConfig::default();

        identity.set_carrier_spec(Some(""));
        assert_eq!(identity.spec_version_for(&CUC_ONU_CAPABILITY), 3);

        identity.set_carrier_spec(Some("0x21"));
        assert_eq!(identity.spec_version_for(&CUC_ONU_CAPABILITY), 0x21);

        identity.set_carrier_spec(Some("v6"));
        assert_eq!(identity.spec_version_for(&CUC_ONU_CAPABILITY), 0x21);
        assert_eq!(identity.carrier_spec, Some(0x21));
    }

    #[test]
    fn every_offered_omcc_version_round_trips() {
        // The UI offers these five baselines; each one has to survive parsing
        // unchanged instead of collapsing onto the default.
        assert_eq!(omcc_version_with("0x86"), 0x86);
        assert_eq!(omcc_version_with("0xa0"), 0xa0);
        assert_eq!(omcc_version_with("0xa8"), 0xa8);
        assert_eq!(omcc_version_with("0xb0"), 0xb0);
        assert_eq!(omcc_version_with("0xb4"), 0xb4);
    }

    #[test]
    fn an_omcc_version_is_case_insensitive() {
        // The constants are written both ways by hand in comments and notes.
        assert_eq!(omcc_version_with("0xA8"), 0xa8);
        assert_eq!(omcc_version_with("0xB4"), 0xb4);
    }

    #[test]
    fn an_unknown_omcc_version_keeps_the_default() {
        assert_eq!(omcc_version_with("0xff"), 0xb0);
        assert_eq!(omcc_version_with(""), 0xb0);
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
