// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require uci';
'require view';

var STYLESHEET = 'view/pon/pon.css';

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

return view.extend({
	load: function() {
		return uci.load('voice');
	},

	render: function() {
		var m, s, o, ports;

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

		o = s.option(form.ListValue, 'protocol', _('Voice protocol'),
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

		/* ---------------------------------------------------------------- *
		 * H.248                                                            *
		 * ---------------------------------------------------------------- */

		s = m.section(form.NamedSection, 'h248', 'h248', _('H.248'),
			_('Media gateway settings reported to the softswitch. Only used with the H.248 voice protocol.'));
		s.anonymous = true;
		s.addremove = false;
		s.tab('basic', _('Basic settings'));
		s.tab('resource', _('Resources'));
		s.tab('advanced', _('Advanced settings'));
		s.tab('heartbeat', _('Heartbeat'));

		o = s.taboption('basic', form.ListValue, 'message_encoding', _('Message encoding'),
			_('Wire format of the H.248 messages.'));
		o.default = 'ASN.1';
		o.value('ABNF', _('Text (ABNF)'));
		o.value('ASN.1', _('Binary (ASN.1)'));
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'primary_server', _('Primary server address'),
			_('Address of the media gateway controller.'));
		o.datatype = 'or(hostname,ipaddr)';
		o.rmempty = true;

		o = s.taboption('basic', form.Value, 'primary_port', _('Primary server port'));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'standby_server', _('Standby server address'),
			_('Address used when the primary media gateway controller cannot be reached.'));
		o.datatype = 'or(hostname,ipaddr)';
		o.rmempty = true;

		o = s.taboption('basic', form.Value, 'standby_port', _('Standby server port'));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'registration_mode', _('MG registration mode'),
			_('Identity the media gateway registers with.'));
		o.default = 'domain';
		o.value('ip', _('IP address'));
		o.value('domain', _('MG domain name'));
		o.value('device', _('Device name'));
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'domain', _('Domain name'),
			_('Domain name registered by the media gateway.'));
		o.datatype = 'maxlength(64)';
		o.rmempty = true;
		o.depends('registration_mode', 'domain');

		o = s.taboption('basic', form.Value, 'mg_port', _('MG port'),
			_('Local port the media gateway listens on.'));
		o.datatype = 'range(1,65534)';
		o.placeholder = '2944';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'authentication', _('Authentication method'));
		o.default = 'none';
		o.value('none', _('None'));
		o.value('md5', _('MD5'));
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'physical_term_prefix', _('Physical termination prefix'),
			_('Prefix prepended to the physical termination identifier of every port.'));
		o.placeholder = 'A0';
		o.rmempty = true;

		o = s.taboption('resource', form.Value, 'rtp_prefix', _('RTP ephemeral termination prefix'),
			_('Prefix prepended to the identifier of every ephemeral RTP termination.'));
		o.datatype = 'maxlength(64)';
		o.placeholder = 'RTP/';
		o.rmempty = true;

		o = s.taboption('resource', form.Value, 'ephemeral_term_start', _('First ephemeral termination'));
		o.datatype = 'range(0,99999)';
		o.placeholder = '0';
		o.rmempty = false;

		o = s.taboption('resource', form.ListValue, 'ephemeral_term_align', _('Ephemeral termination alignment'),
			_('Whether the number of ephemeral terminations is padded to a fixed width.'));
		o.default = 'aligned';
		o.value('aligned', _('Aligned'));
		o.value('unaligned', _('Unaligned'));
		o.rmempty = false;

		o = s.taboption('resource', form.Value, 'ephemeral_term_digits', _('Ephemeral termination digit length'));
		o.datatype = 'range(0,10)';
		o.placeholder = '3';
		o.rmempty = false;

		o = s.taboption('resource', form.Value, 'ephemeral_term_count', _('Number of ephemeral terminations'),
			_('Ephemeral terminations available for RTP streams.'));
		o.datatype = 'range(0,1000)';
		o.placeholder = '2';
		o.rmempty = false;

		o = s.taboption('advanced', form.Flag, 'ack_enabled', _('Enable ACK messages'),
			_('Acknowledge every H.248 transaction with a dedicated message.'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'long_timer', _('Transaction long timer (ms)'),
			_('How long a transaction waits for its final response.'));
		o.datatype = 'range(1000,30000)';
		o.placeholder = '30000';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'pending_timer', _('Pending timer (ms)'),
			_('How long a transaction may stay pending before it is retried.'));
		o.datatype = 'range(1000,20000)';
		o.placeholder = '1000';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'retransmit_timer', _('Retransmission timer (ms)'),
			_('Delay before a transaction request is sent again.'));
		o.datatype = 'range(1000,20000)';
		o.placeholder = '1000';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'retransmit_count', _('Transaction retransmission count'));
		o.datatype = 'range(1,10)';
		o.placeholder = '6';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'retransmit_interval', _('Transaction retransmission interval (s)'));
		o.datatype = 'range(1,10)';
		o.placeholder = '4';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'retransmit_duration', _('Transaction retransmission duration (s)'),
			_('How long a transaction is retransmitted before it is given up.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '25';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'reregister_period', _('Re-registration period (s)'));
		o.datatype = 'range(1,300)';
		o.placeholder = '30';
		o.rmempty = false;

		o = s.taboption('heartbeat', form.ListValue, 'heartbeat_mode', _('Heartbeat mode'),
			_('How the media gateway detects that the softswitch is still reachable.'));
		o.default = 'active';
		o.value('off', _('Off'));
		o.value('active', _('Active'));
		o.value('passive', _('Passive'));
		o.rmempty = false;

		o = s.taboption('heartbeat', form.Value, 'heartbeat_period', _('Heartbeat period (s)'));
		o.datatype = 'range(0,600)';
		o.placeholder = '60';
		o.rmempty = false;
		o.depends('heartbeat_mode', 'active');
		o.depends('heartbeat_mode', 'passive');

		o = s.taboption('heartbeat', form.Value, 'heartbeat_count', _('Heartbeat count'),
			_('Consecutive missed heartbeats before the registration is refreshed.'));
		o.datatype = 'range(1,10)';
		o.placeholder = '3';
		o.rmempty = false;
		o.depends('heartbeat_mode', 'active');
		o.depends('heartbeat_mode', 'passive');

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
			_('Gain, echo cancellation and the physical termination identifier of every FXS port.'));
		s.anonymous = false;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'physical_term_id', _('Line termination ID'),
			_('Termination reported to the softswitch for this port.'));
		o.placeholder = 'A0';
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

		return m.render();
	}
});
