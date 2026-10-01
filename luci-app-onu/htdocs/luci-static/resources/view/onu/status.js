// SPDX-License-Identifier: Apache-2.0

'use strict';
'require dom';
'require fs';
'require poll';
'require uci';
'require view';

var STYLESHEET = 'view/onu/onu.css';

/*
 * The PON views follow luci-theme-argon: cards, tables, buttons and the type
 * scale all come from the theme. Only the metric grid, the metric tiles and
 * the status dots are ours, and they are loaded from a single stylesheet once
 * per document.
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

function isEponMode(mode) {
	return (mode || '').indexOf('epon-') === 0;
}

function modeLabel(mode) {
	switch (mode) {
	case 'gpon': return _('GPON');
	case 'xgpon': return _('XG-PON');
	case 'xgspon': return _('XGS-PON');
	case 'epon-1g': return _('EPON 1G/1G');
	case 'epon-10g-1g': return _('10G-EPON 10G/1G');
	case 'epon-10g-10g': return _('10G-EPON 10G/10G');
	case 'none': return _('Not active');
	default: return mode || _('Not active');
	}
}

function getLineModes(item) {
	var line = item.line || {};
	var configured = line.configured_mode || item.section.mode || '';
	var active = line.active_mode;

	if (active === 'none')
		active = '';

	return {
		configured: configured,
		active: active,
		shown: active || configured,
		pending: line.mode_pending === true
	};
}

function displayBoolean(value) {
	if (value === true || value === 1 || value === '1')
		return _('Yes', 'PON status boolean');
	if (value === false || value === 0 || value === '0')
		return _('No', 'PON status boolean');
	return _('Unknown');
}

/*
 * A measurement is carried by its number and only qualified by its unit, so
 * the unit is rendered smaller and muted next to the reading.
 */
function frontendReading(frontend, field, unit) {
	if (frontend.error)
		return _('Read failed');
	if (!Object.prototype.hasOwnProperty.call(frontend, field))
		return _('Not supported');

	return E('span', {}, [
		E('span', { 'class': 'pon-num' }, Number(frontend[field]).toFixed(2)),
		E('span', { 'class': 'pon-unit' }, unit)
	]);
}

function displayLifecycle(value) {
	switch (value) {
	case 'stopped': return _('Stopped');
	case 'wait-optical-signal': return _('Waiting for optical signal');
	case 'pma-configured': return _('PMA configured');
	case 'wait-line-sync': return _('Waiting for line synchronization');
	case 'protocol-activating': return _('Protocol activation in progress');
	case 'operational': return _('Operational');
	case 'error': return _('Error');
	default: return value || _('Unknown');
	}
}

function displayMpcpState(value) {
	switch (value) {
	case 'wait': return _('Waiting for discovery');
	case 'registering': return _('Waiting for Discovery Gate');
	case 'register-request': return _('Register Request sent');
	case 'register-pending': return _('Register received; ACK pending');
	case 'registered': return _('Registered');
	case 'denied': return _('Registration denied');
	default: return value || _('Unknown');
	}
}

function displayOnuState(value) {
	switch (value) {
	case 'O1': return _('O1 — Initial');
	case 'O2_3': return _('O2-3 — Serial number');
	case 'O4': return _('O4 — Ranging');
	case 'O5': return _('O5 — Operation');
	case 'O7': return _('O7 — Emergency stop');
	default: return value || _('Unknown');
	}
}

function displaySync(value) {
	if (value === 'not-applicable') return _('Not applicable');
	switch (value) {
	case 'hunt': return _('Hunt');
	case 'pre-sync': return _('Pre-sync');
	case 'in-sync': return _('Synchronized');
	case 're-sync': return _('Re-synchronizing');
	default: return value || _('Unknown');
	}
}

function displayAuthentication(value) {
	switch (value) {
	case 'not-requested': return _('OLT did not request authentication');
	case 'pending': return _('Pending');
	case 'not-reported': return _('Not reported');
	case 'not-authenticated': return _('Not authenticated');
	case 'accepted': return _('Accepted');
	case 'loid-not-found': return _('LOID does not exist');
	case 'password-mismatch': return _('LOID exists, but the password is incorrect');
	case 'loid-conflict': return _('LOID is already authenticated by another ONU');
	case 'reserved-status': return _('Reserved authentication status');
	default: return value || _('Unknown');
	}
}

function displayBackendState(value) {
	switch (value) {
	case 'inactive': return _('PON line stopped');
	case 'waiting-for-gem': return _('Waiting for GEM configuration');
	case 'waiting-for-alloc-id': return _('Waiting for PLOAM Alloc-ID assignment');
	case 'alloc-id-timeout': return _('PLOAM did not assign the Alloc-IDs in time');
	case 'kernel-mapping-present': return _('Existing kernel mapping');
	case 'applied': return _('Applied');
	case 'multiple-gems-unsupported': return _('Multiple data paths require packet classification');
	case 'apply-failed': return _('Failed to apply mapping');
	case 'clear-failed': return _('Failed to clear mapping');
	default: return value || _('Unknown');
	}
}

function displayCtcDiscovery(value) {
	switch (value) {
	case 'passive-wait': return _('Waiting for CTC discovery');
	case 'version-offered': return _('CTC version offered');
	case 'operational': return _('Operational');
	default: return value || _('Unknown');
	}
}

function displayVlanMode(value) {
	switch (value) {
	case 0: return _('Transparent');
	case 1: return _('Tag');
	case 2: return _('Translation');
	case 3: return _('N:1 aggregation');
	case 4: return _('Trunk');
	default: return _('Not provisioned');
	}
}

function displayVlanIds(values) {
	return Array.isArray(values.vlan_ids) && values.vlan_ids.length > 0
		? values.vlan_ids.join(', ') : _('Not provisioned');
}

function displayOmciVlanIds(values) {
	if (Array.isArray(values.vlan_ids) && values.vlan_ids.length > 0)
		return values.vlan_ids.join(', ');
	if (values.data_path_all_vlans === true)
		return _('Any VLAN (transparent)');
	return _('Not provisioned');
}

function displayMulticastVlanIds(values) {
	return Array.isArray(values.multicast_vlan_ids) && values.multicast_vlan_ids.length > 0
		? values.multicast_vlan_ids.join(', ') : _('Not provisioned');
}

function displayIgmpUpstreamVlanIds(values) {
	if (Array.isArray(values.igmp_upstream_vlan_ids) && values.igmp_upstream_vlan_ids.length > 0)
		return values.igmp_upstream_vlan_ids.join(', ');
	if (Array.isArray(values.igmp_upstream_tag_controls) &&
	    values.igmp_upstream_tag_controls.indexOf(0) >= 0)
		return _('Unchanged');
	return _('Not provisioned');
}

function displayIgmpTagControl(values) {
	var labels = {
		0: _('Transparent'),
		1: _('Add tag'),
		2: _('Replace TCI'),
		3: _('Replace VID')
	};

	return Array.isArray(values.igmp_upstream_tag_controls) &&
		values.igmp_upstream_tag_controls.length > 0
		? values.igmp_upstream_tag_controls.map(function(value) {
			return labels[value] || String(value);
		}).join(', ')
		: _('Not provisioned');
}

function displayBroadcastKeys(values) {
	if (!values.enhanced_security)
		return _('Enhanced security disabled');
	return Array.isArray(values.broadcast_key_indexes) && values.broadcast_key_indexes.length > 0
		? _('Key index %s').format(values.broadcast_key_indexes.join(', ')) : _('Not provisioned');
}

/*
 * Severity is a visual reinforcement only. Each tile and row still prints the
 * state as text, so the page stays readable without colour.
 */
function lifecycleSeverity(value) {
	switch (value) {
	case 'operational': return 'ok';
	case 'error': return 'error';
	case 'stopped': return '';
	default: return 'pending';
	}
}

function booleanSeverity(value) {
	if (value === true || value === 1 || value === '1')
		return 'ok';
	if (value === false || value === 0 || value === '0')
		return 'error';
	return '';
}

function syncSeverity(value) {
	if (value === 'in-sync')
		return 'ok';
	if (value === 'not-applicable')
		return '';
	return 'pending';
}

function onuStateSeverity(value) {
	if (value === 'O5')
		return 'ok';
	if (value === 'O7')
		return 'error';
	return 'pending';
}

function mpcpSeverity(value) {
	if (value === 'registered')
		return 'ok';
	if (value === 'denied')
		return 'error';
	return 'pending';
}

function authenticationSeverity(value) {
	switch (value) {
	case 'accepted': return 'ok';
	case 'pending':
	case 'not-reported':
	case 'not-requested': return 'pending';
	case 'not-authenticated':
	case 'loid-not-found':
	case 'password-mismatch':
	case 'loid-conflict':
	case 'reserved-status': return 'error';
	default: return '';
	}
}

/*
 * A LOID that is not configured is not a fault. An operator that authenticates
 * by password issues no LOID at all, and a LOID present in the configuration
 * while password authentication is selected is simply unused. Only a line that
 * announces LOID authentication and then has nothing to present is a problem,
 * and the daemon reports that separately as ctc_loid_advertised.
 *
 * The agent resolves the mode to exactly one of the two names, including for a
 * configuration written before the option existed, so anything else is a value
 * this page does not understand rather than a third mode.
 */
function authModeName(mode) {
	switch (mode) {
	/* The same words head the authentication-result tile, in a different sense. */
	case 'loid': return _('LOID authentication', 'PON authentication mode');
	case 'password': return _('Password authentication', 'PON authentication mode');
	default: return null;
	}
}

function displayCredential(values) {
	if (values.auth_mode === 'password')
		return values.loid_configured ?
			_('LOID stored but not used') : _('Registration-ID');

	if (values.auth_mode === 'loid')
		return values.loid_configured ? _('Configured') : _('Not configured');

	/* An agent too old to report the mode: say what is known, nothing more. */
	return displayBoolean(values.loid_configured);
}

function credentialSeverity(values) {
	/* Password authentication needs no LOID, however the config reads. */
	if (values.auth_mode === 'password')
		return values.ctc_loid_advertised ? 'pending' : '';

	/*
	 * The OLT was told there is a LOID to look up, so an empty one genuinely
	 * cannot be answered.
	 */
	if (values.ctc_loid_advertised)
		return values.loid_configured ? 'ok' : 'error';

	return values.loid_configured ? 'ok' : '';
}

function backendSeverity(value) {
	switch (value) {
	case 'applied': return 'ok';
	case 'inactive': return '';
	case 'alloc-id-timeout':
	case 'multiple-gems-unsupported':
	case 'apply-failed':
	case 'clear-failed': return 'error';
	default: return 'pending';
	}
}

function ctcSeverity(value) {
	if (value === 'operational')
		return 'ok';
	if (value === 'passive-wait')
		return 'pending';
	return '';
}

function loadProtocolStatus(section, unavailable, invalid) {
	return L.resolveDefault(
		fs.exec_direct('/usr/bin/pondctl', [ 'status', '--line', section.line ]), null
	).then(function(output) {
		if (output == null)
			return { section: section, values: {}, error: unavailable };
		try {
			return { section: section, values: JSON.parse(output), error: null };
		} catch (exception) {
			return { section: section, values: {}, error: invalid };
		}
	});
}

function loadStatus() {
	var lines = uci.sections('pon', 'xpon'),
		lineByName = {};

	lines.forEach(function(section) {
		lineByName[section['.name']] = section;
	});

	var lineJobs = lines.map(function(section) {
		var device = section.device || '';

		if (!device)
			return Promise.resolve({ section: section, line: {}, error: _('No device configured') });
		return L.resolveDefault(fs.exec_direct('/usr/sbin/ponctl',
			[ '--device', device, 'status', '--json' ]), null).then(function(output) {
			var snapshot;
			try {
				snapshot = JSON.parse(output);
				if (snapshot.schema_version !== 1 || !snapshot.line)
					throw new Error('status schema');
			} catch (error) {
				return { section: section, line: {},
					error: output == null ? _('Device unavailable') :
						_('Invalid status response') };
			}
			return {
				section: section,
				line: snapshot.line,
				frontend: snapshot.frontend,
				registration: snapshot.registration,
				datapath: snapshot.datapath,
				counters: snapshot.counters
			};
		});
	});

	return Promise.all([
		Promise.all(lineJobs),
			Promise.all(uci.sections('pon', 'omci').filter(function(section) {
				var line = lineByName[section.line], mode = line ? line.mode || '' : '';
				return mode.indexOf('epon-') !== 0;
			}).map(function(section) {
				return loadProtocolStatus(section,
					_('Unable to read OMCI status'), _('Invalid OMCI status response'));
			})),
			Promise.all(uci.sections('pon', 'oam').filter(function(section) {
				var line = lineByName[section.line], mode = line ? line.mode || '' : '';
				return mode.indexOf('epon-') === 0;
			}).map(function(section) {
				return loadProtocolStatus(section,
					_('Unable to read OAM status'), _('Invalid OAM status response'));
		}))
	]).then(function(results) {
		return { lines: results[0], omci: results[1], oam: results[2] };
	});
}

function stateLabel(severity, text) {
	if (!severity)
		return E('span', { 'class': 'pon-state' }, text);

	return E('span', { 'class': 'pon-state' }, [
		E('span', { 'class': 'pon-dot', 'data-state': severity, 'aria-hidden': 'true' }),
		text
	]);
}

function badge(text) {
	return E('span', { 'class': 'ifacebadge' }, text);
}

function tileValue(value) {
	if (value == null || value === '')
		return _('Unknown');
	if (typeof value === 'object')
		return value;
	return String(value);
}

function metricTile(label, value, severity) {
	return E('dl', { 'class': 'pon-tile' }, [
		E('dt', {}, label),
		E('dd', {}, stateLabel(severity, tileValue(value)))
	]);
}

function metricGrid(tiles) {
	return E('div', { 'class': 'pon-grid' }, tiles);
}

/* One label/value pair of a detail list. */
function listRow(label, value, severity) {
	return [
		E('dt', {}, label),
		E('dd', {}, stateLabel(severity, tileValue(value)))
	];
}

function listNodes(rows) {
	var nodes = [];

	rows.forEach(function(row) {
		nodes.push(row[0], row[1]);
	});

	return nodes;
}

/*
 * Line details and counters are label/value rows, not more tiles. A dozen
 * boxed tiles of short values read as a spreadsheet; rows keep the eye on the
 * values, give long strings room to wrap and let figures share a column start.
 */
function detailList(rows, flags) {
	var classes = [ 'pon-list' ];

	if (flags && flags.split)
		classes.push('pon-list--split');
	if (flags && flags.numeric)
		classes.push('pon-list--numeric');

	return E('dl', { 'class': classes.join(' ') }, listNodes(rows));
}

/*
 * Line details stay visible: they answer "is the line set up the way I
 * expect", which is read together with the headline metrics, not dug out of a
 * fold. Only the counters are folded, because they are for troubleshooting.
 */
function detailBlock(title, rows) {
	return E('div', { 'class': 'pon-block' }, [
		E('h4', { 'class': 'pon-subhead' }, title),
		detailList(rows)
	]);
}

function detailGroup(group) {
	var list = detailList(group.rows, group);

	if (!group.title)
		return list;

	return E('div', {}, [
		E('h4', { 'class': 'pon-subhead' }, group.title),
		list
	]);
}

function detailFold(title, groups, instance) {
	var count = groups.reduce(function(total, group) {
		return total + group.rows.length;
	}, 0);

	return E('details', { 'class': 'pon-fold', 'data-pon-details': instance }, [
		E('summary', {}, [
			title,
			E('span', { 'class': 'pon-count' }, String(count))
		]),
		E('div', { 'class': 'pon-fold-body' }, groups.map(detailGroup))
	]);
}

function cardHeader(title, tags) {
	return E('h3', {}, [
		title,
		/* Argon floats .pull-right, so the tags stay on the header row. */
		E('span', { 'class': 'pull-right pon-tags' }, tags)
	]);
}

function modeRows(mode) {
	return [
		listRow(_('Current line mode'), modeLabel(mode.active)),
		listRow(_('Configured line mode'), modeLabel(mode.configured)),
		listRow(_('Configuration state'), !mode.active ? _('Line stopped') :
			(mode.pending ? _('Takes effect after interface restart') : _('Applied')),
			mode.pending && mode.active ? 'pending' : '')
	];
}

/*
 * The optical frontend is neither a link state nor a frame counter, so it gets
 * its own group at the end of the counters fold.
 */
function frontendRows(frontend) {
	return [
		listRow(_('Calibration state'), ({
			ready: _('Loaded'), missing: _('Missing'), invalid: _('Invalid format'),
			'not-required': _('Not required'), unknown: _('Unknown')
		})[frontend.calibration] || _('Unknown'),
			frontend.calibration === 'ready' ? 'ok' :
			(frontend.calibration === 'missing' || frontend.calibration === 'invalid' ?
				'error' : '')),
		listRow(_('Frontend TX gate enabled'), frontend.error ?
			_('Read failed') : displayBoolean(frontend.tx_gate_enabled),
			frontend.error ? 'error' : booleanSeverity(frontend.tx_gate_enabled))
	];
}

function renderLine(item) {
	var line = item.line || {};
	var frontend = item.frontend || {};
	var registration = item.registration || {};
	var counters = item.counters || {};
	var datapath = item.datapath || {};
	var mode = getLineModes(item);
	var epon = isEponMode(mode.shown);
	var title = _('PON');
	var tags, tiles, rows, groups;

	if (item.error)
		return { mode: mode.shown, nodes: [ E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			metricGrid([ metricTile(_('Error'), item.error, 'error') ])
		]) ] };

	tags = [
		badge(modeLabel(mode.shown)),
		stateLabel(lifecycleSeverity(line.lifecycle), displayLifecycle(line.lifecycle))
	];

	tiles = [
		metricTile(_('Line state'), displayLifecycle(line.lifecycle),
			lifecycleSeverity(line.lifecycle)),
		metricTile(_('Optical signal detected'), displayBoolean(line.optical_signal),
			booleanSeverity(line.optical_signal)),
		metricTile(_('Receive optical power'),
			frontendReading(frontend, 'rx_power_dbm', 'dBm')),
		metricTile(_('Transmit optical power'),
			frontendReading(frontend, 'tx_power_dbm', 'dBm')),
		metricTile(_('Optical frontend temperature'),
			frontendReading(frontend, 'temperature_celsius', '°C'))
	];

	rows = modeRows(mode);

	if (epon) {
		/* Same ordering rule as the ITU-T branch: the MPCP state stays in the
		   always visible grid, the assigned LLID is only a number and lives
		   with the other line details. */
		tiles.push(
			metricTile(_('MPCP state'), displayMpcpState(registration.mpcp_state),
				mpcpSeverity(registration.mpcp_state))
		);
		rows = rows.concat([
			listRow(_('PCS synchronized'), displayBoolean(line.pcs_sync),
				booleanSeverity(line.pcs_sync)),
			listRow(_('PCS profile'), line.pcs_profile_valid ?
				line.pcs_profile : _('Not configured')),
			listRow(_('LLID0'), registration.llid_valid === true ?
				E('var', {}, String(registration.llid)) : _('Not assigned')),
			listRow(_('LLID0 data path configured'),
				displayBoolean(datapath.data_path_configured),
				booleanSeverity(datapath.data_path_configured)),
			listRow(_('Upstream burst transmitter ready'),
				displayBoolean(registration.upstream_tx_armed),
				booleanSeverity(registration.upstream_tx_armed))
		]);
		groups = [
			{ title: _('Link events'), rows: [
				listRow(_('Last start error'), line.last_start_error),
				listRow(_('Receiver activation count'), counters.rx_start_count),
				listRow(_('PCS synchronization losses'), counters.sync_losses),
				listRow(_('PCS recovery attempts'), counters.recoveries),
				listRow(_('Full PMA reinitializations'), counters.full_reinitializations)
			], numeric: true, split: true },
			{ title: _('Registration handshake'), rows: [
				listRow(_('Discovery Gates received'), counters.discovery_gates),
				listRow(_('Register Request commands submitted'), counters.register_requests),
				listRow(_('Register messages received'), counters.register_messages),
				listRow(_('Register ACKs transmitted'), counters.register_acks),
				listRow(_('Register NACKs'), counters.register_nacks),
				listRow(_('MPCP timeouts'), counters.mpcp_timeouts),
				listRow(_('MAC error conditions'), counters.mac_errors)
			], numeric: true, split: true },
			{ title: _('Optical frontend'), rows: frontendRows(frontend),
				split: true }
		];
	} else {
		/*
		 * The ONU state is the one protocol state that stays in the grid: it
		 * answers whether the ONU reached the OLT at all. The GTC/XGTC state
		 * is only the frame synchronization underneath it, so it belongs with
		 * the other line details, right after PHY ready — where it sat before
		 * the card rework, and where EPON keeps its PCS synchronization.
		 */
		tiles.push(
			metricTile(_('ONU state'), displayOnuState(registration.onu_state),
				onuStateSeverity(registration.onu_state))
		);
		rows = rows.concat([
			listRow(_('PHY ready'), displayBoolean(line.phy_ready),
				booleanSeverity(line.phy_ready)),
			listRow(mode.shown === 'gpon' ? _('GTC state') : _('XGTC state'),
				displaySync(line.xgtc_sync), syncSeverity(line.xgtc_sync)),
			listRow(_('ONU-ID'), registration.onu_id_valid === true ?
				E('var', {}, String(registration.onu_id)) : _('Not assigned')),
			listRow(_('Kernel data path configured'),
				displayBoolean(datapath.data_path_configured),
				booleanSeverity(datapath.data_path_configured)),
			listRow(_('Service ready'), displayBoolean(datapath.service_ready),
				booleanSeverity(datapath.service_ready)),
			listRow(_('Upstream burst transmitter ready'),
				displayBoolean(registration.upstream_tx_armed),
				booleanSeverity(registration.upstream_tx_armed))
		]);
		groups = [
			{ title: _('Link events'), rows: [
				listRow(_('Last start error'), line.last_start_error),
				listRow(_('Receiver activation count'), counters.rx_start_count),
				listRow(_('Line synchronization losses'), counters.sync_losses),
				listRow(_('Receiver recovery attempts'), counters.recoveries),
				listRow(_('Full PMA reinitializations'), counters.full_reinitializations)
			], numeric: true, split: true },
			{ title: _('Frame counters'), rows: [
				listRow(_('Downstream transport frames'), counters.xgtc_rx),
				listRow(_('Downstream PLOAMd received'), counters.ploamd_rx),
				listRow(_('Downstream GEM frames'), counters.xgem_rx),
				listRow(_('Upstream bursts transmitted'), counters.upstream_bursts_tx),
				listRow(_('Upstream PLOAMu transmitted'), counters.ploamu_tx),
				listRow(_('Upstream GEM frames'), counters.xgem_tx)
			], numeric: true, split: true },
			{ title: _('Optical frontend'), rows: frontendRows(frontend),
				split: true }
		];
	}

	return { mode: mode.shown, nodes: [
		E('div', { 'class': 'cbi-section' }, [
			cardHeader(title, tags),
			metricGrid(tiles),
			detailBlock(_('Line details'), rows),
			detailFold(epon ? _('EPON line counters and diagnostics') :
				_('ITU-T PON counters and diagnostics'), groups,
				item.section['.name'] + '-counters')
		])
	] };
}

function renderOmci(item) {
	var values = item.values;
	var title = _('OMCI');

	if (item.error)
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			metricGrid([ metricTile(_('Error'), item.error, 'error') ])
		]);

	return E('div', { 'class': 'cbi-section' }, [
		cardHeader(title, [
			badge(_('OMCI')),
			stateLabel(booleanSeverity(values.channel_available),
				displayBoolean(values.channel_available))
		]),
		metricGrid([
			metricTile(_('OMCI channel online'), displayBoolean(values.channel_available),
				booleanSeverity(values.channel_available)),
			metricTile(_('LOID authentication'),
				displayAuthentication(values.authentication_meaning),
				authenticationSeverity(values.authentication_meaning)),
			metricTile(_('Data path state'), displayBackendState(values.backend_state),
				backendSeverity(values.backend_state)),
			metricTile(_('Active Alloc-ID'), values.active_alloc_id),
			metricTile(_('Active GEM-ID'), values.active_gem_id)
		]),
		detailFold(_('Protocol details'), [ { title: null, rows: [
			listRow(_('Authentication mode'),
				authModeName(values.auth_mode) || _('Not reported')),
			listRow(_('LOID configured locally'), displayCredential(values),
				credentialSeverity(values)),
			listRow(_('OLT vendor ID'), values.olt_vendor_id),
			listRow(_('OLT equipment ID'), values.olt_equipment_id),
			listRow(_('OLT version'), values.olt_version),
			listRow(_('OMCI VLAN IDs'), displayOmciVlanIds(values)),
			listRow(_('Multicast downstream VLAN IDs'), displayMulticastVlanIds(values)),
			listRow(_('IGMP upstream tag action'), displayIgmpTagControl(values)),
			listRow(_('IGMP upstream VLAN IDs'), displayIgmpUpstreamVlanIds(values)),
			listRow(_('OLT broadcast keys'), displayBroadcastKeys(values)),
			listRow(_('Received OMCI messages'), values.rx_messages),
			listRow(_('OMCI parse errors'), values.parse_errors)
		] } ], item.section['.name'] + '-omci')
	]);
}

function renderOam(item) {
	var values = item.values;
	var title = _('EPON OAM');
	var ctc = values.operator === 'ctc';
	var tiles, rows, tags;

	if (item.error)
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, title),
			metricGrid([ metricTile(_('Error'), item.error, 'error') ])
		]);

	tags = [
		badge(_('EPON OAM')),
		stateLabel(booleanSeverity(values.channel_available),
			displayBoolean(values.channel_available))
	];

	tiles = [
		metricTile(_('LLID OAM channel online'), displayBoolean(values.channel_available),
			booleanSeverity(values.channel_available)),
		metricTile(_('IEEE OAM discovery completed'),
			displayBoolean(values.ieee_discovery_completed),
			booleanSeverity(values.ieee_discovery_completed)),
		metricTile(_('CTC discovery'), ctc ?
			displayCtcDiscovery(values.ctc_discovery_state) : _('Not applicable'),
			ctc ? ctcSeverity(values.ctc_discovery_state) : ''),
		metricTile(_('LOID authentication'), ctc ?
			displayAuthentication(values.authentication_status) : _('Not applicable'),
			ctc ? authenticationSeverity(values.authentication_status) : '')
	];

	rows = [
		listRow(_('Configured OAM profile'), ctc ?
			_('IEEE 802.3ah + CTC') : _('IEEE 802.3ah')),
		listRow(_('CTC version'), values.ctc_version == null ?
			_('Not negotiated') : '0x' + Number(values.ctc_version).toString(16)),
	/*
	 * EPON OAM always authenticates by LOID, so there is no mode to consult
	 * here; an unset LOID is simply unconfigured, not a failure.
	 */
	listRow(_('LOID configured locally'), displayBoolean(values.loid_configured),
		values.loid_configured ? 'ok' : ''),
		listRow(_('CTC VLAN mode'), displayVlanMode(values.vlan_mode)),
		listRow(_('CTC VLAN IDs'), displayVlanIds(values)),
		listRow(_('Received OAM messages'), values.rx_messages),
		listRow(_('OAM parse errors'), values.parse_errors)
	];

	return E('div', { 'class': 'cbi-section' }, [
		cardHeader(title, tags),
		metricGrid(tiles),
		detailFold(_('Protocol details'), [ { title: null, rows: rows } ],
			item.section['.name'] + '-oam')
	]);
}

function renderStatus(data) {
	var nodes = [];
	var activeModes = {};

	data.lines.forEach(function(item) {
		var rendered = renderLine(item);

		activeModes[item.section['.name']] = rendered.mode;
		rendered.nodes.forEach(function(node) { nodes.push(node); });
	});
	data.omci.forEach(function(item) {
		if (!isEponMode(activeModes[item.section.line || '']))
			nodes.push(renderOmci(item));
	});
	data.oam.forEach(function(item) {
		if (isEponMode(activeModes[item.section.line || '']))
			nodes.push(renderOam(item));
	});

	if (nodes.length === 0)
		nodes.push(E('p', {}, _('No PON instances are configured.')));
	return nodes;
}

return view.extend({
	load: function() {
		return uci.load('pon').then(loadStatus);
	},

	render: function(data) {
		var container = E('div', { 'id': 'pon-status' }, renderStatus(data));
		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('ONU PON status')), container
		]);

		ensureStylesheet();

		poll.add(function() {
			return loadStatus().then(function(status) {
				var opened = Object.create(null);

				/* Polling rebuilds the tables, so keep expanded counters open. */
				container.querySelectorAll('details[data-pon-details]').forEach(function(node) {
					if (node.open)
						opened[node.getAttribute('data-pon-details')] = true;
				});
				dom.content(container, renderStatus(status));
				container.querySelectorAll('details[data-pon-details]').forEach(function(node) {
					node.open = opened[node.getAttribute('data-pon-details')] === true;
				});
			});
		}, 3);
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
