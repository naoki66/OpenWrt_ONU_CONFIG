// SPDX-License-Identifier: Apache-2.0
//

'use strict';
'require baseclass';
'require fs';
'require rpc';
'require uci';

/*
 * PON status card for the status overview page.
 *
 * view/status/index.js scans view/status/include/ and renders every *.js file
 * it finds there, ordered by file name. This file is named 29a_pon.js so that
 * it sorts between 29_ports.js (port status) and 30_network.js (network),
 * which is where the card belongs. No patch to luci-mod-status is required.
 *
 * Data sources (Airoha PON userspace stack):
 *   uci pon                 xpon sections name the PON netdev of each line
 *   ponctl --json           line state and optical frontend readings
 *   ubus network.device     byte counters for the port rates (sysfs fallback)
 *   ponstat-conn            TCP/UDP connection and hardware offload counts
 *
 * When no xpon section carries a device, the pon config is missing, or
 * ponctl is unavailable on every line, load() rejects and the overview page
 * hides the whole card - that is what keeps non-PON devices free of an empty
 * section.
 */

var PONCTL = '/usr/sbin/ponctl';
var CONNSTAT = '/usr/sbin/ponstat-conn';

var prevRates = {};
var statsSource = null;

var callDeviceStatus = rpc.declare({
	object: 'network.device',
	method: 'status'
});

var TILE_BG = 'var(--background-color-medium, #f4f4f4)';
var TXT_MUTED = 'var(--text-color-medium, #808080)';
var TXT_STRONG = 'var(--text-color-highest, #000000)';

var LIFECYCLE_LABEL = {
	'operational': '在线',
	'wait-optical-signal': '无光',
	'wait-line-sync': '同步中',
	'protocol-activating': '注册中',
	'pma-configured': 'PMA 就绪',
	'stopped': '已停用',
	'error': '故障'
};

var ONU_STATES = {
	'O1': { zh: '初始状态', en: 'Initial-state', severity: 'muted' },
	'O2': { zh: '待机状态', en: 'Standby-state', severity: 'muted' },
	'O3': { zh: '序列号状态', en: 'Serial-number-state', severity: 'warning' },
	'O4': { zh: '测距状态', en: 'Ranging-state', severity: 'warning' },
	'O5': { zh: '运行状态', en: 'Operation-state', severity: 'success' },
	'O6': { zh: 'POPUP 状态', en: 'POPUP-state', severity: 'warning' },
	'O7': { zh: '紧急停止状态', en: 'Emergency-stop-state', severity: 'error' }
};

var BADGE_BG = {
	error: '#d9534f',
	warning: '#f0ad4e',
	success: '#5cb85c',
	muted: '#8a8a8a'
};

var WAVELENGTHS = {
	'gpon': [ '1310', '1490' ],
	'xgpon': [ '1270', '1577' ],
	'xgspon': [ '1270', '1577' ],
	'epon-1g': [ '1310', '1310' ],
	'epon-10g-1g': [ '1270', '1577' ],
	'epon-10g-10g': [ '1270', '1577' ]
};

function readFrontend(device) {
	return L.resolveDefault(fs.exec_direct(PONCTL,
		[ '--device', device, 'status', '--json' ]), null).then(function(output) {
		if (!output)
			return null;

		try {
			var snapshot = JSON.parse(output);

			if (snapshot.schema_version !== 1)
				throw new Error('unsupported schema');

			return {
				line: L.isObject(snapshot.line) ? snapshot.line : {},
				frontend: L.isObject(snapshot.frontend) ? snapshot.frontend : {},
				registration: L.isObject(snapshot.registration) ? snapshot.registration : {}
			};
		}
		catch (e) {
			return null;
		}
	});
}

function sampleSysfs(device) {
	var base = '/sys/class/net/' + device + '/statistics';

	return Promise.all([
		L.resolveDefault(fs.trimmed(base + '/rx_bytes'), null),
		L.resolveDefault(fs.trimmed(base + '/tx_bytes'), null)
	]).then(function(v) {
		var rx = parseInt(v[0]), tx = parseInt(v[1]);

		if (isNaN(rx) || isNaN(tx))
			return null;

		return { rx: rx, tx: tx, t: Date.now() };
	});
}

function sampleUbus(device) {
	return L.resolveDefault(callDeviceStatus(), null).then(function(res) {
		var dev = (L.isObject(res) && L.isObject(res[device])) ? res[device] : null;
		var st = (dev != null && L.isObject(dev.statistics)) ? dev.statistics : null;
		var rx = (st != null) ? parseInt(st.rx_bytes) : NaN;
		var tx = (st != null) ? parseInt(st.tx_bytes) : NaN;

		if (isNaN(rx) || isNaN(tx))
			return null;

		return { rx: rx, tx: tx, t: Date.now() };
	});
}

function sampleNet(device) {
	if (statsSource == 'sysfs')
		return sampleSysfs(device);

	return sampleUbus(device).then(function(cur) {
		if (cur != null) {
			statsSource = 'ubus';
			return cur;
		}

		return sampleSysfs(device).then(function(cur2) {
			if (cur2 != null)
				statsSource = 'sysfs';

			return cur2;
		});
	});
}

function netRate(from, to) {
	var dt = (to.t - from.t) / 1000.0;

	if (dt <= 0 || to.rx < from.rx || to.tx < from.tx)
		return null;

	return {
		rx: (to.rx - from.rx) * 8 / 1048576 / dt,
		tx: (to.tx - from.tx) * 8 / 1048576 / dt
	};
}

function readRate(device) {
	return sampleNet(device).then(function(cur) {
		if (cur == null) {
			delete prevRates[device];
			return { error: true };
		}

		var prev = prevRates[device];

		prevRates[device] = cur;

		if (prev != null) {
			var r = netRate(prev, cur);

			if (r != null)
				return r;
		}

		return new Promise(function(resolve) {
			window.setTimeout(function() {
				sampleNet(device).then(function(cur2) {
					if (cur2 == null) {
						delete prevRates[device];
						resolve({ error: true });
						return;
					}

					prevRates[device] = cur2;
					resolve(netRate(cur, cur2));
				});
			}, 500);
		});
	});
}

function readConns() {
	return L.resolveDefault(fs.exec_direct('/bin/sh', [ CONNSTAT ]), null).then(function(output) {
		var vals = {},
		    lines = String(output || '').split('\n'),
		    i, m;

		for (i = 0; i < lines.length; i++) {
			m = lines[i].match(/^([a-z0-9_]+)=(\d+)$/);

			if (m)
				vals[m[1]] = parseInt(m[2]);
		}

		if (typeof(vals.tcp_total) != 'number' &&
		    typeof(vals.udp_total) != 'number')
			return null;

		function pair(total, npu) {
			return (typeof(total) == 'number')
				? { total: total, npu: (typeof(npu) == 'number') ? npu : 0 }
				: null;
		}

		return { tcp: pair(vals.tcp_total, vals.tcp_npu),
		         udp: pair(vals.udp_total, vals.udp_npu) };
	});
}

function lineState(line) {
	var mode = (line && line.active_mode) || '';
	var lifecycle = (line && line.lifecycle) || '';
	var parts = [], fault = false, progress = false;

	if (lifecycle == 'operational' && mode && mode != 'none') {
		parts.push(LIFECYCLE_LABEL['operational']);
	}
	else {
		if (lifecycle == 'wait-optical-signal' || (line && line.optical_signal === false)) {
			parts.push(LIFECYCLE_LABEL['wait-optical-signal']);
			fault = true;
		}

		if (!mode || mode == 'none') {
			parts.push('断线');
			fault = true;
		}

		if (lifecycle == 'wait-line-sync' || lifecycle == 'protocol-activating' ||
		    lifecycle == 'pma-configured') {
			parts.push(LIFECYCLE_LABEL[lifecycle]);
			progress = true;
		}

		if (lifecycle == 'error') {
			parts.push(LIFECYCLE_LABEL['error']);
			fault = true;
		}

		if (lifecycle == 'stopped') {
			parts.push(LIFECYCLE_LABEL['stopped']);
		}

		if (!parts.length)
			parts.push(lifecycle || '未知');
	}

	return {
		text: parts.join(' / '),
		severity: fault ? 'error' : (progress ? 'warning' :
			(parts.length == 1 && parts[0] == LIFECYCLE_LABEL['operational']) ? 'success' : 'muted')
	};
}

function metricTile(label, frontend, field, unit, digits) {
	var value;

	if (frontend == null || frontend.error)
		value = '读取失败';
	else if (!Object.prototype.hasOwnProperty.call(frontend, field))
		value = '不支持';
	else
		value = Number(frontend[field]).toFixed(digits) + ' ' + unit;

	return E('div', {
		'style': 'flex: 1 1 118px; min-width: 104px; padding: 7px 10px; border-radius: 6px; background: ' + TILE_BG
	}, [
		E('div', {
			'style': 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: ' + TXT_MUTED + '; white-space: nowrap'
		}, [
			E('span', {
				'style': 'width: 7px; height: 7px; border-radius: 50%; background: ' + TXT_MUTED + '; flex: 0 0 auto'
			}),
			label
		]),
		E('div', {
			'style': 'margin-top: 3px; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG + '; white-space: nowrap'
		}, value)
	]);
}

function ratePanel(rate) {
	var ok = (rate != null && !rate.error && rate.rx != null && rate.tx != null);

	function row(dir, arrow, value) {
		return E('div', { 'style': 'display: flex; align-items: baseline; gap: 6px; white-space: nowrap' }, [
			E('span', { 'style': 'font-size: 13px; color: ' + TXT_MUTED }, arrow),
			E('span', { 'style': 'font-size: 12px; color: ' + TXT_MUTED }, dir),
			E('strong', {
				'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG
			}, (value != null) ? value.toFixed(2) : '—'),
			E('span', { 'style': 'font-size: 10px; color: ' + TXT_MUTED }, 'Mibit/s')
		]);
	}

	return E('div', {
		'style': 'flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-radius: 6px; background: ' + TILE_BG
	}, [
		row('上行', '↑', ok ? rate.tx : null),
		row('下行', '↓', ok ? rate.rx : null)
	]);
}

/*
 * Connection counters as one block, laid out like the rate panel:
 * TCP on the upper row, UDP on the lower row. Each row shows the
 * live connection count and how many of them are hardware offloaded.
 */
function connBlock(conns) {
	if (!conns || (!conns.tcp && !conns.udp))
		return E('div', { 'style': 'font-size: 12px; color: ' + TXT_MUTED }, '连接数不可用');

	function row(label, c) {
		return E('div', { 'style': 'display: flex; align-items: center; gap: 6px; white-space: nowrap' }, [
			E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: ' + TXT_MUTED + '; flex: 0 0 auto' }),
			E('span', { 'style': 'font-size: 12px; color: ' + TXT_MUTED }, label),
			E('strong', {
				'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG
			}, String(c.total)),
			E('span', { 'style': 'font-size: 11px; color: ' + TXT_MUTED }, ' 卸载 '),
			E('strong', {
				'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG
			}, String(c.npu))
		]);
	}

	var rows = [];

	if (conns.tcp)
		rows.push(row('TCP', conns.tcp));

	if (conns.udp)
		rows.push(row('UDP', conns.udp));

	return E('div', {
		'style': 'flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-radius: 6px; background: ' + TILE_BG
	}, rows);
}

/*
 * SFP optical module icon, drawn in the same visual language as the
 * luci-mod-status Ethernet port icons (icons/port_up.svg / port_down.svg):
 * 48x48 viewBox, metallic cage gradients, #888a85 outlines, round linecaps.
 * The optical interface is a single SC port (rectangular shell with the
 * ferrule in the middle) - XPON is bidirectional over one fiber, so the
 * green TX and blue RX beams both leave that one port. Up: link LED plus
 * both beams. Down: dimmed module, dark port and amber LOS ticks like
 * port_down. Inlined as a data URI so the view stays a single file.
 */
var PON_ICON_SVG_UP =
	'<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 48 48">' +
	'<defs>' +
	'<linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#ffffff"/><stop offset="1" stop-color="#d3d7cf"/>' +
	'</linearGradient>' +
	'<linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#d3d7cf"/><stop offset="1" stop-color="#babdb6"/>' +
	'</linearGradient>' +
	'</defs>' +
	'<rect x="8" y="30" width="32" height="10" rx="2.5" fill="url(#cg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<rect x="12" y="36.5" width="24" height="3.5" rx="1.75" fill="#888a85" opacity="0.3"/>' +
	'<rect x="15" y="11" width="18" height="20" rx="2" fill="url(#mg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<path d="M19.5 11.5v-2.5a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="#888a85" stroke-width="1.6" stroke-linecap="round"/>' +
	'<rect x="19" y="18" width="10" height="7.5" rx="1.5" fill="#ffffff" stroke="#888a85" stroke-width="1.2"/>' +
	'<rect x="21.5" y="20.2" width="5" height="3.1" rx="0.8" fill="#555753" opacity="0.55"/>' +
	'<circle cx="30" cy="14.8" r="1.2" fill="#4e9a06"/>' +
	'<path d="M20.5 25.8 17.2 40.5" stroke="#4e9a06" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
	'<path d="M27.5 25.8 30.8 40.5" stroke="#3465a4" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
	'</svg>';

var PON_ICON_SVG_DOWN =
	'<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 48 48">' +
	'<defs>' +
	'<linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#ffffff"/><stop offset="1" stop-color="#d3d7cf"/>' +
	'</linearGradient>' +
	'<linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#d3d7cf"/><stop offset="1" stop-color="#babdb6"/>' +
	'</linearGradient>' +
	'</defs>' +
	'<g opacity="0.72">' +
	'<rect x="8" y="30" width="32" height="10" rx="2.5" fill="url(#cg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<rect x="12" y="36.5" width="24" height="3.5" rx="1.75" fill="#888a85" opacity="0.45"/>' +
	'<rect x="15" y="11" width="18" height="20" rx="2" fill="url(#mg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<path d="M19.5 11.5v-2.5a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="#888a85" stroke-width="1.6" stroke-linecap="round"/>' +
	'<rect x="19" y="18" width="10" height="7.5" rx="1.5" fill="#888a85" stroke="#555753" stroke-width="1.2"/>' +
	'<rect x="21.5" y="20.2" width="5" height="3.1" rx="0.8" fill="#2e3436" opacity="0.6"/>' +
	'</g>' +
	'<path d="M20 41.8v3.2M24 41.8v3.2M28 41.8v3.2" stroke="#edd400" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
	'</svg>';

function ponIcon(up) {
	return E('img', {
		'src': 'data:image/svg+xml,' + encodeURIComponent(up ? PON_ICON_SVG_UP : PON_ICON_SVG_DOWN),
		'style': 'flex: 0 0 auto'
	});
}

function waveChip(dir, nm, color) {
	return E('div', {
		'style': 'display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 9px; font-size: 11px; white-space: nowrap; color: ' + TXT_STRONG + '; background: ' + TILE_BG
	}, [
		E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: ' + color + '; flex: 0 0 auto' }),
		dir + ' ' + nm + ' nm'
	]);
}

function fiberGraphic(mode, up) {
	var w = WAVELENGTHS[mode] || WAVELENGTHS['gpon'];

	return E('div', { 'style': 'flex: 0 0 auto; display: flex; align-items: center; gap: 10px' }, [
		ponIcon(up),
		E('div', { 'style': 'display: flex; flex-direction: column; gap: 5px' }, [
			waveChip('↑', w[0], '#4e9a06'),
			waveChip('↓', w[1], '#3465a4')
		])
	]);
}

function onuBadge(registration) {
	var code = (registration && typeof(registration.onu_state) == 'string')
		? registration.onu_state.toUpperCase() : '';
	var info = ONU_STATES[code];

	if (!info)
		return null;

	var tip = 'ONU 状态（ITU-T G.984.3 / G.987.3）';

	for (var k in ONU_STATES) {
		if (Object.prototype.hasOwnProperty.call(ONU_STATES, k))
			tip += '\n' + k + ' ' + ONU_STATES[k].zh + ' ' + ONU_STATES[k].en;
	}

	return E('span', {
		'style': 'flex: 0 0 auto; padding: 1px 9px; border-radius: 10px; font-size: 12px; white-space: nowrap; color: #ffffff; background: ' + BADGE_BG[info.severity],
		'title': tip
	}, code + ' ' + info.zh);
}

function renderBox(item) {
	var state = lineState(item.line);
	var onu = onuBadge(item.registration);

	return E('div', { 'class': 'ifacebox' }, [
		E('div', {
			'class': 'ifacebox-head center active',
			'style': 'display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0'
		}, [
			E('div', { 'style': 'display: flex; align-items: center; gap: 8px; min-width: 0' }, [
				E('strong', item.device),
				E('span', {
					'style': 'flex: 0 0 auto; padding: 1px 9px; border-radius: 10px; font-size: 12px; color: #ffffff; background: ' + BADGE_BG[state.severity]
				}, state.text)
			]),
			E('div', { 'style': 'display: flex; align-items: center; gap: 6px; flex: 0 0 auto' }, onu ? [ onu ] : [])
		]),
		E('div', { 'class': 'ifacebox-body left', 'style': 'display: flex; flex-direction: column; gap: 10px' }, [
			E('div', { 'style': 'display: flex; align-items: center; gap: 14px; flex-wrap: wrap' }, [
				fiberGraphic((item.line && item.line.active_mode) || '', state.severity == 'success'),
				E('div', { 'style': 'flex: 1 1 auto; display: flex; flex-wrap: wrap; gap: 8px; min-width: 0' }, [
					metricTile('接收光功率', item.frontend, 'rx_power_dbm', 'dBm', 2),
					metricTile('发射光功率', item.frontend, 'tx_power_dbm', 'dBm', 2),
					metricTile('光前端温度', item.frontend, 'temperature_celsius', '°C', 2),
					metricTile('光模块电流', item.frontend, 'tx_bias_ma', 'mA', 2),
					metricTile('电压', item.frontend, 'voltage_volts', 'V', 4)
				]),
				ratePanel(item.rate),
				connBlock(item.conns)
			])
		])
	]);
}

return baseclass.extend({
	title: 'PON 光模块',

	load: function() {
		return uci.load('pon').then(function() {
			var sections = uci.sections('pon', 'xpon').filter(function(section) {
				return section.device;
			});

			if (!sections.length)
				return Promise.reject();

			return Promise.all([
				readConns(),
				Promise.all(sections.map(function(section) {
					return Promise.all([
						readFrontend(section.device),
						readRate(section.device)
					]).then(function(res) {
						return {
							device: section.device,
							line: res[0] ? res[0].line : {},
							frontend: res[0] ? res[0].frontend : null,
							registration: res[0] ? res[0].registration : {},
						rate: res[1]
						};
					});
				}))
			]).then(function(res) {
				var conns = res[0];
				var items = res[1];

				if (!items.some(function(item) { return item.frontend != null }))
					return Promise.reject();

				items.forEach(function(item) { item.conns = conns; });

				return items;
			});
		});
	},

	render: function(data) {
		if (!data || !data.length)
			return null;

		return E('div', { 'class': 'network-status-table' }, data.map(renderBox));
	}
});
