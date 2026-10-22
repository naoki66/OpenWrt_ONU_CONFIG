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
				frontend: L.isObject(snapshot.frontend) ? snapshot.frontend : {}
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

function connCell(label, c) {
	return E('div', { 'style': 'display: flex; align-items: baseline; gap: 4px; white-space: nowrap' }, [
		E('span', { 'style': 'font-size: 12px; font-weight: 600; color: ' + TXT_MUTED }, label),
		E('strong', {
			'style': 'font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG
		}, String(c.total)),
		E('span', { 'style': 'font-size: 11px; color: ' + TXT_MUTED }, '卸载'),
		E('strong', {
			'style': 'font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + TXT_STRONG
		}, String(c.npu))
	]);
}

function connRow(conns) {
	var cells = [];

	if (conns && (conns.tcp || conns.udp)) {
		if (conns.tcp)
			cells.push(connCell('TCP', conns.tcp));

		if (conns.udp)
			cells.push(connCell('UDP', conns.udp));

		return E('div', { 'style': 'display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap' }, cells);
	}

	return E('div', { 'style': 'font-size: 12px; color: ' + TXT_MUTED }, '连接数不可用');
}

function fiberGraphic(mode) {
	var w = WAVELENGTHS[mode] || WAVELENGTHS['gpon'];
	var chip = 'flex: 0 0 auto; padding: 2px 10px; border-radius: 9px; font-size: 11px; white-space: nowrap; color: ' + TXT_STRONG;

	return E('div', { 'style': 'flex: 0 0 auto; display: flex; align-items: center; gap: 8px' }, [
		E('div', {
			'style': 'display: flex; flex-direction: column; justify-content: center; gap: 4px; width: 26px; height: 34px; padding: 0 6px; border-radius: 5px; background: ' + TILE_BG
		}, [
			E('span', { 'style': 'width: 6px; height: 6px; border-radius: 50%; background: ' + TXT_MUTED }),
			E('span', { 'style': 'width: 6px; height: 6px; border-radius: 50%; background: ' + TXT_MUTED })
		]),
		E('span', { 'style': 'font-size: 14px; color: ' + TXT_MUTED }, '→'),
		E('div', { 'style': 'display: flex; flex-direction: column; gap: 4px' }, [
			E('div', { 'style': chip + '; background: rgba(0, 150, 90, 0.14)' }, '↑ ' + w[0] + ' nm'),
			E('div', { 'style': chip + '; background: rgba(230, 160, 20, 0.16)' }, '↓ ' + w[1] + ' nm')
		])
	]);
}

function renderBox(item) {
	var state = lineState(item.line);

	return E('div', { 'class': 'ifacebox' }, [
		E('div', {
			'class': 'ifacebox-head center active',
			'style': 'display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0'
		}, [
			E('strong', item.device),
			E('span', {
				'style': 'flex: 0 0 auto; padding: 1px 9px; border-radius: 10px; font-size: 12px; color: #ffffff; background: ' + BADGE_BG[state.severity]
			}, state.text)
		]),
		E('div', { 'class': 'ifacebox-body left', 'style': 'display: flex; flex-direction: column; gap: 10px' }, [
			E('div', { 'style': 'display: flex; align-items: center; gap: 14px; flex-wrap: wrap' }, [
				fiberGraphic((item.line && item.line.active_mode) || ''),
				E('div', { 'style': 'flex: 1 1 auto; display: flex; flex-wrap: wrap; gap: 8px; min-width: 0' }, [
					metricTile('接收光功率', item.frontend, 'rx_power_dbm', 'dBm', 2),
					metricTile('发射光功率', item.frontend, 'tx_power_dbm', 'dBm', 2),
					metricTile('光前端温度', item.frontend, 'temperature_celsius', '°C', 2),
					metricTile('光模块电流', item.frontend, 'tx_bias_ma', 'mA', 2),
					metricTile('电压', item.frontend, 'voltage_volts', 'V', 4)
				]),
				ratePanel(item.rate)
			]),
			connRow(item.conns)
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
