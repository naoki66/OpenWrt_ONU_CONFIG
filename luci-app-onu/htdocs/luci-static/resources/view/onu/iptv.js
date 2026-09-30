// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require network';
'require uci';
'require view';

var STYLESHEET = 'view/onu/onu.css';

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
 * resolve_trunk_vlans(): the VLANs single cable mode hands over, each of which
 * becomes a br-iptv-<vid> of its own. An explicit trunk_vlans list wins,
 * otherwise the VLANs of the bridge tab are used. The unicast relay only has a
 * bridge to listen on inside this list, so it is the candidate list for the
 * relay VLAN as well.
 */
function trunkVlanList() {
	var explicit = uci.get('iptv', 'config', 'trunk_vlans');
	var service = uci.get('iptv', 'config', 'service_vlan');
	var multicast = uci.get('iptv', 'config', 'multicast_vlan');
	var igmp = uci.get('iptv', 'config', 'igmp_vlan');
	var list = [];

	function add(vid) {
		if (vid && list.indexOf(vid) < 0)
			list.push(vid);
	}

	if (Array.isArray(explicit) ? explicit.length : (explicit != null && explicit !== '')) {
		if (Array.isArray(explicit))
			explicit.forEach(add);
		else
			add(explicit);

		return list;
	}

	add(service);
	add(multicast);

	if (igmp && igmp !== service && igmp !== multicast)
		add(igmp);

	return list;
}

/*
 * The device the multicast-to-unicast relay listens on. This mirrors
 * resolve_unicast() in iptv-apply and must stay in step with it: the relay has
 * to listen on a bridge, never on one of its member ports, because frames
 * reaching a bridge port are handled by the bridge itself and never reach the
 * local stack on that port.
 *
 * Single cable mode builds one br-iptv-<vid> per handed-over VLAN, so the relay
 * follows the VLAN picked below, or the multicast VLAN when none is picked.
 * Outside single cable mode there is only one bridge, so it is br-iptv itself —
 * or the proxy uplink when the multicast proxy terminates the multicast VLAN,
 * which takes that VLAN out of br-iptv.
 */
function unicastUpstream() {
	var mode = uci.get('iptv', 'config', 'mode');
	var service = uci.get('iptv', 'config', 'service_vlan');
	var multicast = uci.get('iptv', 'config', 'multicast_vlan');
	var igmp = uci.get('iptv', 'config', 'igmp_vlan');
	var unicastVlan = uci.get('iptv', 'config', 'unicast_vlan');
	var proxy = uci.get('iptv', 'config', 'igmp_proxy') === '1' ||
		uci.get('iptv', 'config', 'mld_proxy') === '1';
	var vid;

	if (mode === 'trunk') {
		vid = unicastVlan || multicast || service;

		return vid ? 'br-iptv-' + vid : '';
	}

	/* resolve_proxy(): only outside single cable mode, and only when a VLAN is
	   left for the proxy to terminate. */
	if (proxy) {
		if (igmp && igmp !== service && igmp !== multicast)
			return 'ct-iptv-igmp';

		if (multicast)
			return 'ct-iptv-mc';
	}

	return 'br-iptv';
}

function relayButton(label, node) {
	return '<a class="cbi-button cbi-button-action" href="' + L.url(node) + '">' + label + '</a>';
}

/*
 * rtp2httpd is the relay this page configures. udpxy and msd_lite are
 * alternative relays: they listen on the same bridges but are not driven by
 * this configuration, so they only get a shortcut here.
 */
function relayButtons() {
	return [
		relayButton('rtp2httpd', 'admin/services/rtp2httpd'),
		relayButton('udpxy', 'admin/services/udpxy'),
		relayButton('msd_lite', 'admin/services/msd_lite')
	].join(' ');
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

		/*
		 * The map title is the page heading and the section carries the tabs,
		 * so the section must not repeat it: two IPTV headings one below the
		 * other read as two different things. One description at the top says
		 * what the page does.
		 */
		m = new form.Map('iptv', _('IPTV'),
			_('The IPTV VLANs are carried by the PON uplink and handed over to a set-top box, to a downstream router or to a multicast-to-unicast relay.'));
		m.readonly = !L.hasViewPermission();

		/*
		 * One card, four tabs: the bridge carries the hand-over topology and
		 * the VLANs, the two protocol families mirror the operator ONT UI, and
		 * the relay tab drives rtp2httpd.
		 *
		 * The multicast VLAN is deliberately not a tab of its own. It is the
		 * counterpart of the service VLAN — leave it empty and the service
		 * VLAN carries multicast too — so splitting it into another tab hides
		 * how the two relate. Upstream keeps it next to the service VLAN in a
		 * flat list, and it stays there here.
		 */
		s = m.section(form.NamedSection, 'config', 'iptv');
		s.anonymous = true;
		s.addremove = false;

		s.tab('bridge', _('IPTV bridge'),
			_('The service VLAN and multicast VLAN of the operator IPTV service.'));
		s.tab('ipv4', _('IPv4'),
			_('How IGMP and the IPv4 multicast traffic of the IPTV service are handled.'));
		s.tab('ipv6', _('IPv6'),
			_('How MLD and the IPv6 multicast traffic of the IPTV service are handled.'));
		s.tab('unicast', _('Multicast to unicast'),
			_('Optional. Relay the multicast streams as HTTP unicast with rtp2httpd so any device on the network can play them.'));

	
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

	

		o = s.taboption('bridge', form.Value, 'service_vlan', _('Service VLAN'),
			_('Carries DHCP, authentication and video on demand and, when no separate multicast VLAN is set, multicast traffic.'));
		o.placeholder = '43';
		o.datatype = 'range(1,4094)';
		o.rmempty = false;
		o.depends('enabled', '1');

		/*
		 * The multicast VLAN belongs next to the service VLAN: leaving it
		 * empty is what makes the service VLAN carry multicast too, and the
		 * validator below rejects setting both to the same value.
		 */
		o = s.taboption('bridge', form.Value, 'multicast_vlan', _('Multicast VLAN'),
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

		o = s.taboption('bridge', form.Value, 'igmp_vlan', _('IGMP upstream VLAN'),
			_('Optional. Leave empty to use the multicast VLAN, or the service VLAN when no separate multicast VLAN is configured.'));
		o.placeholder = _('Same as multicast traffic');
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends({ enabled: '1', mode: 'bridge' });

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

		/* Multicast to unicast */
		o = s.taboption('unicast', form.Flag, 'unicast', _('Relay multicast as HTTP unicast'),
			_('rtp2httpd joins the groups on the ONU and serves the streams over HTTP, so phones and players can watch without IGMP.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');


		o = s.taboption('unicast', form.Value, 'unicast_addr', _('Relay address'),
			_('Optional. An address in the operator IPTV network, needed for the ONU to join the groups itself. Leave empty to keep the bridge unaddressed.'));
		o.placeholder = '10.190.0.2/24';
		o.rmempty = true;
		o.validate = validateCidr;
		o.depends({ enabled: '1', unicast: '1' });

	/*
	 * Single cable mode is the only mode with more than one bridge to pick
	 * from, and only the handed-over VLANs have a bridge at all. Everywhere
	 * else the option would be a trap — it says one thing here and the apply
	 * script writes another — so it stays hidden and the script ignores it.
	 */
	o = s.taboption('unicast', form.Value, 'unicast_vlan', _('Relay VLAN'),
		_('Optional. Single cable mode only: the handed-over VLAN the relay listens on. Empty follows the multicast VLAN, or the service VLAN when none is set.'));
	o.datatype = 'range(1,4094)';
	o.rmempty = true;
	o.placeholder = uci.get('iptv', 'config', 'multicast_vlan') ||
		uci.get('iptv', 'config', 'service_vlan') || '';
	o.depends({ enabled: '1', unicast: '1', mode: 'trunk' });
	o.validate = function(sectionId, value) {
		if (!value)
			return true;

		if (trunkVlanList().indexOf(value) < 0)
			return _('Hand this VLAN over on the trunk first: only the handed-over VLANs get a bridge for the relay to listen on.');

		return true;
	};

	o = s.taboption('unicast', form.DummyValue, '_upstream', _('Upstream device'),
		_('The bridge the relay listens on: the relay VLAN bridge in single cable mode, otherwise the multicast VLAN bridge or the proxy uplink. Never a member port.'));
	o.cfgvalue = unicastUpstream;
	o.depends({ enabled: '1', unicast: '1' });

		o = s.taboption('unicast', form.DummyValue, '_relays', _('Relay settings'),
			_('Channels, fast channel change and worker tuning stay on the rtp2httpd page. udpxy and msd_lite are alternative relays with their own pages; they are not configured here and their shortcuts only work when the matching package is installed.'));
		o.rawhtml = true;
		o.cfgvalue = relayButtons;

		return m.render();
	}
});
