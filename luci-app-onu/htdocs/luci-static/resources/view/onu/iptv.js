// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require fs';
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

function listPonDevices() {
	return uci.sections('pon', 'xpon').map(function(line) {
		return line.device || line['.name'];
	}).join(', ') || '-';
}

/*
 * Port ownership across the three PON service pages, mirroring
 * check_internet_port() and check_voice_port() in iptv-apply.
 *
 * A dedicated bridge port (internet bridge, IPTV set-top box port, voice
 * bridge port) leaves br-lan and belongs to exactly one service bridge, so no
 * other page may pick it. A trunk port stays in br-lan and only carries tagged
 * 8021q subinterfaces, so the IPTV trunk and the voice trunk may share one
 * port on purpose - but a dedicated port must never become a trunk port
 * either, or it would carry foreign tagged VLANs while its own service expects
 * it untagged.
 */
function portsOf(value) {
	return L.toArray(value).filter(function(port) {
		return !!port;
	});
}

/* The internet page owns ports in bridge mode only, and they are dedicated. */
function internetPorts() {
	if (uci.get('onu-internet', 'config', 'enabled') !== '1')
		return [];

	if (uci.get('onu-internet', 'config', 'mode') !== 'bridge')
		return [];

	return portsOf(uci.get('onu-internet', 'config', 'ports'));
}

function voicePorts() {
	if (uci.get('onu-voice', 'network', 'enabled') !== '1')
		return [];

	switch (uci.get('onu-voice', 'network', 'mode')) {
	case 'bridge':
		return portsOf(uci.get('onu-voice', 'network', 'lan_port'));

	case 'trunk':
		return portsOf(uci.get('onu-voice', 'network', 'trunk_port'));
	}

	return [];
}

/*
 * Ports this page must not offer. The set-top box port is dedicated, so even
 * the voice trunk is off-limits to it; the IPTV trunk may in turn share the
 * voice trunk, so that one is only foreign to the dedicated port.
 */
function foreignPorts(dedicated) {
	var ports = internetPorts();

	if (uci.get('onu-voice', 'network', 'enabled') === '1') {
		if (uci.get('onu-voice', 'network', 'mode') === 'bridge')
			ports = ports.concat(portsOf(uci.get('onu-voice', 'network', 'lan_port')));
		else if (dedicated)
			ports = ports.concat(portsOf(uci.get('onu-voice', 'network', 'trunk_port')));
	}

	return ports;
}

function validateIptvLanPort(sectionId, value) {
	if (!value)
		return true;

	if (internetPorts().indexOf(value) >= 0)
		return _('This port is used by the internet bridge; free it on the internet page first.');

	if (voicePorts().indexOf(value) >= 0)
		return _('This port is already bound by the voice page; free it there first.');

	return true;
}

function validateIptvTrunkPort(sectionId, value) {
	if (!value)
		return true;

	if (internetPorts().indexOf(value) >= 0)
		return _('This port is used by the internet bridge; free it on the internet page first.');

	if (uci.get('onu-voice', 'network', 'enabled') === '1' &&
		uci.get('onu-voice', 'network', 'mode') === 'bridge' &&
		value === uci.get('onu-voice', 'network', 'lan_port'))
		return _('This port is dedicated to the voice bridge; free it on the voice page first.');

	return true;
}

/*
 * True when either multicast proxy is enabled. The proxies terminate the
 * multicast VLAN themselves and deliver the groups to the LAN untagged, which
 * is what makes VID 0 the meaningful whitelist entry in that topology.
 */
function proxyMode() {
	return uci.get('onu-iptv', 'config', 'igmp_proxy') === '1' ||
		uci.get('onu-iptv', 'config', 'mld_proxy') === '1';
}

return view.extend({
	load: function() {
		return Promise.all([
			network.getDevices(),
			uci.load('pon'),
			uci.load('onu-iptv'),
			uci.load('onu-internet'),
			uci.load('onu-voice'),
			fs.exec('/usr/sbin/airoha-ponctl', ['igmp', 'show']).catch(function() { return { stdout: '' }; }),
			fs.exec('/usr/sbin/airoha-ponctl', ['igmp', 'fwd']).catch(function() { return { stdout: '' }; }),
			fs.exec('/usr/sbin/airoha-ponctl', ['igmp', 'mvlan']).catch(function() { return { stdout: '' }; })
		]).then(function(results) {
			return {
				devices: results[0],
				igmpStatus: results[5].stdout || '',
				igmpFwd: results[6].stdout || '',
				igmpMvlan: results[7].stdout || ''
			};
		});
	},

	render: function(data) {
		var devices = data.devices;
		var igmpStatus = data.igmpStatus;
		var igmpFwd = data.igmpFwd;
		var igmpMvlan = data.igmpMvlan;
		var m, s, o, currentPort, currentTrunkPort, lanPorts, trunkPorts;
		var dedicatedTaken, trunkTaken;

		ensureStylesheet();

		/*
		 * The map title is the page heading and the section carries the
		 * fields, so the section must not repeat it: two IPTV headings one
		 * below the other read as two different things. One description at the
		 * top says what the page does.
		 */
		m = new form.Map('onu-iptv', _('IPTV'),
			_('The IPTV VLANs are carried by the PON uplink and handed over to a set-top box or to a downstream router.'));
		m.readonly = !L.hasViewPermission();

		/*
		 * One card, no tabs: the hand-over topology and its VLANs come first,
		 * the multicast switches that ride on top of them follow in the same
		 * list. The card is short enough for a flat list, and a tab would hide
		 * the fact that the IGMP and MLD switches act on the very bridge
		 * configured above - which is what an operator has to see at once.
		 *
		 * The multicast VLAN is deliberately not a field of its own: it is the
		 * counterpart of the service VLAN - leave it empty and the service
		 * VLAN carries multicast too - so it stays right below the service
		 * VLAN. Upstream keeps the two in a flat list as well.
		 */
		s = m.section(form.NamedSection, 'config', 'iptv');
		s.anonymous = true;
		s.addremove = false;

	
		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('In set-top box mode the selected LAN port stays out of br-lan for as long as the bridge is enabled.');

		o = s.option(form.ListValue, 'mode', _('Hand-over mode'));
		o.default = 'bridge';
		o.rmempty = false;
		o.value('bridge', _('Set-top box on a dedicated port'));
		o.value('trunk', _('Single cable: VLANs tagged to one port'));
		o.description = _('Set-top box mode bridges the VLANs to one port. Single cable mode keeps the port in br-lan and hands every VLAN over tagged, so a downstream router can carry internet and IPTV on one cable.');
		o.depends('enabled', '1');

		currentPort = uci.get('onu-iptv', 'config', 'lan_port');

		/*
		 * Ports the internet or voice page already bound are not offered: one
		 * port cannot serve two services. The saved value is registered even
		 * when it is foreign, so a hand-edited configuration stays visible and
		 * the validator below reports it instead of silently dropping it.
		 */
		lanPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^lan[0-9]+$/.test(name);
		}).sort();

		dedicatedTaken = foreignPorts(true);
		trunkTaken = foreignPorts(false);

		o = s.option(form.ListValue, 'lan_port', _('IPTV LAN port'),
			_('The selected port is dedicated to the set-top box.'));
		o.rmempty = false;
		lanPorts.filter(function(name) {
			return dedicatedTaken.indexOf(name) < 0;
		}).forEach(function(name) {
			o.value(name);
		});
		if (currentPort && lanPorts.indexOf(currentPort) < 0)
			o.value(currentPort);
		o.validate = validateIptvLanPort;
		o.depends({ enabled: '1', mode: 'bridge' });

		trunkPorts = (devices || []).map(function(device) {
			return device.getName();
		}).filter(function(name) {
			return /^(lan|wan|eth)[0-9]+$/.test(name);
		}).sort();

		currentTrunkPort = uci.get('onu-iptv', 'config', 'trunk_port');

		o = s.option(form.ListValue, 'trunk_port', _('Trunk port'),
			_('The port stays a member of br-lan; the VLANs below leave it tagged.'));
		o.rmempty = false;
		trunkPorts.filter(function(name) {
			return trunkTaken.indexOf(name) < 0;
		}).forEach(function(name) {
			o.value(name);
		});
		if (currentTrunkPort && trunkPorts.indexOf(currentTrunkPort) < 0)
			o.value(currentTrunkPort);
		o.validate = validateIptvTrunkPort;
		o.depends({ enabled: '1', mode: 'trunk' });

		o = s.option(form.DynamicList, 'trunk_vlans', _('VLANs to hand over'),
			_('One 8021q subinterface pair and one bridge per VLAN. Leave empty to use the service VLAN plus the multicast and IGMP VLANs configured below.'));
		o.datatype = 'range(1,4094)';
		o.rmempty = true;
		o.depends({ enabled: '1', mode: 'trunk' });

	

		o = s.option(form.Value, 'service_vlan', _('Service VLAN'),
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
		o.depends({ enabled: '1', mode: 'bridge' });

		/*
		 * One caption row instead of a tab: the multicast switches below are
		 * the second half of the same bridge configuration, so they follow the
		 * VLAN rows in the same card. A DummyValue with an empty value renders
		 * as a plain label in the theme's label column and carries the group
		 * description.
		 */
		o = s.option(form.DummyValue, '_multicast_group', _('IPv4 / IPv6 multicast'),
			_('IGMP handles the IPv4 side, MLD the IPv6 side; both act on the bridge configured above.'));
		o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.depends('enabled', '1');

	/* IPv4 side of the multicast block */
	o = s.option(form.Flag, 'xpon_snooping', _('Enable PON hardware IGMP snooping'),
		_('The PON MAC learns IGMP joins/leaves through a netfilter hook and programs the PPE multicast flow table, so downstream multicast only crosses the PON when a group has members. This runs in parallel with bridge-level snooping and does not interfere with the IGMP proxy.'));
	o.default = '0';
	o.rmempty = false;
	o.depends('enabled', '1');

	o = s.option(form.Flag, 'xpon_fast_leave', _('Fast leave'),
		_('Drop the forwarding entry immediately on IGMP Leave, without sending a last-member query. Speeds up channel change but may interrupt a stream if the Leave was for the wrong port.'));
	o.default = '0';
	o.rmempty = false;
	o.depends('xpon_snooping', '1');

	o = s.option(form.Flag, 'xpon_mvlan', _('Multicast VLAN isolation'),
		_('Restrict multicast forwarding to the configured multicast VLAN, so IGMP joins on other VLANs do not leak into the multicast flow.'));
	o.default = '0';
	o.rmempty = false;
	o.depends('xpon_snooping', '1');

	/*
	 * The isolation flag alone is a no-op: with the table empty every VLAN
	 * passes. The entries therefore belong right under it, and the field is a
	 * plain list so the operator can see exactly what is programmed.
	 *
	 * 0 is accepted on purpose. With the IGMP proxy on, the ONU terminates
	 * the multicast VLAN and hands multicast to the LAN untagged, so the
	 * driver reports VID 0 for those frames; whitelisting anything else would
	 * filter out the very traffic the proxy just delivered.
	 */
	o = s.option(form.DynamicList, 'xpon_mvlan_list', _('Isolated multicast VLANs'),
		_('Service VLAN IDs whose multicast traffic may pass the PON. Use 0 for the untagged multicast an enabled IGMP proxy delivers to the LAN. While the list is empty no filtering happens, so at least one entry is needed for isolation to take effect.'));
	o.datatype = 'or("0",range(1,4094))';
	o.placeholder = proxyMode() ? '0' : '40';
	o.rmempty = true;
	o.depends('xpon_mvlan', '1');

	if (igmpMvlan) {
		o = s.option(form.DummyValue, '_xpon_igmp_mvlan', _('PON multicast VLAN table'),
			_('Live state from airoha-ponctl igmp mvlan.'));
		o.rawhtml = true;
		o.cfgvalue = function() { return '<pre>' + igmpMvlan + '</pre>'; };
	}

	o = s.option(form.Flag, 'igmp_snooping', _('Enable bridge IGMP snooping'),
		_('The bridge learns which port joined a group and stops flooding multicast to the remaining ports.'));
	o.default = '1';
	o.rmempty = false;
	o.depends('enabled', '1');

	o = s.option(form.Flag, 'igmp_proxy', _('Enable IGMP proxy'),
		_('The ONU joins the groups on behalf of the set-top box instead of bridging the reports. Set-top box mode only: a proxy has to terminate the VLAN, which single cable mode does not do.'));
	o.default = '0';
	o.rmempty = false;
	o.depends({ enabled: '1', mode: 'bridge' });

	o = s.option(form.Flag, 'multicast_querier', _('Enable multicast querier'),
		_('Recommended together with snooping: the bridge sends its own general queries so group memberships do not time out and interrupt the stream.'));
	o.default = '0';
	o.rmempty = false;
	o.depends('enabled', '1');

	if (igmpStatus) {
		o = s.option(form.DummyValue, '_xpon_igmp_status', _('PON IGMP module status'),
			_('Live state from airoha-ponctl igmp show.'));
		o.rawhtml = true;
		o.cfgvalue = function() { return '<pre>' + igmpStatus + '</pre>'; };
	}

	if (igmpFwd) {
		o = s.option(form.DummyValue, '_xpon_igmp_fwd', _('PON multicast forwarding table'),
			_('Live state from airoha-ponctl igmp fwd.'));
		o.rawhtml = true;
		o.cfgvalue = function() { return '<pre>' + igmpFwd + '</pre>'; };
	}

		/* IPv6 side, same block */
		o = s.option(form.Flag, 'mld_snooping', _('Enable MLD snooping'),
			_('Same kernel switch as IGMP snooping: the Linux bridge enables IGMP and MLD snooping together, so turning on either one turns on both.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('enabled', '1');

		o = s.option(form.Flag, 'mld_proxy', _('Enable MLD proxy'),
			_('The ONU joins the IPv6 groups on behalf of the set-top box. omcproxy proxies IGMP and MLD as one instance, so either switch starts the proxy and both must be off to stop it.'));
		o.default = '0';
		o.rmempty = false;
		o.depends({ enabled: '1', mode: 'bridge' });

		return m.render();
	}
});
