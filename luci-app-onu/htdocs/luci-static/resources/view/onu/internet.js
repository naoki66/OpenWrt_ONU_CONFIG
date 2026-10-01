// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require network';
'require uci';
'require view';

var STYLESHEET = 'view/onu/onu.css';

/*
 * The names internet-apply derives from this page. Keeping them here mirrors
 * what the apply script writes: the same principle as the upstream device on
 * the IPTV page, which has to follow iptv-apply branch by branch.
 */
var VLAN_DEVICE = 'ct-wanup';
var BRIDGE_DEVICE = 'br-wanup';

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

function listPonDevices() {
	return uci.sections('pon', 'xpon').map(function(line) {
		return line.device || line['.name'];
	}).join(', ') || '-';
}

/*
 * The port the IPTV page took for its set-top box bridge. Section ownership has
 * to be exclusive: applying both pages onto one port silently breaks whichever
 * loses, so it is refused here and again in internet-apply.
 */
function iptvPort() {
	if (uci.get('onu-iptv', 'config', 'enabled') !== '1')
		return '';

	if (uci.get('onu-iptv', 'config', 'mode') !== 'bridge')
		return '';

	return uci.get('onu-iptv', 'config', 'lan_port') || '';
}

function selectedPorts(sectionId) {
	return L.toArray(uci.get('onu-internet', 'config', 'ports'));
}

function validatePorts(sectionId, value) {
	var ports = L.toArray(value);
	var taken = iptvPort();
	var i;

	if (!ports.length)
		return _('Pick at least one LAN port for the internet bridge.');

	for (i = 0; i < ports.length; i++)
		if (ports[i] === taken)
			return _('This port carries the IPTV set-top box bridge; free it on the IPTV page first.');

	return true;
}

/*
 * Mirror of want_ipv6() in internet-apply. It has to agree with the script,
 * otherwise this page and the config it writes drift apart.
 */
function wantsIPv6() {
	switch (uci.get('onu-internet', 'config', 'ip_version')) {
	case 'ipv6':
	case 'ipv4_ipv6':
	case 'dual':
		return true;
	}

	return false;
}

/*
 * What the apply script builds from the current settings. Layer two devices are
 * not invented by the user, they are derived - showing them keeps this page and
 * internet-apply readable against each other.
 */
function derivedDevices() {
	var uplink = uci.get('onu-internet', 'config', 'uplink') || 'pon0';
	var vlan = uci.get('onu-internet', 'config', 'vlan');

	if (uci.get('onu-internet', 'config', 'enabled') !== '1')
		return '-';

	switch (uci.get('onu-internet', 'config', 'mode')) {
	case 'pppoe':
		return '%s.%s (%s) -> pppoe-wan'.format(uplink, vlan || '?', VLAN_DEVICE);

	case 'dhcp':
		/* Only the dual-stack case gets a second interface: that is the one
		 * place a real DHCPv6 client is written. */
		return '%s.%s (%s) -> wan%s'.format(uplink, vlan || '?', VLAN_DEVICE,
			wantsIPv6() ? ' + wan6' : '');

	default:
		return '%s.%s (%s) + LAN ports -> %s'.format(uplink, vlan || '?', VLAN_DEVICE, BRIDGE_DEVICE);
	}
}

return view.extend({
	load: function() {
		return Promise.all([
			network.getDevices(),
			uci.load('onu-internet'),
			uci.load('onu-iptv')
		]).then(function(results) {
			return results[0];
		});
	},

	render: function(devices) {
		var m, s, o, lanPorts, current;

		ensureStylesheet();

		/*
		 * One card. The map title is the page heading, so the section must not
		 * repeat it, and there is no tab here: the mode switch already hides
		 * half of the fields, and a second grouping on top of it would only
		 * hide where the fields actually live.
		 */
		m = new form.Map('onu-internet', _('Internet'),
			_('The internet service carried by the PON uplink: either handed over as a bridge so a downstream router dials, or dialled by the ONT itself.'));
		m.readonly = !L.hasViewPermission();

		s = m.section(form.NamedSection, 'config', 'internet');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('With the service off, no VLAN subinterface and no dialling interface is written, and the stock WAN interfaces of the network page are put back.');

		o = s.option(form.ListValue, 'mode', _('Internet mode'),
			_('Bridged hands the operator VLAN to your own router. DHCP takes whatever address the operator hands out. PPPoE lets the ONT terminate the session and route for the LAN.'));
		o.default = 'bridge';
		o.rmempty = false;
		o.value('bridge', _('Bridged'));
		o.value('dhcp', _('DHCP'));
		o.value('pppoe', _('PPPoE'));
		o.depends('enabled', '1');

		o = s.option(form.Value, 'vlan', _('Internet VLAN'),
			_('The operator VLAN carrying the internet service. It becomes an 8021q subinterface of the uplink, never a member of br-lan.'));
		o.placeholder = '1-4094';
		o.datatype = 'range(1,4094)';
		o.rmempty = false;
		o.depends('enabled', '1');

		lanPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^lan[0-9]+$/.test(name);
		}).sort();

		current = selectedPorts();

		/*
		 * form.MultiValue hands its choices to ui.Dropdown, whose render()
		 * runs Object.keys() on them. Registering no choice at all is fatal:
		 * form.js transformChoices() returns null when nothing was added,
		 * and the dropdown's own guard - typeof(choices) != 'object' - does
		 * not stop null, because typeof null is 'object'. Without devices
		 * named lan[0-9]+, which is every booting board before netifd has
		 * them and every stripped rootfs, the whole page would go down with
		 * "TypeError: Cannot convert undefined or null to object".
		 *
		 * The IPTV page gets away with it because form.ListValue renders
		 * through ui.Select, which normalises null to {}. Nothing can be
		 * picked here in that state either, so say so instead of rendering
		 * an empty picker.
		 */
		if (lanPorts.length || current.length) {
			o = s.option(form.MultiValue, 'ports', _('LAN ports'),
				_('The selected ports leave br-lan and join the internet bridge, so the ONT stays manageable over the ports left behind.'));
			lanPorts.forEach(function(name) {
				o.value(name);
			});
			current.forEach(function(name) {
				if (lanPorts.indexOf(name) < 0)
					o.value(name);
			});
			o.rmempty = false;
			o.display_size = lanPorts.length || 3;
			o.validate = validatePorts;
			o.depends({ enabled: '1', mode: 'bridge' });
		}
		else {
			o = s.option(form.DummyValue, '_ports', _('LAN ports'),
				_('The selected ports leave br-lan and join the internet bridge, so the ONT stays manageable over the ports left behind.'));
			o.cfgvalue = function() {
				return _('No LAN port devices are available to bridge.');
			};
			o.depends({ enabled: '1', mode: 'bridge' });
		}

		o = s.option(form.Flag, 'ipoe', _('Also carry native IPv4/IPv6'),
			_('Turn this on when the operator serves IPoE instead of PPPoE, otherwise only the PPPoE EtherTypes 0x8863 and 0x8864 are let through towards the uplink.'));
		o.default = '0';
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'bridge' });

		/*
		 * One picker for both dialled modes, because both really do offer the
		 * same two things. Where they differ is only where IPv6 comes from:
		 *
		 *   PPPoE: the session negotiates it. netifd raises its own virtual
		 *          wan_6 on the ppp interface and runs DHCPv6 there. Writing a
		 *          network.wan6 of our own used to put a *second* DHCPv6 client
		 *          on the same session, which is why internet-apply no longer
		 *          does it. Switching back to IPv4 only drops whatever wan6 is
		 *          left over - no help from this page is needed for that.
		 *
		 *   DHCP : there is no session to derive anything from, so the page
		 *          keeps the DHCPv6 client as a real wan6 interface.
		 *
		 * Two depends() calls are an OR, not an AND: one object means "all of
		 * these keys match", two calls mean "either of them".
		 */
		o = s.option(form.ListValue, 'ip_version', _('IP protocol version'),
			_('Dual stack over PPPoE takes IPv6 from the session itself; over DHCP it adds a DHCPv6 client asking for a prefix.'));
		o.default = 'ipv4';
		o.rmempty = false;
		o.value('ipv4', _('IPv4 only'));
		o.value('ipv4_ipv6', _('IPv4/IPv6 dual stack'));

		/*
		 * IPv6 only is no longer offered, but a configuration written by an
		 * older build may still carry it. Keep its entry so the picker never
		 * renders a value it does not know, which would silently fall back to
		 * the first choice and turn the running stack off on the next save.
		 */
		if (uci.get('onu-internet', 'config', 'ip_version') === 'ipv6')
			o.value('ipv6', _('IPv6 only (no longer offered)'));

		o.depends({ enabled: '1', mode: 'pppoe' });
		o.depends({ enabled: '1', mode: 'dhcp' });

		o = s.option(form.Value, 'username', _('PPPoE user name'),
			_('User name assigned by the operator.'));
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'pppoe' });

		o = s.option(form.Value, 'password', _('PPPoE password'));
		o.password = true;
		o.rmempty = true;
		o.depends({ enabled: '1', mode: 'pppoe' });

		o = s.option(form.Value, 'mtu', _('MTU'),
			_('MTU of the PPPoE interface, one PPPoE header below the Ethernet MTU.'));
		o.default = '1492';
		o.datatype = 'range(576,1500)';
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'pppoe' });

		o = s.option(form.DummyValue, '_devices', _('Derived devices'),
			_('What internet-apply builds. Both are 15 characters or shorter, which is what netifd and the kernel accept.'));
		o.cfgvalue = derivedDevices;
		o.depends('enabled', '1');

		/*
		 * Hardware offload used to be a switch on this page. It moved to its
		 * own page, so there is nothing here any more: internet-apply still
		 * honours onu-internet.config.offload, which is what lets an existing
		 * configuration keep running unchanged until that page lands.
		 */

		return m.render();
	}
});
