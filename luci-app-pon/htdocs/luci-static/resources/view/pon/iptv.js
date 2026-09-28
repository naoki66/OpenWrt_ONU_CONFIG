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

function validateCidr(sectionId, value) {
	if (value == null || value === '')
		return true;

	if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}\/[0-9]{1,2}$/.test(value))
		return _('Use an IPv4 address with a prefix length, for example 10.190.0.2/24.');

	return true;
}

function listPonDevices() {
	return uci.sections('pon', 'xpon').map(function(line) {
		return line.device || line['.name'];
	}).join(', ') || '-';
}

/*
 * The device the multicast-to-unicast relay listens on: the bridge that carries
 * the multicast VLAN, never one of its member ports.
 */
function unicastUpstream() {
	var mode = uci.get('iptv', 'config', 'mode');
	var service = uci.get('iptv', 'config', 'service_vlan');
	var multicast = uci.get('iptv', 'config', 'multicast_vlan');
	var vid = multicast || service;

	if (mode === 'trunk')
		return vid ? 'br-iptv-' + vid : '';

	return 'br-iptv';
}

function rtp2httpdLink() {
	return '<a class="cbi-button cbi-button-action" href="' +
		L.url('admin/services/rtp2httpd') + '">' +
		_('Open rtp2httpd settings') + '</a>';
}

return view.extend({
	load: function() {
		return Promise.all([ network.getDevices(), uci.load('pon') ])
			.then(function(results) {
				return results[0];
			});
	},

	render: function(devices) {
		var m, s, o, currentPort, lanPorts, trunkPorts;

		ensureStylesheet();

		m = new form.Map('iptv', _('IPTV'),
			_('Carry the operator IPTV VLANs to a set-top box, to a downstream router or to a multicast-to-unicast relay.'));
		m.readonly = !L.hasViewPermission();

		/*
		 * One card, five tabs: the bridge carries the base topology, the two
		 * protocol families and the multicast VLAN mirror the operator ONT UI,
		 * and the relay tab drives rtp2httpd.
		 */
		s = m.section(form.NamedSection, 'config', 'iptv', _('IPTV'),
			_('The IPTV VLANs are carried by the PON uplink and handed over to the selected port.'));
		s.anonymous = true;
		s.addremove = false;

		s.tab('bridge', _('IPTV bridge'),
			_('Where the operator VLANs are handed over.'));
		s.tab('ipv4', _('IPv4'),
			_('How IGMP and the IPv4 multicast traffic of the IPTV service are handled.'));
		s.tab('ipv6', _('IPv6'),
			_('How MLD and the IPv6 multicast traffic of the IPTV service are handled.'));
		s.tab('mcast', _('Multicast VLAN'),
			_('Which operator VLAN carries multicast downstream and which connection carries the membership reports upstream.'));
		s.tab('unicast', _('Multicast to unicast'),
			_('Optional. Relay the multicast streams as HTTP unicast with rtp2httpd so any device on the network can play them.'));

		/* Where the VLANs are handed over */
		o = s.taboption('bridge', form.DummyValue, '_pon', _('PON interfaces'));
		o.cfgvalue = listPonDevices;

		o = s.taboption('bridge', form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('In set-top box mode the selected LAN port stays out of br-lan for as long as the bridge is enabled.');

		o = s.taboption('bridge', form.ListValue, 'mode', _('Hand-over mode'));
		o.default = 'bridge';
		o.rmempty = false;
		o.value('bridge', _('Set-top box on a dedicated port'));
		o.value('trunk', _('Single cable: VLANs tagged to one port'));
		o.description = _('Set-top box mode bridges the VLANs to one port. Single cable mode keeps the port in br-lan and hands every VLAN over tagged, so a downstream router can carry internet and IPTV on one cable.');
		o.depends('enabled', '1');

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
		o.depends({ enabled: '1', mode: 'bridge' });

		trunkPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^(lan|wan|eth)[0-9]+$/.test(name);
		}).sort();

		o = s.taboption('bridge', form.ListValue, 'trunk_port', _('Trunk port'),
			_('The port stays a member of br-lan; the VLANs below leave it tagged.'));
		o.rmempty = false;
		trunkPorts.forEach(function(name) {
			o.value(name);
		});
		o.depends({ enabled: '1', mode: 'trunk' });

		o = s.taboption('bridge', form.DynamicList, 'trunk_vlans', _('VLANs to hand over'),
			_('One 8021q subinterface pair and one bridge per VLAN. Leave empty to use the service VLAN plus the multicast and IGMP VLANs configured below.'));
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends({ enabled: '1', mode: 'trunk' });

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
			_('The ONU joins the groups on behalf of the set-top box instead of bridging the reports. Set-top box mode only: a proxy has to terminate the VLAN, which single cable mode does not do.'));
		o.default = '0';
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'bridge' });

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
		o.depends({ enabled: '1', mode: 'bridge' });

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
		o.depends({ enabled: '1', mode: 'bridge' });

		/* Multicast to unicast */
		o = s.taboption('unicast', form.Flag, 'unicast', _('Relay multicast as HTTP unicast'),
			_('rtp2httpd joins the groups on the ONU and serves the streams over HTTP, so phones and players can watch without IGMP.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.taboption('unicast', form.Value, 'unicast_port', _('HTTP port'),
			_('Listening port of the relay, also set on the rtp2httpd page.'));
		o.default = '5140';
		o.datatype = 'port';
		o.rmempty = false;
		o.depends({ enabled: '1', unicast: '1' });

		o = s.taboption('unicast', form.Value, 'unicast_addr', _('Relay address'),
			_('Optional. An address in the operator IPTV network, needed for the ONU to join the groups itself. Leave empty to keep the bridge unaddressed.'));
		o.placeholder = '10.190.0.2/24';
		o.rmempty = true;
		o.validate = validateCidr;
		o.depends({ enabled: '1', unicast: '1' });

		o = s.taboption('unicast', form.DummyValue, '_upstream', _('Upstream device'),
			_('The bridge carrying the multicast VLAN. The relay listens on the bridge, never on one of its member ports.'));
		o.cfgvalue = unicastUpstream;

		o = s.taboption('unicast', form.DummyValue, '_rtp2httpd', _('Playlist and FCC settings'),
			_('Channels, fast channel change and worker tuning stay on the rtp2httpd page.'));
		o.rawhtml = true;
		o.cfgvalue = rtp2httpdLink;

		return m.render();
	}
});
