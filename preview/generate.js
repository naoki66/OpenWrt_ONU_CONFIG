/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline preview generator for the PON views.
 *
 * It loads the real view sources, runs their render() with stubbed LuCI globals
 * and serialises the resulting DOM into static HTML, so the preview shows the
 * exact markup the views produce. The form half of the identity page is an
 * approximation because form.js itself is not available here.
 *
 * Usage: node preview/generate.js   ->  writes preview/index.html
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VIEW_DIR = path.join(__dirname, '..', 'luci-app-pon', 'htdocs', 'luci-static', 'resources', 'view', 'pon');

const VOID_TAGS = [ 'input', 'br', 'img', 'link', 'hr' ];
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
	return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function attrsToString(attrs) {
	if (!attrs)
		return '';
	return Object.keys(attrs).map((key) => {
		const value = attrs[key];

		if (value == null || value === false)
			return '';
		if (value === true)
			return ' ' + key;

		return ' ' + key + '="' + esc(value) + '"';
	}).join('');
}

/* Mimics LuCI's E() helper: returns an object so nested nodes are not escaped. */
function E(tag, attrs, children) {
	if (Array.isArray(attrs) || attrs == null ||
	    typeof attrs === 'string' || typeof attrs === 'number') {
		children = attrs;
		attrs = {};
	}

	const parts = [];
	const push = (item) => {
		if (item == null || item === false || item === true)
			return;
		if (Array.isArray(item)) {
			item.forEach(push);
			return;
		}
		parts.push(typeof item === 'object' ? item.html : esc(item));
	};

	push(children);

	/* E([], ...) is LuCI's document fragment. */
	if (Array.isArray(tag))
		return { html: parts.join('') };

	if (VOID_TAGS.indexOf(tag) !== -1)
		return { html: '<' + tag + attrsToString(attrs) + ' />' };

	return { html: '<' + tag + attrsToString(attrs) + '>' + parts.join('') + '</' + tag + '>' };
}

global.E = E;

String.prototype.format = function() {
	const args = arguments;
	let i = 0;
	return this.replace(/%[sdf]/g, () => String(args[i++]));
};

global._ = (s) => s;
global.document = { head: { appendChild() {} }, querySelector() { return null; } };
global.L = {
	resource: (p) => '/luci-static/resources/' + p,
	env: { base_url: '/luci-static/resources' },
	resolveDefault: (p, fallback) => Promise.resolve(p).catch(() => fallback),
	bind: (fn, ctx) => fn.bind(ctx),
	hasViewPermission: () => true
};
global.poll = { add() {} };
global.dom = { content() {}, callClassMethod() { return Promise.resolve(); } };
global.ui = {
	addNotification() {},
	createHandlerFn() { return null; }
};

/* ------------------------------------------------------------------ data -- */

const uciData = {
	pon: {
		pon: { '.type': 'xpon', '.name': 'pon', device: 'eth1', mode: 'xgspon' },
		pon2: { '.type': 'xpon', '.name': 'pon2', device: 'eth2', mode: 'epon-10g-1g' },
		omci0: { '.type': 'omci', '.name': 'omci0', line: 'pon', device: 'pon0',
			loid: 'user@operator', vendor_id: 'GMTK', equipment_id: 'XG2010G',
			hardware_version: 'HW1.0', software_version: 'SW2.1', operator_id: 'CTC' },
		oam0: { '.type': 'oam', '.name': 'oam0', line: 'pon2', device: 'pon1',
			operator: 'ctc', vendor_id: 'GMTK', model: 'XR17', equipment_id: 'XR1710G',
			hardware_version: 'HW1', software_version: 'SW2', firmware_version: '1.2.3',
			chipset_id: 'a1b2c3d4e5f60718', ge_ports: '4' }
	},
	iptv: {
		config: { '.type': 'iptv', '.name': 'config', enabled: '1', lan_port: 'lan4',
			uplink: 'pon0', service_vlan: '43', multicast_vlan: '40' }
	}
};

global.uci = {
	load() { return Promise.resolve(); },
	get(config, sid, option) {
		const section = uciData[config] && uciData[config][sid];
		return section ? section[option] : undefined;
	},
	sections(config, type) {
		return Object.keys(uciData[config] || {})
			.map((key) => uciData[config][key])
			.filter((section) => section['.type'] === type);
	}
};

const statusData = {
	lines: [
		{
			section: uciData.pon.pon,
			line: { lifecycle: 'operational', optical_signal: true, phy_ready: true,
				xgtc_sync: 'in-sync', active_mode: 'xgspon', configured_mode: 'xgspon' },
			frontend: { rx_power_dbm: -21.42, tx_power_dbm: 2.81, temperature_celsius: 41.25,
				calibration: 'ready', tx_gate_enabled: true },
			registration: { onu_state: 'O5', onu_id: 12, onu_id_valid: true, upstream_tx_armed: true },
			datapath: { data_path_configured: true, service_ready: true },
			counters: { rx_start_count: 4, sync_losses: 1, recoveries: 1, full_reinitializations: 0,
				xgtc_rx: 1287345, ploamd_rx: 8821, xgem_rx: 99231, upstream_bursts_tx: 412233,
				ploamu_tx: 8821, xgem_tx: 77120, last_start_error: '-' }
		},
		{
			section: uciData.pon.pon2,
			line: { lifecycle: 'wait-line-sync', optical_signal: false, pcs_sync: false,
				configured_mode: 'epon-10g-1g', mode_pending: true, last_start_error: 'no-signal' },
			frontend: { rx_power_dbm: -28.9, tx_power_dbm: 3.1, temperature_celsius: 44.0,
				calibration: 'missing', tx_gate_enabled: false },
			registration: { mpcp_state: 'wait', llid_valid: false, upstream_tx_armed: false },
			datapath: { data_path_configured: false },
			counters: { rx_start_count: 2, sync_losses: 0, recoveries: 0, discovery_gates: 0,
				register_requests: 0, mpcp_timeouts: 3 }
		}
	],
	omci: [ {
		section: uciData.pon.omci0,
		values: { channel_available: true, loid_configured: true, authentication_meaning: 'accepted',
			backend_state: 'applied', active_alloc_id: 1024, active_gem_id: 5,
			olt_vendor_id: 'HWTC', olt_equipment_id: 'MA5800', olt_version: 'V100R021',
			vlan_ids: [ 41, 45 ], multicast_vlan_ids: [ 4001 ],
			igmp_upstream_vlan_ids: [ 41 ], enhanced_security: true,
			broadcast_key_indexes: [ 0, 1 ], rx_messages: 4211, parse_errors: 0 }
	} ],
	oam: [ {
		section: uciData.pon.oam0,
		values: { channel_available: false, ieee_discovery_completed: false, operator: 'ctc',
			ctc_discovery_state: 'passive-wait', ctc_version: 0x21,
			authentication_status: 'not-reported', vlan_mode: 1, vlan_ids: [ 41 ],
			rx_messages: 0, parse_errors: 0 }
	} ]
};

const identityLayout = {
	targets: {
		factory: {
			fields: {
				pon_sn: { kind: 'pon-sn', offset: 210, size: 12, encoding: 'pon-ascii12' },
				pon_mac: { kind: 'mac', offset: 108, size: 17, encoding: 'mac-colon17' }
			}
		},
		ri: {
			fields: {
				board_mac: { kind: 'mac', offset: 62, size: 6, encoding: 'mac-binary6' }
			}
		}
	}
};

const identityValues = {
	factory: { pon_sn: 'GMTK12345678', pon_mac: '00:11:22:33:44:55' },
	ri: { board_mac: '001122334455' }
};

/* What `airoha-pon-data list` reports for the calibration image targets. */
/* What `network.getDevices()` would report for the IPTV page. */
const networkDevices = [ 'br-lan', 'lan1', 'lan2', 'lan3', 'lan4', 'pon0', 'pon1' ]
	.map((name) => ({ getName: () => name }));

global.network = { getDevices() { return Promise.resolve(networkDevices); } };

const storageData = {
	factory: { type: 'mtd', size: 131072 },
	ri: { type: 'mtd', size: 65536 }
};

global.fs = {
	exec(cmd, args) {
		if (cmd.indexOf('airoha-pon-data') !== -1) {
			if (args[0] === 'list')
				return Promise.resolve({ code: 0, stdout: JSON.stringify(storageData) });

			return Promise.resolve({ code: 0, stdout: 'Backup: /tmp/pon-board-data.1234.bin' });
		}

		if (args[0] === 'list')
			return Promise.resolve({ code: 0, stdout: JSON.stringify(identityLayout) });
		if (args[0] === 'read')
			return Promise.resolve({ code: 0, stdout: identityValues[args[1]][args[2]] });
		return Promise.resolve({ code: 0, stdout: 'Backup: /tmp/x.bin' });
	},
	exec_direct() { return Promise.resolve(null); }
};

/* ------------------------------------------------------- form.js stand-in -- */

/*
 * LuCI's form.js is not available offline, so the form half of the pages is
 * rebuilt from the recorded sections and options. Structure mirrors what
 * form.js emits (cbi-map > cbi-section > cbi-section-node > cbi-value).
 */
function renderFakeForm(map) {
	const nodes = map.sections.map((section) => {
		const entries = uci.sections(map.name, section.type)
			.filter((candidate) => !section.filter || section.filter(candidate['.name']));

		if (!entries.length)
			return '';

		return entries.map((entry) => E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, section.title + ' · ' + entry['.name']),
			E('div', { 'class': 'cbi-section-descr' }, section.descr),
			E('div', { 'class': 'cbi-section-node' }, section.options.map((option) => {
				const value = entry[option.name] != null ? entry[option.name] : '';
				let field;

				if (option.type === 'DummyValue')
					field = E('div', { 'class': 'cbi-value-field' },
						String(option.cfgvalue ? option.cfgvalue(entry['.name']) : (value || '-')));
				else if (option.choices)
					field = E('div', { 'class': 'cbi-value-field' },
						E('select', { 'class': 'cbi-input-select' }, option.choices.map(
							(choice) => E('option', { 'value': choice.key,
								'selected': choice.key === value || null }, choice.label))));
				else
					field = E('div', { 'class': 'cbi-value-field' },
						E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': value }));

				return E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, option.label),
					field
				]);
			}))
		])).map((node) => node.html).join('');
	}).join('');

	return E('div', { 'class': 'cbi-map' }, [
		E('h2', {}, map.title),
		E('div', { 'class': 'cbi-map-descr' }, map.descr),
		{ html: nodes },
		E('div', { 'class': 'cbi-page-actions' }, [
			E('button', { 'class': 'cbi-button cbi-button-action' }, 'Save'),
			E('button', { 'class': 'cbi-button cbi-button-action' }, 'Save & Apply')
		])
	]);
}

class FakeSection {
	constructor(name, type, title, descr) {
		this.name = name;
		this.type = type;
		this.title = title;
		this.descr = descr;
		this.options = [];
	}
	option(type, name, label) {
		const option = {
			type: type,
			name: name,
			label: label,
			value(key, label) {
				this.choices = this.choices || [];
				this.choices.push({ key: key, label: label != null ? label : key });
				return this;
			},
			depends() { return this; }
		};
		this.options.push(option);
		return option;
	}
	tab() {}
	taboption(tab, type, name, label) { return this.option(type, name, label); }
}

class FakeNamedSection extends FakeSection {}

global.form = {
	Map: class {
		constructor(name, title, descr) {
			this.name = name;
			this.title = title;
			this.descr = descr;
			this.sections = [];
		}
		chain() { return Promise.resolve(); }
		/*
		 * The two section classes take different argument shapes:
		 * TypedSection(type, title, descr) vs NamedSection(section, sectiontype, title, descr).
		 */
		section(SectionClass, a, b, c, d) {
			const section = SectionClass === FakeNamedSection
				? new FakeSection(a, b, c, d)
				: new FakeSection(a, a, b, c);
			this.sections.push(section);
			return section;
		}
		render() { return Promise.resolve(renderFakeForm(this)); }
	},
	TypedSection: FakeSection,
	NamedSection: FakeNamedSection,
	Value: 'Value',
	DummyValue: 'DummyValue',
	ListValue: 'ListValue',
	Flag: 'Flag'
};

global.view = { extend(o) { return o; } };

/* ------------------------------------------------------------- rendering -- */

function loadView(file) {
	const source = fs.readFileSync(path.join(VIEW_DIR, file), 'utf8');
	return new Function(source)();
}

const html = (node) => (node && node.html ? node.html : String(node == null ? '' : node));

(async () => {
	const statusView = loadView('status.js');
	const hardwareView = loadView('hardware.js');
	const configView = loadView('config.js');
	const iptvView = loadView('iptv.js');
	const voiceView = loadView('voice.js');

	const statusHtml = html(statusView.render(statusData));
	const configHtml = html(await configView.render());
	const voiceHtml = html(voiceView.render());

	const iptvDevices = await iptvView.load();
	const iptvHtml = html(await iptvView.render(iptvDevices));

	const state = await new Promise((resolve) => {
		hardwareView.load().then(resolve);
	});
	const hardwareHtml = html(await hardwareView.render(state));

	const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>luci-app-pon preview</title>
<link rel="stylesheet" href="argon.css" />
<link rel="stylesheet" href="pon.css" />
<style>
	.preview-tabs { display: flex; gap: .5rem; padding: 1rem; }
	.preview-tabs > button {
		padding: .5rem 1rem; border: 1px solid var(--border-color, #dee2e6);
		border-radius: .375rem; background: #fff; cursor: pointer;
		font-family: inherit; font-size: .875rem; color: #32325d;
	}
	.preview-tabs > button[aria-selected="true"] {
		background: var(--primary, #5e72e4); color: #fff; border-color: var(--primary, #5e72e4);
	}
	.preview-note {
		margin: 0; padding: .75rem 1rem; font-size: .75rem;
		color: var(--text-secondary, #8898aa); background: #fff;
		border-bottom: 1px solid var(--border-color, #dee2e6);
	}
	.preview-panel[hidden] { display: none; }
	.preview-body { padding: 1rem; }
</style>
</head>
<body>
<p class="preview-note">
	静态预览：使用真实的 status.js / hardware.js / config.js / iptv.js / voice.js 渲染逻辑在
	Node 中生成，样式取自 luci-theme-argon（argon.css）与 luci-app-pon 的 pon.css。状态页输出为真实标记；身份页的表单部分由 form.js 的
	近似替身生成，字段与分组与代码一致。
</p>
<div class="preview-tabs" role="tablist">
	<button role="tab" aria-selected="true" data-panel="status">状态</button>
	<button role="tab" aria-selected="false" data-panel="hardware">硬件身份</button>
	<button role="tab" aria-selected="false" data-panel="config">配置认证</button>
	<button role="tab" aria-selected="false" data-panel="iptv">IPTV</button>
	<button role="tab" aria-selected="false" data-panel="voice">语音配置</button>
</div>
<main>
	<div class="preview-body">
		<div class="preview-panel" id="panel-status">${statusHtml}</div>
		<div class="preview-panel" id="panel-hardware" hidden>${hardwareHtml}</div>
		<div class="preview-panel" id="panel-config" hidden>${configHtml}</div>
		<div class="preview-panel" id="panel-iptv" hidden>${iptvHtml}</div>
		<div class="preview-panel" id="panel-voice" hidden>${voiceHtml}</div>
	</div>
</main>
<script>
	document.querySelectorAll('.preview-tabs > button').forEach(function(button) {
		button.addEventListener('click', function() {
			document.querySelectorAll('.preview-tabs > button').forEach(function(other) {
				other.setAttribute('aria-selected', String(other === button));
			});
			document.querySelectorAll('.preview-panel').forEach(function(panel) {
				panel.hidden = panel.id !== 'panel-' + button.dataset.panel;
			});
		});
	});
</script>
</body>
</html>
`;

	fs.writeFileSync(path.join(__dirname, 'index.html'), page);

	/*
	 * pon.css is copied next to the preview so a fresh clone renders without
	 * manual steps. argon.css stays a manual download (see .gitignore).
	 */
	fs.copyFileSync(
		path.join(VIEW_DIR, 'pon.css'),
		path.join(__dirname, 'pon.css'));

	console.log('preview/index.html written (' + page.length + ' bytes)');
})();
