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

function validateIfname(sectionId, value) {
	if (!/^[A-Za-z0-9_.:-]{1,15}$/.test(value || ''))
		return _('Use a Linux network device name containing at most 15 characters.');

	return true;
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
	if (uci.get('iptv', 'config', 'enabled') !== '1')
		return '';

	if (uci.get('iptv', 'config', 'mode') !== 'bridge')
		return '';

	return uci.get('iptv', 'config', 'lan_port') || '';
}

function selectedPorts(sectionId) {
	return L.toArray(uci.get('internet', 'config', 'ports'));
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
 * What the apply script builds from the current settings. Layer two devices are
 * not invented by the user, they are derived - showing them keeps this page and
 * internet-apply readable against each other.
 */
function derivedDevices() {
	var uplink = uci.get('internet', 'config', 'uplink') || 'pon0';
	var vlan = uci.get('internet', 'config', 'vlan');

	if (uci.get('internet', 'config', 'enabled') !== '1')
		return '-';

	if (uci.get('internet', 'config', 'mode') === 'pppoe')
		return '%s.%s (%s) -> pppoe-wan'.format(uplink, vlan || '?', VLAN_DEVICE);

	return '%s.%s (%s) + LAN ports -> %s'.format(uplink, vlan || '?', VLAN_DEVICE, BRIDGE_DEVICE);
}

return view.extend({
	load: function() {
		return Promise.all([
			network.getDevices(),
			uci.load('internet'),
			uci.load('iptv')
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
		m = new form.Map('internet', _('Internet'),
			_('The internet service carried by the PON uplink: either handed over as a bridge so a downstream router dials, or dialled by the ONT itself.'));
		m.readonly = !L.hasViewPermission();

		s = m.section(form.NamedSection, 'config', 'internet');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_pon', _('PON interfaces'));
		o.cfgvalue = listPonDevices;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('With the service off, no VLAN subinterface and no dialling interface is written, and the stock WAN interfaces of the network page are put back.');

		o = s.option(form.ListValue, 'mode', _('Internet mode'),
			_('Bridged hands the operator VLAN to your own router. Dialled lets the ONT terminate the PPPoE session and route for the LAN.'));
		o.default = 'bridge';
		o.rmempty = false;
		o.value('bridge', _('Bridged (a downstream router dials)'));
		o.value('pppoe', _('Dialled by the ONT (PPPoE)'));
		o.depends('enabled', '1');

		o = s.option(form.Value, 'uplink', _('Uplink device'),
			_('Network device carrying the operator VLANs, normally pon0.'));
		o.default = 'pon0';
		o.rmempty = false;
		o.validate = validateIfname;
		o.depends('enabled', '1');

		o = s.option(form.Value, 'vlan', _('Internet VLAN'),
			_('The operator VLAN carrying the internet service. It becomes an 8021q subinterface of the uplink, never a member of br-lan.'));
		o.placeholder = '466';
		o.datatype = 'range(1,4094)';
		o.rmempty = false;
		o.depends('enabled', '1');

		lanPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^lan[0-9]+$/.test(name);
		}).sort();

		current = selectedPorts();

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

		o = s.option(form.Flag, 'ipoe', _('Also carry native IPv4/IPv6'),
			_('Turn this on when the operator serves IPoE instead of PPPoE, otherwise only the PPPoE EtherTypes 0x8863 and 0x8864 are let through towards the uplink.'));
		o.default = '0';
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'bridge' });

		o = s.option(form.ListValue, 'ip_version', _('IP protocol version'));
		o.default = 'ipv4';
		o.rmempty = false;
		o.value('ipv4', _('IPv4'));
		o.value('ipv6', _('IPv6'));
		o.value('ipv4_ipv6', _('IPv4/IPv6'));
		o.description = _('Anything but IPv4 also writes wan6 as a DHCPv6 client on the dialled session.');
		o.depends({ enabled: '1', mode: 'pppoe' });

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

		o = s.option(form.Flag, 'offload', _('Hardware offload'),
			_('Turns on netfilter flow offloading and hardware offloading, which is the only path to the Airoha PPE on this platform: airoha_eth takes the flows from nftables and the NPU forwards them. The firewall settings made by hand are restored when the switch is turned off.'));
		o.default = '1';
		o.rmempty = false;

		return m.render();
	}
});
