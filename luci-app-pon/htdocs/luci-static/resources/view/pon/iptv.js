// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require network';
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

return view.extend({
	load: function() {
		return Promise.all([ network.getDevices(), uci.load('pon') ])
			.then(function(results) {
				return results[0];
			});
	},

	render: function(devices) {
		var m, s, o, currentPort, lanPorts;

		ensureStylesheet();

		m = new form.Map('iptv', _('IPTV'),
			_('Bind one LAN port to the operator IPTV VLAN. Applying the configuration removes the selected port from br-lan.'));
		m.readonly = !L.hasViewPermission();

		s = m.section(form.NamedSection, 'config', 'iptv', _('IPTV bridge'),
			_('The set-top box is bridged to the operator VLANs carried by the PON uplink.'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_pon', _('PON interfaces'));
		o.cfgvalue = listPonDevices;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('The LAN port stays out of br-lan for as long as the bridge is enabled.');

		currentPort = uci.get('iptv', 'config', 'lan_port');
		lanPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^lan[0-9]+$/.test(name);
		}).sort();

		o = s.option(form.ListValue, 'lan_port', _('IPTV LAN port'),
			_('The selected port is dedicated to the set-top box.'));
		o.rmempty = false;
		lanPorts.forEach(function(name) {
			o.value(name);
		});
		if (currentPort && lanPorts.indexOf(currentPort) < 0)
			o.value(currentPort);
		o.depends('enabled', '1');

		o = s.option(form.Value, 'uplink', _('Uplink device'),
			_('Network device carrying the operator VLANs, normally pon0.'));
		o.default = 'pon0';
		o.rmempty = false;
		o.validate = validateIfname;
		o.depends('enabled', '1');

		o = s.option(form.Value, 'service_vlan', _('Service VLAN'),
			_('Carries DHCP, authentication, video on demand and, when no separate multicast VLAN is set, multicast traffic.'));
		o.placeholder = '43';
		o.datatype = 'range(1,4094)';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.option(form.Value, 'multicast_vlan', _('Multicast VLAN'),
			_('Optional. In separate multicast VLAN mode, IPv4 multicast flows downstream and IGMP is allowed upstream.'));
		o.placeholder = '40';
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends('enabled', '1');
		o.validate = function(sectionId, value) {
			var serviceVlan = this.section.formvalue(sectionId, 'service_vlan');

			if (value && value === serviceVlan)
				return _('Leave the multicast VLAN empty when both services use the same VLAN.');

			return true;
		};

		o = s.option(form.Value, 'igmp_vlan', _('IGMP upstream VLAN'),
			_('Optional. Leave empty to use the multicast VLAN, or the service VLAN when no separate multicast VLAN is configured.'));
		o.placeholder = _('Same as multicast traffic');
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends('enabled', '1');

		return m.render();
	}
});
