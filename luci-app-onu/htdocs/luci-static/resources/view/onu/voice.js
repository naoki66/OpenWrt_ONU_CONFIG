// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require uci';
'require view';

var STYLESHEET = 'view/onu/onu.css';

/* Fully qualified name of the protocol list: <config>.<section>.<option>. */
var PROTOCOL_OPTION = 'onu-voice.config.protocol';
var VOICE_DEVICE = 'ct-voice';

/*
 * The board carries a single FXS port, so there is no port to pick and no
 * line card: the port is identified by these three hardware facts and its
 * parameters live in the voice profile. Naming them here keeps the page and
 * the driver node the voice service opens readable against each other.
 */
/*
 * The PON views follow luci-theme-argon: cards, form rows and buttons all come
 * from the theme. Only the small helper stylesheet is ours.
 */
function ensureStylesheet() {
	var href;

	if (document.querySelector('link[data-pon-stylesheet]'))
		return;

	href = (typeof L.resource == 'function') ? L.resource(STYLESHEET) : null;

	if (!href)
		href = ((L.env && L.env.base_url) || '/luci-static/resources') + '/' + STYLESHEET;

	document.head.appendChild(E('link', {
		'rel': 'stylesheet',
		'href': href,
		'data-pon-stylesheet': ''
	}));
}

function validateFlashHookRange(sectionId, value) {
	var minimum = parseInt(this.section.formvalue(sectionId, 'flashhook_min'), 10);

	/* An empty minimum is reported by its own required check; only compare
	   the two values when both are numbers. */
	if (isNaN(minimum) || parseInt(value, 10) > minimum)
		return true;

	return _('The maximum flash hook interval must be greater than the minimum one.');
}

/*
 * LuCI combines the keys of a single depends({ ... }) object with "and" while
 * treating repeated depends() calls as alternatives ("or"), so the protocol
 * switch and any nested constraint have to be spelled out as one object per
 * protocol value. A key containing a dot is resolved as cbid.<key>, which is
 * how an option living in another section is reached - here the protocol list
 * of the "config" section.
 */
function dependsOnProtocols(o, protocols, extra) {
	protocols.forEach(function(protocol) {
		var dep = {};

		dep[PROTOCOL_OPTION] = protocol;

		for (var name in extra || {})
			dep[name] = extra[name];

		o.depends(dep);
	});

	return o;
}

/* The H.248 block is only relevant for the H.248 protocol. */
function forH248(o, extra) {
	return dependsOnProtocols(o, [ 'h248' ], extra);
}

/* The SIP block serves both the softswitch and the IMS flavour. */
function forSip(o, extra) {
	return dependsOnProtocols(o, [ 'sip', 'ims_sip' ], extra);
}

/*
 * The voice service runs on the PON uplink in a VLAN of its own, handed to the
 * kernel as an 8021q subinterface of the physical PON device rather than as a
 * br-lan member. Showing the fixed managed device keeps this page and the
 * script readable against each other, the same way the internet page does it.
 */
function derivedVoiceDevice() {
	if (uci.get('onu-voice', 'network', 'enabled') !== '1')
		return '-';

	var vid = uci.get('onu-voice', 'network', 'vlan_id');
	var uplink = uci.get('onu-voice', 'network', 'uplink') || 'pon0';

	return '%s.%s (%s)'.format(uplink, vid || '?', VOICE_DEVICE);
}

/*
 * voice-apply refuses to share a VLAN with the internet or the IPTV page: two
 * services on one 8021q subinterface would end up in one zone and defeat the
 * isolation the voice zone exists for.
 */
function validateVoiceVlan(sectionId, value) {
	var vid = String(value || '');
	var netVlan = uci.get('onu-internet', 'config', 'vlan');
	var iptvVlans = L.toArray(uci.get('onu-iptv', 'config', 'service_vlan'))
		.concat(L.toArray(uci.get('onu-iptv', 'config', 'multicast_vlan')))
		.concat(L.toArray(uci.get('onu-iptv', 'config', 'igmp_vlan')));
	var i;

	if (uci.get('onu-internet', 'config', 'enabled') === '1' && vid === String(netVlan))
		return _('This VLAN carries the internet service; pick a different one for voice.');

	if (uci.get('onu-iptv', 'config', 'enabled') === '1')
		for (i = 0; i < iptvVlans.length; i++)
			if (vid === String(iptvVlans[i]))
				return _('This VLAN carries the IPTV service; pick a different one for voice.');

	return true;
}

/*
 * The dependencies above hide every option of the H.248 and SIP sections, but
 * LuCI still renders the two section containers, so switching the protocol
 * would leave an empty card behind. LuCI puts the "cbi-onu-voice-<name>" id on the
 * inner "cbi-section-node" element; the card to hide is the surrounding
 * "cbi-section" div which also carries the heading.
 */
function sectionCard(node, name) {
	/*
	 * A NamedSection whose name equals its UCI type (the h248 and sip
	 * sections below) makes LuCI stamp the same id, cbi-onu-voice-<name>, on both
	 * the outer .cbi-section card and the inner .cbi-section-node. Pin the
	 * selector to the card so the heading collapses with the body; fall back
	 * to the bare id if a future LuCI no longer carries the class.
	 */
	var card = node.querySelector('#cbi-onu-voice-' + name + '.cbi-section')
		|| node.querySelector('#cbi-onu-voice-' + name);

	return card || null;
}

function toggleProtocolSections(node, protocolOption) {
	var h248 = sectionCard(node, 'h248');
	var sip = sectionCard(node, 'sip');
	var frame = node.querySelector('#cbi-onu-voice-config-protocol');

	function update() {
		var value = protocolOption ? protocolOption.formvalue('config') : null;

		/* Guard every DOM access: an undefined card (section not rendered,
		   or a LuCI id scheme we did not anticipate) must never turn a render
		   into a thrown TypeError. */
		if (h248 && h248.classList)
			h248.classList[(value === 'h248') ? 'remove' : 'add']('hidden');

		if (sip && sip.classList)
			sip.classList[(value === 'sip' || value === 'ims_sip') ? 'remove' : 'add']('hidden');
	}

	if (protocolOption)
		protocolOption.onchange = update;

	/* The native events bubble up to the option frame; LuCI's own
	   "widget-change" event is already wired through onchange above. */
	if (frame) {
		frame.addEventListener('change', update);
		frame.addEventListener('input', update);
	}

	update();
}

function serverOption(s, tab, name, title, descr) {
	var o = s.taboption(tab, form.Value, name, title, descr);

	o.datatype = 'or(hostname,ipaddr)';
	o.rmempty = true;

	return forSip(o);
}

function portOption(s, tab, name, title) {
	var o = s.taboption(tab, form.Value, name, title);

	o.datatype = 'range(1,65534)';
	o.placeholder = '5060';
	o.rmempty = false;

	return forSip(o);
}

function transportOption(s, tab, name, title) {
	var o = s.taboption(tab, form.ListValue, name, title);

	o.default = 'udp';
	o.value('udp', 'UDP');
	o.value('tcp', 'TCP');
	o.value('tls', 'TLS');
	o.rmempty = false;

	return forSip(o);
}

return view.extend({
	load: function() {
		/*
		 * internet and iptv are read too: the voice VLAN must not collide
		 * with either service, and that check reads their VLAN options.
		 */
		return Promise.all([
			uci.load('onu-voice'),
			uci.load('onu-internet'),
			uci.load('onu-iptv')
		]);
	},

	render: function() {
		var m, s, o, protocolOption;

		ensureStylesheet();

		m = new form.Map('onu-voice', _('Voice'),
			_('Voice services carried by the PON uplink.'));
		m.readonly = !L.hasViewPermission();

		/* ---------------------------------------------------------------- *
		 * Voice network                                                    *
		 * ---------------------------------------------------------------- */

		/*
		 * The IP carrier under the voice service. It is a VLAN of the PON
		 * uplink, not a br-lan member: bridging the voice VLAN into the LAN
		 * would mix the two and defeat the dedicated firewall zone below.
		 * The section is unsigned and lives before the profile so the
		 * topology is read before the signalling that rides on it.
		 */
		s = m.section(form.NamedSection, 'network', 'network', _('Voice network'),
			_('The IP network carrying the voice service. It is an 8021q VLAN of the PON uplink and has its own firewall zone.'));
		s.anonymous = true;
		s.addremove = false;

		/*
		 * The one switch of the page. It lives with the carrier because that
		 * is all the backend does today: voice-apply turns this flag into the
		 * VLAN subinterface, the voice interface and the firewall zone, and
		 * writes nothing at all when it is off. The voice profile used to
		 * carry a second "enable voice service" flag of its own, but nothing
		 * ever read it - no voice daemon exists - so the two collapsed into
		 * this one rather than leaving a switch that does nothing.
		 */
		o = s.option(form.Flag, 'enabled', _('Enable voice service'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('Enable the voice service.');

		o = s.option(form.Value, 'uplink', _('Uplink device'),
			_('Physical PON device carrying the voice VLAN, normally pon0.'));
		o.default = 'pon0';
		o.rmempty = false;
		o.validate = function(sectionId, value) {
			if (!/^[A-Za-z0-9_.:-]{1,15}$/.test(value || ''))
				return _('Use a Linux network device name containing at most 15 characters.');
			return true;
		};
		o.depends('enabled', '1');

		o = s.option(form.Value, 'vlan_id', _('VLAN ID'),
			_('VLAN carrying the voice service. It becomes the managed device ct-voice on the selected uplink.'));
		o.datatype = 'range(1,4094)';
		o.placeholder = '840';
		o.rmempty = false;
		o.validate = validateVoiceVlan;
		o.depends('enabled', '1');

		o = s.option(form.ListValue, 'proto', _('IP assignment'),
			_('How the voice interface obtains its address.'));
		o.default = 'dhcp';
		o.rmempty = false;
		o.value('dhcp', _('DHCP'));
		o.value('static', _('Static'));
		o.depends('enabled', '1');

		o = s.option(form.Value, 'ipaddr', _('IP address'),
			_('Address of the voice interface on the voice VLAN.'));
		o.datatype = 'ip4addr';
		o.placeholder = '10.0.0.2';
		o.rmempty = false;
		o.depends({ enabled: '1', proto: 'static' });

		o = s.option(form.Value, 'netmask', _('Subnet mask'));
		o.datatype = 'ip4addr';
		o.placeholder = '255.255.255.0';
		o.rmempty = false;
		o.depends({ enabled: '1', proto: 'static' });

		o = s.option(form.Value, 'gateway', _('Gateway'),
			_('Default gateway of the voice VLAN.'));
		o.datatype = 'ip4addr';
		o.placeholder = '10.0.0.1';
		o.rmempty = true;
		o.depends({ enabled: '1', proto: 'static' });

		o = s.option(form.Value, 'dns', _('DNS servers'),
			_('Comma-separated DNS servers used by the voice service.'));
		o.datatype = 'list(ip4addr)';
		o.placeholder = '10.0.0.1';
		o.rmempty = true;
		o.depends({ enabled: '1', proto: 'static' });

		o = s.option(form.DummyValue, '_network_device', _('Voice interface'),
			_('The device use for voice service.'));
		o.cfgvalue = derivedVoiceDevice;
		o.depends('enabled', '1');

		/* ---------------------------------------------------------------- *
		 * Voice profile                                                    *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'config', 'voice', _('Voice profile'),
			_('Signalling protocol, DTMF transfer, tone timers and registration account of the FXS port.'));
		s.anonymous = true;
		s.addremove = false;

		protocolOption = o = s.option(form.ListValue, 'protocol', _('Voice protocol'),
			_('The signalling protocol spoken with the softswitch.'));
		o.default = 'h248';
		o.value('h248', _('H.248'));
		o.value('sip', _('Softswitch SIP'));
		o.value('ims_sip', _('IMS SIP'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'dtmf_method', _('DTMF transfer mode'));
		o.default = 'InBand';
		o.value('InBand', _('Transparent (in-band)'));
		o.value('RFC2833', _('RFC 2833'));
		o.rmempty = false;

		o = s.option(form.Value, 'dtmf_payload', _('Payload type value'),
			_('RTP payload type announced for RFC 2833 telephony events.'));
		o.datatype = 'range(96,127)';
		o.placeholder = '97';
		o.rmempty = false;
		o.depends('dtmf_method', 'RFC2833');

		o = s.option(form.ListValue, 'clip_mode', _('Calling line identification'),
			_('How the calling number is presented on the FXS port.'));
		o.default = 'FSK';
		o.value('FSK', _('FSK'));
		o.rmempty = false;

		o = s.option(form.Value, 'flashhook_min', _('Flash hook minimum (ms)'),
			_('Shortest hook flash still recognised as a flash.'));
		o.datatype = 'uinteger';
		o.placeholder = '90';
		o.rmempty = false;

		o = s.option(form.Value, 'flashhook_max', _('Flash hook maximum (ms)'),
			_('Longest hook flash still recognised as a flash.'));
		o.datatype = 'uinteger';
		o.placeholder = '500';
		o.rmempty = false;
		o.validate = validateFlashHookRange;

		o = s.option(form.Value, 'hanging_reminder_tone_timer', _('Hanging reminder tone timer (s)'),
			_('How long the on-hook reminder tone plays before the call is released.'));
		o.datatype = 'range(1,3600)';
		o.placeholder = '40';
		o.rmempty = false;

		o = s.option(form.Value, 'busy_tone_timer', _('Busy tone timer (s)'),
			_('How long the busy tone plays before the call is released.'));
		o.datatype = 'range(1,3600)';
		o.placeholder = '40';
		o.rmempty = false;

		o = s.option(form.Value, 'no_answer_timer', _('No answer timer (s)'),
			_('How long an unanswered call rings before it is released.'));
		o.datatype = 'range(1,3600)';
		o.placeholder = '60';
		o.rmempty = false;

		o = s.option(form.ListValue, 'codec_prefer_rule', _('Codec negotiation rule'),
			_('Which side wins when both ends offer more than one codec.'));
		o.default = 'RemoteFirst';
		o.value('RemoteFirst', _('Remote first'));
		o.value('LocalFirst', _('Local first'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'fax_mode', _('Fax codec'),
			_('Codec used to carry fax calls.'));
		o.default = 'g711';
		o.value('t38', _('T.38'));
		o.value('g711', _('G.711'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'fax_negotiation', _('Fax negotiation mode'),
			_('How the fax call is negotiated when the G.711 codec is used.'));
		o.default = 'all';
		o.value('all', _('T.30 full control'));
		o.value('other', _('T.30 auto negotiation'));
		o.rmempty = false;
		o.depends('fax_mode', 'g711');

		o = s.option(form.Flag, 'time_sync', _('Synchronize the phone clock'),
			_('Send the gateway time to the connected phone.'));
		o.default = '0';
		o.rmempty = false;

		/*
		 * The FXS port itself. There is exactly one, so instead of a line
		 * card listing ports there are three read-only rows naming it and
		 * the per-port options follow directly in this profile.
		 */


		o = forSip(s.option(form.Value, 'auth_username', _('Authentication user name'),
			_('User name the FXS port authenticates with.')));
		o.rmempty = true;

		o = forSip(s.option(form.Value, 'auth_password', _('Authentication password')));
		o.password = true;
		o.rmempty = true;

		o = forSip(s.option(form.Value, 'phone_number', _('Phone number'),
			_('Number presented to the called party.')));
		o.rmempty = true;

		o = s.option(form.Value, 'transmit_gain', _('Transmit gain (dB)'),
			_('Gain applied to the audio sent towards the network.'));
		o.datatype = 'range(-14,6)';
		o.placeholder = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'receive_gain', _('Receive gain (dB)'),
			_('Gain applied to the audio received from the network.'));
		o.datatype = 'range(-14,6)';
		o.placeholder = '0';
		o.rmempty = false;

		o = s.option(form.Flag, 'echo_cancellation', _('Enable echo cancellation'),
			_('Cancel the echo the phone side feeds back into the network.'));
		o.default = '1';
		o.rmempty = false;

		/* ---------------------------------------------------------------- *
		 * H.248                                                            *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'h248', 'h248', _('H.248'),
			_('Media gateway settings reported to the softswitch.'));
		s.anonymous = true;
		s.addremove = false;
		s.tab('basic', _('Basic settings'));
		s.tab('resource', _('Resources'));
		s.tab('advanced', _('Advanced settings'));
	s.tab('heartbeat', _('Heartbeat'));

	/*
	 * Keep at least one ungated element inside the tabbed card. Every other
	 * H.248 option is hidden by its protocol depends, so when the voice
	 * protocol is SIP/IMS the whole card is collapsed with all tab panes
	 * empty; ui.tabs.initTabGroup() then fails to pick a non-empty pane and
	 * throws "Cannot read properties of undefined (reading 'classList')".
	 * An always-present note guarantees a non-empty pane in every protocol
	 * state.
	 */
	s.taboption('basic', form.DummyValue, '_protocol', _('H.248 media gateway'),
		_('Parameters exchanged with the media gateway controller.'));

	o = forH248(s.taboption('basic', form.ListValue, 'message_encoding', _('Message encoding'),
			_('Wire format of the H.248 messages.')));
		o.default = 'ASN.1';
		o.value('ABNF', _('Text (ABNF)'));
		o.value('ASN.1', _('Binary (ASN.1)'));
		o.rmempty = false;

		o = forH248(s.taboption('basic', form.Value, 'primary_server', _('Primary server address'),
			_('Address of the media gateway controller.')));
		o.datatype = 'or(hostname,ipaddr)';
		o.rmempty = true;

		o = forH248(s.taboption('basic', form.Value, 'primary_port', _('Primary server port')));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = forH248(s.taboption('basic', form.Value, 'standby_server', _('Standby server address'),
			_('Address used when the primary media gateway controller cannot be reached.')));
		o.datatype = 'or(hostname,ipaddr)';
		o.rmempty = true;

		o = forH248(s.taboption('basic', form.Value, 'standby_port', _('Standby server port')));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = forH248(s.taboption('basic', form.ListValue, 'registration_mode', _('MG registration mode'),
			_('Identity the media gateway registers with.')));
		o.default = 'domain';
		o.value('ip', _('IP address'));
		o.value('domain', _('MG domain name'));
		o.value('device', _('Device name'));
		o.rmempty = false;

	o = forH248(s.taboption('basic', form.Value, 'domain', _('Domain name'),
		_('Domain name registered by the media gateway.')), { registration_mode: 'domain' });
	o.datatype = 'maxlength(64)';
	o.rmempty = true;
	forH248(o, { registration_mode: 'device' });

		o = forH248(s.taboption('basic', form.Value, 'mg_port', _('MG port'),
			_('Local port the media gateway listens on.')));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = forH248(s.taboption('basic', form.ListValue, 'authentication', _('Authentication method')));
		o.default = 'none';
		o.value('none', _('None'));
		o.value('md5', _('MD5'));
		o.rmempty = false;

		o = forH248(s.taboption('basic', form.Value, 'physical_term_prefix', _('Physical termination prefix'),
			_('Prefix prepended to the physical termination identifier of every port.')));
		o.placeholder = 'A0';
		o.rmempty = true;

		o = forH248(s.taboption('resource', form.Value, 'rtp_prefix', _('RTP ephemeral termination prefix'),
			_('Prefix prepended to the identifier of every ephemeral RTP termination.')));
		o.datatype = 'maxlength(64)';
		o.placeholder = 'RTP/';
		o.rmempty = true;

		o = forH248(s.taboption('resource', form.Value, 'ephemeral_term_start', _('First ephemeral termination')));
		o.datatype = 'range(0,99999)';
		o.placeholder = '0';
		o.rmempty = false;

		o = forH248(s.taboption('resource', form.ListValue, 'ephemeral_term_align', _('Ephemeral termination alignment'),
			_('Whether the number of ephemeral terminations is padded to a fixed width.')));
		o.default = 'aligned';
		o.value('aligned', _('Aligned'));
		o.value('unaligned', _('Unaligned'));
		o.rmempty = false;

		o = forH248(s.taboption('resource', form.Value, 'ephemeral_term_digits', _('Ephemeral termination digit length')));
		o.datatype = 'range(0,10)';
		o.placeholder = '3';
		o.rmempty = false;

		o = forH248(s.taboption('resource', form.Value, 'ephemeral_term_count', _('Number of ephemeral terminations'),
			_('Ephemeral terminations available for RTP streams.')));
		o.datatype = 'range(0,1000)';
		o.placeholder = '2';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Flag, 'ack_enabled', _('Enable ACK messages'),
			_('Acknowledge every H.248 transaction with a dedicated message.')));
		o.default = '0';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'long_timer', _('Transaction long timer (ms)'),
			_('How long a transaction waits for its final response.')));
		o.datatype = 'range(1000,30000)';
		o.placeholder = '30000';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'pending_timer', _('Pending timer (ms)'),
			_('How long a transaction may stay pending before it is retried.')));
		o.datatype = 'range(1000,20000)';
		o.placeholder = '1000';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'retransmit_timer', _('Retransmission timer (ms)'),
			_('Delay before a transaction request is sent again.')));
		o.datatype = 'range(1000,20000)';
		o.placeholder = '1000';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'retransmit_count', _('Transaction retransmission count')));
		o.datatype = 'range(1,10)';
		o.placeholder = '6';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'retransmit_interval', _('Transaction retransmission interval (s)')));
		o.datatype = 'range(1,10)';
		o.placeholder = '4';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'retransmit_duration', _('Transaction retransmission duration (s)'),
			_('How long a transaction is retransmitted before it is given up.')));
		o.datatype = 'range(1,60)';
		o.placeholder = '25';
		o.rmempty = false;

		o = forH248(s.taboption('advanced', form.Value, 'reregister_period', _('Re-registration period (s)')));
		o.datatype = 'range(1,300)';
		o.placeholder = '30';
		o.rmempty = false;

		o = forH248(s.taboption('heartbeat', form.ListValue, 'heartbeat_mode', _('Heartbeat mode'),
			_('How the media gateway detects that the softswitch is still reachable.')));
		o.default = 'active';
		o.value('off', _('Off'));
		o.value('active', _('Active'));
		o.value('passive', _('Passive'));
		o.rmempty = false;

	o = forH248(s.taboption('heartbeat', form.Value, 'heartbeat_period', _('Heartbeat period (s)')), { heartbeat_mode: 'active' });
	o.datatype = 'range(0,600)';
	o.placeholder = '60';
	o.rmempty = false;
	forH248(o, { heartbeat_mode: 'passive' });

	o = forH248(s.taboption('heartbeat', form.Value, 'heartbeat_count', _('Heartbeat count'),
		_('Consecutive missed heartbeats before the registration is refreshed.')), { heartbeat_mode: 'active' });
	o.datatype = 'range(1,10)';
	o.placeholder = '3';
	o.rmempty = false;
	forH248(o, { heartbeat_mode: 'passive' });

		/* ---------------------------------------------------------------- *
		 * SIP                                                              *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'sip', 'sip', _('SIP'),
			_('Session Initiation Protocol settings used with the softswitch and IMS SIP voice protocols.'));
		s.anonymous = true;
		s.addremove = false;
		s.tab('server', _('Servers'));
		s.tab('standby', _('Standby servers'));
		s.tab('advanced', _('Advanced settings'));
		s.tab('heartbeat', _('Heartbeat'));

	/*
	 * Same rationale as the H.248 card above: every SIP option is gated on the
	 * SIP protocols, so when the voice protocol is H.248 the card collapses
	 * with empty tab panes and ui.tabs.initTabGroup() would throw. The note
	 * keeps a pane non-empty in every protocol state.
	 */
	s.taboption('server', form.DummyValue, '_protocol', _('SIP voice protocol'),
		_('Softswitch and IMS SIP signalling parameters.'));

		serverOption(s, 'server', 'proxy_server', _('Proxy server'),
			_('Address of the SIP proxy, an IP address or a domain name.'));
		portOption(s, 'server', 'proxy_port', _('Proxy server port'));
		transportOption(s, 'server', 'proxy_transport', _('Proxy server transport'));

		serverOption(s, 'server', 'register_server', _('Registrar server'),
			_('Address of the SIP registrar, an IP address or a domain name.'));
		portOption(s, 'server', 'register_port', _('Registrar server port'));
		transportOption(s, 'server', 'register_transport', _('Registrar server transport'));

		serverOption(s, 'server', 'outbound_server', _('Outbound proxy server'),
			_('Address of the outbound proxy. Leave empty to send requests straight to the proxy server.'));
		portOption(s, 'server', 'outbound_port', _('Outbound proxy port'));

		serverOption(s, 'server', 'home_domain', _('Home gateway domain'),
			_('Domain the gateway registers with, an IP address or a domain name.'));
		portOption(s, 'server', 'home_domain_port', _('Home gateway domain port'));
		transportOption(s, 'server', 'home_domain_transport', _('Home gateway domain transport'));

		serverOption(s, 'standby', 'standby_proxy_server', _('Standby proxy server'),
			_('Address used when the SIP proxy cannot be reached.'));
		portOption(s, 'standby', 'standby_proxy_port', _('Standby proxy server port'));
		transportOption(s, 'standby', 'standby_proxy_transport', _('Standby proxy server transport'));

		serverOption(s, 'standby', 'standby_register_server', _('Standby registrar server'),
			_('Address used when the SIP registrar cannot be reached.'));
		portOption(s, 'standby', 'standby_register_port', _('Standby registrar server port'));
		transportOption(s, 'standby', 'standby_register_transport', _('Standby registrar server transport'));

		serverOption(s, 'standby', 'standby_outbound_server', _('Standby outbound proxy server'),
			_('Address of the outbound proxy used when the primary one cannot be reached.'));
		portOption(s, 'standby', 'standby_outbound_port', _('Standby outbound proxy port'));

		o = forSip(s.taboption('advanced', form.Value, 'signalling_dscp', _('Signalling DSCP'),
			_('DSCP mark of the SIP signalling packets.')));
		o.datatype = 'range(0,63)';
		o.placeholder = '0';
		o.rmempty = false;

		o = forSip(s.taboption('advanced', form.Value, 'media_dscp', _('Media DSCP'),
			_('DSCP mark of the voice packets.')));
		o.datatype = 'range(0,63)';
		o.placeholder = '0';
		o.rmempty = false;

		o = forSip(s.taboption('advanced', form.Value, 'register_period', _('Registration period (s)'),
			_('How often the gateway registers again.')));
		o.datatype = 'uinteger';
		o.placeholder = '3600';
		o.rmempty = false;

		o = forSip(s.taboption('advanced', form.Value, 'register_retry_period', _('Registration retry period (s)'),
			_('How soon a failed registration is retried.')));
		o.datatype = 'uinteger';
		o.placeholder = '60';
		o.rmempty = false;

		o = forSip(s.taboption('advanced', form.Value, 'session_update_period', _('Session update period (min)'),
			_('How often an established call refreshes its session.')));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.rmempty = false;

		o = forSip(s.taboption('advanced', form.Value, 'min_session_update_period', _('Minimum session update period (min)'),
			_('Shortest session refresh interval accepted from the server.')));
		o.datatype = 'uinteger';
		o.placeholder = '1';
		o.rmempty = false;

		o = forSip(s.taboption('heartbeat', form.Flag, 'heartbeat_enabled', _('Enable heartbeat'),
			_('Detect whether the server is still reachable while no call is up.')));
		o.default = '0';
		o.rmempty = false;

	o = forSip(s.taboption('heartbeat', form.Value, 'heartbeat_period', _('Heartbeat period (s)')), { heartbeat_enabled: '1' });
	o.datatype = 'uinteger';
	o.placeholder = '60';
	o.rmempty = false;

	o = forSip(s.taboption('heartbeat', form.Value, 'heartbeat_timeout_count', _('Heartbeat timeout count'),
		_('Heartbeat timeouts before the registration is refreshed.')), { heartbeat_enabled: '1' });
	o.datatype = 'uinteger';
	o.placeholder = '3';
	o.rmempty = false;

	o = forSip(s.taboption('heartbeat', form.ListValue, 'heartbeat_mode', _('Heartbeat mode')), { heartbeat_enabled: '1' });
	o.default = 'active';
	o.value('active', _('Active'));
	o.value('passive', _('Passive'));
	o.rmempty = false;

		/* ---------------------------------------------------------------- *
		 * Digit map                                                        *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'digitmap', 'digitmap', _('Digit map'),
			_('Number patterns that end dialling and the timers guarding them.'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable dial plan'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'match_mode', _('Matching mode'),
			_('Whether dialling ends at the shortest or the longest matching pattern.'));
		o.default = 'min';
		o.value('max', _('Longest match'));
		o.value('min', _('Shortest match'));
		o.rmempty = false;

		o = s.option(form.Value, 'offhook_timer', _('Off-hook without dialling timer (s)'),
			_('How long the port waits after going off-hook before it plays the congestion tone.'));
		o.datatype = 'range(10,20)';
		o.placeholder = '15';
		o.rmempty = false;

		o = s.option(form.Value, 'short_timer', _('Inter-digit short timer (s)'),
			_('Used while the dialled digits can still start more than one pattern.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '5';
		o.rmempty = false;

		o = s.option(form.Value, 'long_timer', _('Inter-digit long timer (s)'),
			_('Used once the dialled digits can only complete a long number.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '16';
		o.rmempty = false;

		o = s.option(form.TextValue, 'digit_map', _('Dial plan patterns'),
			_('Dialled number patterns separated by a vertical bar. Leave empty to let the softswitch decide.'));
		o.rows = 4;
		o.monospace = true;
		o.rmempty = true;
		o.placeholder = '01[34578]xxxxxxxxx|1[34578]xxxxxxxxx|10086|11[0249]|x.T';

		/* ---------------------------------------------------------------- *
		 * Codecs                                                           *
		 * ---------------------------------------------------------------- */

		/*
		 * One FXS port means one codec list: a table of codecs is enough,
		 * there is no port column to pick from any more.
		 */
		s = m.section(form.TableSection, 'codec', _('Codecs'),
			_('Codecs offered by the FXS port, ordered by priority.'));
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.ListValue, 'codec', _('Codec'));
		o.value('G.711ALaw', 'G.711 A-law');
		o.value('G.711MuLaw', 'G.711 u-law');
		o.value('G.722', 'G.722');
		o.value('G.729', 'G.729');
		o.rmempty = false;

		o = s.option(form.ListValue, 'packetization', _('Packetization period (ms)'),
			_('Audio milliseconds carried by a single RTP packet.'));
		o.default = '20';
		o.value('10', '10');
		o.value('20', '20');
		o.value('30', '30');
		o.rmempty = false;

		o = s.option(form.Value, 'priority', _('Priority'),
			_('Lower values are offered first.'));
		o.datatype = 'uinteger';
		o.placeholder = '1';
		o.rmempty = false;

		return m.render().then(function(node) {
			toggleProtocolSections(node, protocolOption);

			return node;
		});
	}
});
