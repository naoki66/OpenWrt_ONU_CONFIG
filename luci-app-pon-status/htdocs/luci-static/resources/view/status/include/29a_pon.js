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
 *
 * When no xpon section carries a device, the pon config is missing, or
 * ponctl is unavailable on every line, load() rejects and the overview page
 * hides the whole card - that is what keeps non-PON devices free of an empty
 * section.
 */

var PONCTL = '/usr/sbin/ponctl';

var prevRates = {};
var statsSource = null;

var callDeviceStatus = rpc.declare({
	object: 'network.device',
	method: 'status'
});

/*
 * Colors are never hardcoded on text: every value inherits the theme text
 * color (Argon: --text-color, light #525f7f / dark #ccc) and the heads use
 * the ifacebox-head pair (--iface-head-bg / --iface-head-text), exactly like
 * the network port cards in 29_ports.js. Secondary text is muted with
 * opacity instead of a fixed grey so it follows light/dark themes.
 */

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

/*
 * Port rate block: grey ifacebox-head strip, two rows for the upstream
 * and downstream rates. The ifacebox classes come from the theme
 * (luci-theme-argon cascade.css), so the block follows the light/dark
 * theme like the port status cards do.
 */
function ratePanel(rate) {
	var ok = (rate != null && !rate.error && rate.rx != null && rate.tx != null);

	function row(dir, arrow, value) {
		return E('div', { 'style': 'display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; white-space: nowrap' }, [
			E('span', { 'style': 'font-size: 13px; opacity: 0.6' }, arrow),
			E('span', { 'style': 'font-size: 12px; opacity: 0.6' }, dir),
			E('strong', {
				'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums'
			}, (value != null) ? value.toFixed(2) : '—'),
			E('span', { 'style': 'font-size: 10px; opacity: 0.6' }, 'Mibit/s')
		]);
	}

	return E('div', { 'class': 'ifacebox', 'style': 'flex: 0 0 auto; margin: 0' }, [
		E('div', {
			'class': 'ifacebox-head',
			'style': 'padding: 3px 10px; font-size: 12px; font-weight: 600'
		}, 'PON流量'),
		E('div', {
			'class': 'ifacebox-body',
			'style': 'display: flex; flex-direction: column; gap: 6px; padding: 6px 10px'
		}, [
			row('上行', '↑', ok ? rate.tx : null),
			row('下行', '↓', ok ? rate.rx : null)
		])
	]);
}

/*
 * Optical power diagnostic panel, drawn after the reference design: the
 * live reading with a severity pill above a zone scale carrying a marker
 * at the current value. Zone boundaries follow the ONU power budget:
 *   RX (dBm): < -29 fault | -29..-27 warning | -27..-8 normal
 *             (-22..-12 is the ideal band) | > -8 overload
 *   TX (dBm): < +0.5 below the window | +0.5..+5 good | > +5 overload
 */
var PWR_ZONE = {
	fault: '#f2b3b3',
	warn: '#f6d9a6',
	ok: '#bcd9a8',
	ideal: '#4e9a06',
	over: '#f2b3b3',
	good: '#79c47f'
};

var RX_ZONES = [
	{ from: -30, to: -29, color: PWR_ZONE.fault },
	{ from: -29, to: -27, color: PWR_ZONE.warn },
	{ from: -27, to: -22, color: PWR_ZONE.ok },
	{ from: -22, to: -12, color: PWR_ZONE.ideal },
	{ from: -12, to: -8, color: PWR_ZONE.ok },
	{ from: -8, to: -6, color: PWR_ZONE.over }
];
var RX_RANGE = { min: -30, max: -6 };
var RX_TICKS = [
	{ at: -30, label: '-30' },
	{ at: -25, label: '-25' },
	{ at: -12, label: '-12' },
	{ at: -8, label: '-8' }
];

var TX_ZONES = [
	{ from: 0, to: 0.5, color: PWR_ZONE.warn },
	{ from: 0.5, to: 5, color: PWR_ZONE.good },
	{ from: 5, to: 8, color: PWR_ZONE.over }
];
var TX_RANGE = { min: 0, max: 8 };
var TX_TICKS = [
	{ at: 0, label: '0' },
	{ at: 0.5, label: '+0.5' },
	{ at: 5, label: '+5' },
	{ at: 8, label: '+8' }
];

function powerStatus(kind, value, hasSignal) {
	if (!hasSignal)
		return { text: '无光', severity: 'muted' };

	if (value == null)
		return { text: '读取失败', severity: 'muted' };

	if (kind == 'rx') {
		if (value > -8)
			return { text: '饱和/过载', severity: 'error' };
		if (value >= -12)
			return { text: '正常', severity: 'success' };
		if (value >= -22)
			return { text: '理想良好', severity: 'success' };
		if (value >= -27)
			return { text: '正常', severity: 'success' };
		if (value >= -29)
			return { text: '临界预警', severity: 'warning' };
		return { text: '差/故障', severity: 'error' };
	}

	if (value > 5)
		return { text: '过载', severity: 'error' };
	if (value >= 0.5)
		return { text: '良好', severity: 'success' };
	if (value >= -5)
		return { text: '临界预警', severity: 'warning' };
	return { text: '差/故障', severity: 'error' };
}

function powerPanel(kind, title, frontend, field, zones, range, ticks, hasSignal) {
	var value = null;

	if (frontend != null && !frontend.error && Object.prototype.hasOwnProperty.call(frontend, field))
		value = Number(frontend[field]);

	var status = powerStatus(kind, value, hasSignal);
	var showMarker = (value != null && hasSignal);
	var pct = showMarker
		? Math.max(0, Math.min(100, (value - range.min) / (range.max - range.min) * 100))
		: null;

	function tickNode(t) {
		var p = (t.at - range.min) / (range.max - range.min) * 100;
		var shift = 'translateX(-50%)';

		if (p < 10)
			shift = 'translateX(0)';
		else if (p > 90)
			shift = 'translateX(-100%)';

		return E('span', {
			'style': 'position: absolute; bottom: 0; left: ' + p.toFixed(2) + '%; transform: ' + shift + '; font-size: 9px; line-height: 1; opacity: 0.65; white-space: nowrap'
		}, t.label);
	}

	/*
	 * The bar must override the theme rule
	 * .network-status-table .ifacebox-body > div { gap: .5rem;
	 * flex-wrap: wrap }, otherwise the zone segments come apart.
	 */
	var bar = E('div', { 'style': 'position: relative; height: 9px; border-radius: 4px; overflow: hidden; display: flex; flex-wrap: nowrap; gap: 0' },
		zones.map(function(z) {
			return E('div', { 'style': 'flex: ' + (z.to - z.from) + ' 1 0; background: ' + z.color });
		}));

	var marks = ticks.map(tickNode);

	if (pct != null)
		marks.push(E('span', {
			'style': 'position: absolute; bottom: 6px; left: ' + pct.toFixed(2) + '%; transform: translateX(-50%); font-size: 13px; line-height: 1; color: #3465a4',
			'title': value.toFixed(2) + ' dBm'
		}, '▲'));

	return E('div', { 'class': 'ifacebox', 'style': 'flex: 1 1 220px; min-width: 200px; margin: 0' }, [
		E('div', {
			'class': 'ifacebox-head',
			'style': 'padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis'
		}, title),
		E('div', {
			'class': 'ifacebox-body',
			'style': 'display: flex; flex-direction: column; gap: 5px; padding: 6px 10px'
		}, [
			E('div', { 'style': 'display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0' }, [
				E('strong', {
					'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap'
				}, (value != null) ? value.toFixed(2) + ' dBm' : '—'),
				E('span', {
					'style': 'flex: 0 0 auto; padding: 1px 9px; border-radius: 10px; font-size: 11px; white-space: nowrap; color: #ffffff; background: ' + BADGE_BG[status.severity]
				}, status.text)
			]),
			bar,
			E('div', { 'style': 'position: relative; height: 14px; flex-wrap: nowrap; gap: 0' }, marks)
		])
	]);
}
/*
 * Module supply voltage and TX bias current as one block, laid out like
 * the rate panel: voltage on the upper row, bias current on the lower row.
 */
function voltAmpPanel(frontend) {
	function row(label, field, unit, digits) {
		var value;

		if (frontend == null || frontend.error)
			value = '读取失败';
		else if (!Object.prototype.hasOwnProperty.call(frontend, field))
			value = '不支持';
		else
			value = Number(frontend[field]).toFixed(digits) + ' ' + unit;

		return E('div', { 'style': 'display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; white-space: nowrap' }, [
			E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.45; flex: 0 0 auto; align-self: center' }),
			E('span', { 'style': 'font-size: 12px; opacity: 0.6' }, label),
			E('strong', {
				'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums'
			}, value)
		]);
	}

	return E('div', { 'class': 'ifacebox', 'style': 'flex: 0 0 auto; margin: 0' }, [
		E('div', {
			'class': 'ifacebox-head',
			'style': 'display: flex; align-items: center; gap: 5px; padding: 3px 10px; font-size: 12px; font-weight: 600'
		}, [
			E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.45; flex: 0 0 auto' }),
			'模块电压/电流'
		]),
		E('div', {
			'class': 'ifacebox-body',
			'style': 'display: flex; flex-direction: column; gap: 6px; padding: 6px 10px'
		}, [
			row('电压', 'voltage_volts', 'V', 4),
			row('电流', 'tx_bias_ma', 'mA', 2)
		])
	]);
}

/*
 * Optical frontend temperature and the OMCI ONU lifecycle state as one
 * block: the temperature reading on the upper row, the colored O1-O7
 * badge (full state table as tooltip) on the lower row.
 */
function tempStatePanel(frontend, onu) {
	var value;

	if (frontend == null || frontend.error)
		value = '读取失败';
	else if (!Object.prototype.hasOwnProperty.call(frontend, 'temperature_celsius'))
		value = '不支持';
	else
		value = Number(frontend.temperature_celsius).toFixed(2) + ' °C';

	return E('div', { 'class': 'ifacebox', 'style': 'flex: 0 0 auto; margin: 0' }, [
		E('div', {
			'class': 'ifacebox-head',
			'style': 'display: flex; align-items: center; gap: 5px; padding: 3px 10px; font-size: 12px; font-weight: 600'
		}, [
			E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.45; flex: 0 0 auto' }),
			'温度/状态'
		]),
		E('div', {
			'class': 'ifacebox-body',
			'style': 'display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 6px 10px'
		}, [
			E('div', { 'style': 'font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap' }, value),
			onu ? onu : E('span', { 'style': 'font-size: 12px; opacity: 0.6' }, '状态未知')
		])
	]);
}

/*
 * PON optical module icon with a UPC SC connector, drawn in the same
 * visual language as the luci-mod-status Ethernet port icons
 * (icons/port_up.svg / port_down.svg): 48x48 viewBox rendered at a 40px
 * footprint, metallic cage gradients, #888a85 outlines, round linecaps.
 * UPC (Ultra Physical Contact) is the flat-polish, blue-coded ferrule
 * used by PON SC ports, so the connector carries the UPC blue; XPON is
 * bidirectional over one fiber, so the green TX and blue RX beams both
 * leave that one port. Up: link LED plus both beams. Down: dimmed
 * module, dark port and amber LOS ticks like port_down. Inlined as a
 * data URI so the view stays a single file.
 */
var PON_ICON_SVG_UP =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 48 48">' +
	'<defs>' +
	'<linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#ffffff"/><stop offset="1" stop-color="#d3d7cf"/>' +
	'</linearGradient>' +
	'<linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#d3d7cf"/><stop offset="1" stop-color="#babdb6"/>' +
	'</linearGradient>' +
	'</defs>' +
	'<rect x="6" y="27" width="36" height="14" rx="2.5" fill="url(#cg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<rect x="10" y="34" width="28" height="3.5" rx="1.75" fill="#888a85" opacity="0.3"/>' +
	'<rect x="12" y="7" width="24" height="22" rx="2" fill="url(#mg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<path d="M16 7.5V5a8 8 0 0 1 16 0v2.5" fill="none" stroke="#888a85" stroke-width="1.6" stroke-linecap="round"/>' +
	'<rect x="15.5" y="11.5" width="17" height="12" rx="2.5" fill="none" stroke="#0d76e0" stroke-width="1.6"/>' +
	'<rect x="17" y="13" width="13" height="9" rx="1.5" fill="#ffffff" stroke="#888a85" stroke-width="1.2"/>' +
	'<rect x="20" y="15.5" width="7" height="4" rx="1" fill="#0d76e0"/>' +
	'<circle cx="23.5" cy="17.5" r="0.9" fill="#cfe4f7"/>' +
	'<circle cx="33" cy="11" r="1.3" fill="#4e9a06"/>' +
	'<path d="M21 23 17.5 41" stroke="#4e9a06" stroke-width="2.8" stroke-linecap="round" fill="none"/>' +
	'<path d="M26 23 30.5 41" stroke="#3465a4" stroke-width="2.8" stroke-linecap="round" fill="none"/>' +
	'</svg>';

var PON_ICON_SVG_DOWN =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 48 48">' +
	'<defs>' +
	'<linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#ffffff"/><stop offset="1" stop-color="#d3d7cf"/>' +
	'</linearGradient>' +
	'<linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
	'<stop stop-color="#d3d7cf"/><stop offset="1" stop-color="#babdb6"/>' +
	'</linearGradient>' +
	'</defs>' +
	'<g opacity="0.72">' +
	'<rect x="6" y="27" width="36" height="14" rx="2.5" fill="url(#cg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<rect x="10" y="34" width="28" height="3.5" rx="1.75" fill="#888a85" opacity="0.45"/>' +
	'<rect x="12" y="7" width="24" height="22" rx="2" fill="url(#mg)" stroke="#888a85" stroke-width="1.4"/>' +
	'<path d="M16 7.5V5a8 8 0 0 1 16 0v2.5" fill="none" stroke="#888a85" stroke-width="1.6" stroke-linecap="round"/>' +
	'<rect x="15.5" y="11.5" width="17" height="12" rx="2.5" fill="none" stroke="#8a8a8a" stroke-width="1.4"/>' +
	'<rect x="17" y="13" width="13" height="9" rx="1.5" fill="#888a85" stroke="#555753" stroke-width="1.2"/>' +
	'<rect x="20" y="15.5" width="7" height="4" rx="1" fill="#2e3436" opacity="0.6"/>' +
	'<circle cx="33" cy="11" r="1.3" fill="#8a8a8a"/>' +
	'</g>' +
	'<path d="M18 42v3M24 42v3M30 42v3" stroke="#edd400" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
	'</svg>';

function ponIcon(up) {
	return E('img', {
		'src': 'data:image/svg+xml,' + encodeURIComponent(up ? PON_ICON_SVG_UP : PON_ICON_SVG_DOWN),
		'style': 'flex: 0 0 auto'
	});
}

/*
 * The optics figure: the PON module icon with the lifecycle badge
 * underneath it. The wavelengths live in the power panel titles, so no
 * separate chips are drawn here.
 */
function fiberGraphic(up, state) {
	return E('div', { 'style': 'flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 6px' }, [
		ponIcon(up),
		E('span', {
			'style': 'flex: 0 0 auto; padding: 1px 9px; border-radius: 10px; font-size: 12px; white-space: nowrap; color: #ffffff; background: ' + BADGE_BG[state.severity]
		}, state.text)
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

/*
 * The card carries no head strip: the device name and the colored title
 * bar were dropped, so the body row starts directly with the optics
 * figure. The ifacebox wrapper still provides the panel background and
 * border from the theme.
 */
function renderBox(item) {
	var state = lineState(item.line);
	var onu = onuBadge(item.registration);
	var w = WAVELENGTHS[(item.line && item.line.active_mode) || ''] || WAVELENGTHS['gpon'];
	var hasSignal = !(item.line && item.line.optical_signal === false);

	return E('div', { 'class': 'ifacebox' }, [
		E('div', { 'class': 'ifacebox-body left', 'style': 'display: flex; flex-direction: column; gap: 10px' }, [
			E('div', { 'style': 'display: flex; align-items: stretch; gap: 14px; flex-wrap: wrap' }, [
				fiberGraphic(state.severity == 'success', state),
				powerPanel('rx', '收光功率 Rx · ' + w[1] + ' nm', item.frontend, 'rx_power_dbm', RX_ZONES, RX_RANGE, RX_TICKS, hasSignal),
				powerPanel('tx', '发光功率 Tx · ' + w[0] + ' nm', item.frontend, 'tx_power_dbm', TX_ZONES, TX_RANGE, TX_TICKS, hasSignal),
				tempStatePanel(item.frontend, onu),
				voltAmpPanel(item.frontend),
				ratePanel(item.rate)
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

			return Promise.all(sections.map(function(section) {
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
			})).then(function(items) {
				if (!items.some(function(item) { return item.frontend != null }))
					return Promise.reject();

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
