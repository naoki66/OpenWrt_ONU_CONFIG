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
			_('Bind one LAN port to the operator IPTV VLAN and choose how multicast is handled. Applying the configuration removes the selected port from br-lan.'));
		m.readonly = !L.hasViewPermission();

		/*
		 * One card, four tabs: the bridge is the base configuration, the two
		 * protocol families and the multicast VLAN mirror the operator ONT UI.
		 */
		s = m.section(form.NamedSection, 'config', 'iptv', _('IPTV'),
			_('The set-top box is bridged to the operator VLANs carried by the PON uplink.'));
		s.anonymous = true;
		s.addremove = false;

		s.tab('bridge', _('IPTV bridge'),
			_('The set-top box is bridged to the operator VLANs carried by the PON uplink.'));
		s.tab('ipv4', _('IPv4'),
			_('How IGMP and the IPv4 multicast traffic of the IPTV service are handled.'));
		s.tab('ipv6', _('IPv6'),
			_('How MLD and the IPv6 multicast traffic of the IPTV service are handled.'));
		s.tab('mcast', _('Multicast VLAN'),
			_('Which operator VLAN carries multicast downstream and which connection carries the membership reports upstream.'));

		/* IPTV bridge */
		o = s.taboption('bridge', form.DummyValue, '_pon', _('PON interfaces'));
		o.cfgvalue = listPonDevices;

		o = s.taboption('bridge', form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('The LAN port stays out of br-lan for as long as the bridge is enabled.');

		currentPort = uci.get('iptv', 'config', 'lan_port');
		lanPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^lan[0-9]+$/.test(name);
		}).sort();

		o = s.taboption('bridge', form.ListValue, 'lan_port', _('IPTV LAN port'),
			_('The selected port is dedicated to the set-top box.'));
		o.rmempty = false;
		lanPorts.forEach(function(name) {
			o.value(name);
		});
		if (currentPort && lanPorts.indexOf(currentPort) < 0)
			o.value(currentPort);
		o.depends('enabled', '1');

		o = s.taboption('bridge', form.Value, 'uplink', _('Uplink device'),
			_('Network device carrying the operator VLANs, normally pon0.'));
		o.default = 'pon0';
		o.rmempty = false;
		o.validate = validateIfname;
		o.depends('enabled', '1');

		o = s.taboption('bridge', form.Value, 'service_vlan', _('Service VLAN'),
			_('Carries DHCP, authentication and video on demand.'));
		o.placeholder = '43';
		o.datatype = 'range(1,4094)';
		o.rmempty = false;
		o.depends('enabled', '1');

		/* IPv4 */
		o = s.taboption('ipv4', form.Flag, 'igmp_snooping', _('Enable IGMP snooping'),
			_('The bridge learns which port joined a group and stops flooding multicast to the remaining ports.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.taboption('ipv4', form.Flag, 'igmp_proxy', _('Enable IGMP proxy'),
			_('The ONU joins the groups on behalf of the set-top box instead of bridging the reports. Needs a separate multicast or IGMP upstream VLAN and the omcproxy package.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.taboption('ipv4', form.Flag, 'multicast_querier', _('Enable multicast querier'),
			_('Recommended together with snooping: the bridge sends its own general queries so group memberships do not time out and interrupt the stream.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		/* IPv6 */
		o = s.taboption('ipv6', form.Flag, 'mld_snooping', _('Enable MLD snooping'),
			_('Same kernel switch as IGMP snooping: the Linux bridge enables IGMP and MLD snooping together, so turning on either one turns on both.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.taboption('ipv6', form.Flag, 'mld_proxy', _('Enable MLD proxy'),
			_('The ONU joins the IPv6 groups on behalf of the set-top box. omcproxy proxies IGMP and MLD as one instance, so either switch starts the proxy and both must be off to stop it.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		/* Multicast VLAN */
		o = s.taboption('mcast', form.Value, 'multicast_vlan', _('Multicast VLAN'),
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

		o = s.taboption('mcast', form.Value, 'igmp_vlan', _('IGMP upstream VLAN'),
			_('Optional. The upstream connection of the operator ONT UI: the VLAN carrying the membership reports towards the OLT. Leave empty to use the multicast VLAN, or the service VLAN when no separate multicast VLAN is configured.'));
		o.placeholder = _('Same as multicast traffic');
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends('enabled', '1');

		return m.render();
	}
});
