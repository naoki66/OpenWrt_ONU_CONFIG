// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require uci';
'require view';

var STYLESHEET = 'view/pon/pon.css';

/* Fully qualified name of the protocol list: <config>.<section>.<option>. */
var PROTOCOL_OPTION = 'voice.config.protocol';

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

/* The FXS ports are the sections of type "line"; codecs point back at them. */
function listVoicePorts() {
	return uci.sections('voice', 'line').map(function(line) {
		return line['.name'];
	});
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
 * The dependencies above hide every option of the H.248 and SIP sections, but
 * LuCI still renders the two section containers, so switching the protocol
 * would leave an empty card behind. LuCI puts the "cbi-voice-<name>" id on the
 * inner "cbi-section-node" element; the card to hide is the surrounding
 * "cbi-section" div which also carries the heading.
 */
function sectionCard(node, name) {
	var inner = node.querySelector('#cbi-voice-' + name);

	return inner ? (inner.closest('.cbi-section') || inner) : null;
}

function toggleProtocolSections(node, protocolOption) {
	var h248 = sectionCard(node, 'h248');
	var sip = sectionCard(node, 'sip');
	var frame = node.querySelector('#cbi-voice-config-protocol');

	function update() {
		var value = protocolOption ? protocolOption.formvalue('config') : null;

		if (h248)
			h248.classList[(value === 'h248') ? 'remove' : 'add']('hidden');

		if (sip)
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
		return uci.load('voice');
	},

	render: function() {
		var m, s, o, ports, protocolOption;

		ensureStylesheet();

		m = new form.Map('voice', _('Voice'),
			_('Voice services carried by the PON uplink.'));
		m.readonly = !L.hasViewPermission();

		/* ---------------------------------------------------------------- *
		 * Voice profile                                                    *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'config', 'voice', _('Voice profile'),
			_('Signalling protocol, DTMF transfer and the tone timers shared by every voice port.'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable voice service'));
		o.default = '0';
		o.rmempty = false;

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
		 * Lines and codecs                                                 *
		 * ---------------------------------------------------------------- */

		ports = listVoicePorts();

		s = m.section(form.TypedSection, 'line', _('Line settings'),
			_('Gain, echo cancellation and the identity of every FXS port. The two shipped sections are the two FXS ports of the device; the authentication credentials apply to the SIP voice protocols.'));
		s.anonymous = false;

		/* The number of FXS ports is fixed by the hardware. */
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'physical_term_id', _('Line termination ID'),
			_('Termination reported to the softswitch for this port.'));
		o.placeholder = 'A0';
		o.rmempty = true;

		o = forSip(s.option(form.Value, 'auth_username', _('Authentication user name'),
			_('User name the line authenticates with.')));
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

		o = s.option(form.Flag, 'echo_cancellation', _('Enable echo cancellation'));
		o.default = '1';
		o.rmempty = false;

		s = m.section(form.TableSection, 'codec', _('Codecs'),
			_('Codecs offered on a voice port, ordered by priority.'));
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.ListValue, 'line', _('Voice port'));
		ports.forEach(function(port) {
			o.value(port);
		});
		o.rmempty = false;

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
