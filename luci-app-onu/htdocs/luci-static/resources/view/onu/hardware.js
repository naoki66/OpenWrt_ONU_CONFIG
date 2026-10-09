// SPDX-License-Identifier: Apache-2.0

'use strict';
'require dom';
'require form';
'require fs';
'require uci';
'require ui';
'require view';

var STYLESHEET = 'view/onu/onu.css';

/*
 * A backup leaves the device the way the diagnostic package does: the helper
 * writes the image to a fixed path in /tmp and the browser downloads it from
 * there, so the image never travels as a value the page has to hold.
 */
var BACKUP = '/tmp/pon-board-backup.bin';

/*
 * pon_data declares a single partition on every board seen so far, so the
 * picker is only built when there really is more than one target. The handlers
 * look it up by id instead of holding the node: a re-render replaces it.
 */
var TARGET_SELECT_ID = 'pon-board-data-target';

function downloadBackup(targetId) {
	return fs.read_direct(BACKUP, 'blob').then(function(blob) {
		var url = window.URL.createObjectURL(blob);
		var link = document.createElement('a');
		var stamp = new Date().toISOString().replace(/[:.]/g, '-');

		link.style.display = 'none';
		link.href = url;
		link.download = 'pon-board-' + targetId + '-' + stamp + '.bin';
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(url);
	});
}

var boardLabels = {
	pon_sn: _('PON serial number'),
	device_sn: _('Device serial number'),
	pon_mac: _('PON MAC address'),
	board_mac: _('Board MAC address'),
	lan_base_mac: _('LAN0 MAC address')
};

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

function validateSerialNumber(sectionId, value) {
	if (value == null || value === '')
		return true;

	if (/^[0-9a-fA-F]{16}$/.test(value) ||
	    /^[A-Za-z0-9]{4}[0-9a-fA-F]{8}$/.test(value))
		return true;

	return _('Use 16 hexadecimal digits or VEND followed by 8 hexadecimal digits.');
}

/*
 * Every line reports its identity through the one storage target that holds the
 * board image, so the target does not depend on the section being rendered. The
 * identity layout is consulted first because it is the side that owns the
 * pon_sn field; the storage list is the fallback for a board that only declares
 * pon_data.
 */
function boardTarget(identity, storages) {
	var names = Object.keys((identity || {}).layout
		? (identity.layout.targets || {}) : {});

	if (!names.length && identity)
		names = Object.keys(identity.targets || {});

	if (!names.length)
		names = (storages || []).map(function(storage) {
			return storage.id;
		});

	return names.length ? names[0] : null;
}

/* The burned serial is one field of that image, read on demand. */
function readBoardSerial(target) {
	if (!target)
		return Promise.resolve(null);

	return runIdentity([ 'read', target, 'pon_sn' ]).then(function(value) {
		return value || null;
	}).catch(function() {
		return null;
	});
}

function isEponMode(mode) {
	return (mode || '').indexOf('epon-') === 0;
}

function sectionUsesEpon(sectionId) {
	var line = uci.get('pon', sectionId, 'line');

	return isEponMode(uci.get('pon', line, 'mode'));
}

/*
 * The OMCI and EPON OAM identity blocks are both registered on the map, but only
 * one matches the selected line mode. The section filter already drops the inner
 * fields of the irrelevant block, yet LuCI still renders its card with the
 * "no configuration available" placeholder. Hide the whole card so the user
 * never sees the empty block; visibility tracks the Line mode dropdown.
 */
function modeSectionCard(node, name) {
	var card = node.querySelector('#cbi-pon-' + name) ||
		node.querySelector('[id^="cbi-pon-' + name + '"]');

	return card ? (card.closest('.cbi-section') || card) : null;
}

function toggleModeSections(node, modeOption) {
	var omci = modeSectionCard(node, 'omci');
	var oam = modeSectionCard(node, 'oam');

	function readMode() {
		/* 1) Live <select> inside the rendered map: tracks the dropdown
		      immediately, on first render and after a change. Search the map
		      root directly instead of modeOption.node, which is not reliably
		      populated in every LuCI build. */
		var sels = node.querySelectorAll('select');
		for (var i = 0; i < sels.length; i++) {
			if ((sels[i].id || '').indexOf('mode') !== -1 && sels[i].value)
				return sels[i].value;
		}

		/* 2) Saved UCI value, read exactly like the section filter
		      (sectionUsesEpon) does, so the post-apply state is always right
		      even if the option node is not resolvable. */
		var lines = uci.sections('pon', 'xpon') || [];
		for (var j = 0; j < lines.length; j++) {
			var sid = lines[j].name || lines[j]['.name'] || lines[j].sid;
			var m = uci.get('pon', sid, 'mode');

			if (m)
				return m;
		}

		if (modeOption && modeOption.sid) {
			try {
				var v = modeOption.formvalue(modeOption.sid);

				if (v)
					return v;
			} catch (e) {}
		}

		return null;
	}

	function update() {
		var epon = isEponMode(readMode());

		if (omci)
			omci.classList[epon ? 'add' : 'remove']('hidden');

		if (oam)
			oam.classList[epon ? 'remove' : 'add']('hidden');
	}

	if (modeOption)
		modeOption.onchange = update;

	/* Attach directly to the mode <select> as a backup trigger. */
	var sels = node.querySelectorAll('select');
	for (var k = 0; k < sels.length; k++) {
		if ((sels[k].id || '').indexOf('mode') !== -1) {
			sels[k].addEventListener('change', update);
			sels[k].addEventListener('input', update);
			break;
		}
	}

	update();
}

/* Printable ASCII keeps JavaScript character counts equal to wire byte counts. */
function validatePrintableAscii(value, minimum, maximum) {
	if (value == null || value === '')
		return true;

	if (!/^[\x20-\x7e]+$/.test(value))
		return _('Only printable ASCII characters are allowed.');

	if (value.length < minimum || value.length > maximum) {
		if (minimum === maximum)
			return _('The value must contain exactly %d bytes.').format(maximum);

		return _('The value must contain between %d and %d bytes.')
			.format(minimum, maximum);
	}

	return true;
}

function asciiLength(minimum, maximum) {
	return function(sectionId, value) {
		return validatePrintableAscii(value, minimum, maximum);
	};
}

function validateChipsetId(sectionId, value) {
	if (value == null || value === '' || /^[0-9a-fA-F]{16}$/.test(value))
		return true;

	return _('Use 16 hexadecimal digits.');
}

function validateBoardField(field, value) {
	if (value == null || value === '')
		return true;

	if (field.kind == 'mac')
		return /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value) ||
			/^[0-9a-fA-F]{12}$/.test(value) ? true :
			_('Enter a MAC address such as 00:11:22:33:44:55.');

	if (field.kind == 'pon-sn')
		return /^[0-9a-fA-F]{16}$/.test(value) ||
			/^[A-Za-z0-9]{4}[0-9a-fA-F]{8}$/.test(value) ? true :
			_('Use 16 hexadecimal digits or VEND followed by 8 hexadecimal digits.');

	return /^[\x20-\x7e]+$/.test(value) ? true :
		_('Only printable ASCII characters are allowed.');
}

function formatStorageSize(bytes) {
	var units = [ 'B', 'KiB', 'MiB', 'GiB' ];
	var size = Number(bytes);
	var unit = 0;

	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}

	return '%s %s'.format(size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1), units[unit]);
}

function parseStorageList(output) {
	var targets = JSON.parse(output);

	return Object.keys(targets).map(function(name) {
		var target = targets[name];
		return {
			id: name,
			label: '%s · %s · %s'.format(
				name, target.type.toUpperCase(), formatStorageSize(target.size))
		};
	});
}

function runIdentity(args) {
	return fs.exec('/usr/libexec/pon-board-identity', args).then(function(result) {
		if (result.code != 0)
			throw new Error(result.stderr || result.stdout || _('Board identity operation failed.'));
		return result.stdout.trim();
	});
}

/*
 * One unreadable field must not make the whole board identity disappear: the
 * fields live in the same flash image and are read one by one, so a single
 * failure used to reject the whole sequence and leave the page with no
 * identity section at all. Each read is settled on its own and a field that
 * cannot be read is reported as null, which renders as an empty input.
 */
function loadIdentity() {
	return runIdentity([ 'list' ]).then(function(output) {
		var layout = JSON.parse(output);
		var data = {};
		var sequence = Promise.resolve();

		Object.keys(layout.targets || {}).forEach(function(target) {
			data[target] = {};
			Object.keys(layout.targets[target].fields || {}).forEach(function(field) {
				sequence = sequence.then(function() {
					return runIdentity([ 'read', target, field ]).then(function(value) {
						data[target][field] = value;
					}).catch(function() {
						data[target][field] = null;
					});
				});
			});
		});

		return sequence.then(function() {
			return { layout: layout, data: data };
		});
	}).catch(function() {
		/* The board does not expose writable identity fields. */
		return null;
	});
}

function loadStorages() {
	return fs.exec('/usr/libexec/airoha-pon-data', [ 'list' ]).then(function(result) {
		if (result.code != 0)
			throw new Error(result.stderr || result.stdout || _('Unable to list storage.'));

		return parseStorageList(result.stdout);
	}).catch(function() {
		return [];
	});
}

/*
 * Identity fields and the calibration image are two views of the same flash
 * image: pon-board-identity patches fields in place, airoha-pon-data replaces
 * the whole target. Both address their storage through board.json's pon_data,
 * so the two are merged into one list of targets, each carrying the identity
 * fields it has (if any) and the action that rewrites it.
 */
function mergeTargets(identity, storages) {
	var byId = {};
	var order = [];

	storages.forEach(function(storage) {
		byId[storage.id] = { id: storage.id, label: storage.label, fields: null };
		order.push(storage.id);
	});

	Object.keys((identity && identity.layout.targets) || {}).forEach(function(name) {
		if (!byId[name]) {
			byId[name] = { id: name, label: name, fields: null };
			order.push(name);
		}

		byId[name].fields = identity.layout.targets[name].fields || {};
	});

	return order.map(function(id) {
		return byId[id];
	});
}

/*
 * pon-board-identity resolves its target through board.json's pon_data as
 * well, so a target it reports is always a valid airoha-pon-data target too.
 * That keeps the file upload available when airoha-pon-data list fails.
 */
function firstIdentityTarget(identity) {
	var names = Object.keys((identity && identity.layout && identity.layout.targets) || {});

	return names.length ? { id: names[0], label: names[0] } : null;
}

/*
 * Read one board identity input exactly as the page shows it. Current LuCI
 * builds return an ui.AbstractElement from getUIElement() (value via
 * getValue()). The raw DOM is the fallback: ui.Textfield renders
 * <div id="<cbid>"><input id="widget.<cbid>"></div>, and older builds put the
 * cbid straight on the input.
 */
function identityFieldValue(option) {
	var node = option && option.getUIElement ? option.getUIElement('board') : null;
	var cbid, frame, input;

	if (node) {
		if (typeof node.getValue === 'function') {
			var widgetValue = node.getValue();

			return widgetValue == null ? null : String(widgetValue).trim();
		}

		if (node.value != null)
			return String(node.value).trim();
	}

	if (!option || typeof option.cbid !== 'function')
		return null;

	cbid = option.cbid('board');
	frame = document.getElementById(cbid);
	input = frame
		? (frame.tagName === 'INPUT' ? frame : frame.querySelector('input'))
		: document.getElementById('widget.' + cbid);

	return input && input.value != null ? String(input.value).trim() : null;
}

/*
 * Push a freshly read flash value back into the rendered input. The identity
 * fields are patched straight into the flash image instead of going through
 * UCI, so CBIMap.save() re-rendering the form does not refresh them; without
 * this the page keeps displaying the pre-write value until a full reload.
 */
function setIdentityFieldValue(option, value) {
	var node = option && option.getUIElement ? option.getUIElement('board') : null;
	var cbid, frame, input;

	value = value || '';

	if (node && typeof node.setValue === 'function') {
		node.setValue(value);
		return;
	}

	if (!option || typeof option.cbid !== 'function')
		return;

	cbid = option.cbid('board');
	frame = document.getElementById(cbid);
	input = frame
		? (frame.tagName === 'INPUT' ? frame : frame.querySelector('input'))
		: document.getElementById('widget.' + cbid);

	if (input)
		input.value = value;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('pon'),
			L.resolveDefault(loadIdentity(), null),
			L.resolveDefault(loadStorages(), [])
		]).then(function(results) {
			var identity = results[1];
			var storageList = results[2];
			var target = boardTarget(identity, storageList);

			/*
			 * The burned serial is shown next to the UCI override so a mismatch
			 * is visible at a glance; it is read here because a form option can
			 * only render a value, not wait for one.
			 */
			return L.resolveDefault(readBoardSerial(target), null).then(function(serial) {
				return {
					identity: identity,
					storages: storageList,
					boardSerial: target ? serial : null,
					boardTarget: target
				};
			});
		});
	},

	render: function(state) {
		var identity = (state || {}).identity;
		var storages = (state || {}).storages || [];
		var m, s, o, modeOption;
		var readonly = !L.hasViewPermission();

		this.readonly = readonly;
		this.boardTarget = state.boardTarget || null;
		ensureStylesheet();

		/*
		 * One page for everything that identifies this unit on the board and
		 * towards the OLT: the board identity and the calibration image stored
		 * in flash, plus the ONU identity sent over the wire. The protocol
		 * half is split by line mode because EPON reports it over OAM while
		 * GPON, XG-PON and XGS-PON report it over OMCI.
		 */
		m = new form.Map('pon', _('ONU Hardware identity'),
			_('Board identity and calibration data stored in flash, and the ONU identity reported to the OLT.'));
		m.readonly = readonly;

		/*
		 * The line mode lives on the xpon section and decides which ONU identity
		 * block (OMCI for GPON/XG-PON/XGS-PON, OAM for EPON) applies. Show it
		 * once here at the hardware-identity level instead of duplicating it in
		 * both ONU identity blocks.
		 */
		s = m.section(form.TypedSection, 'xpon', _('PON Mode'),
			_('Line mode and registration identity take effect after the PON interface restarts.'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.ListValue, 'mode', _('Line mode'));
		o.default = 'xgpon';
		o.rmempty = false;
		o.value('xgpon', _('XG-PON'));
		o.value('xgspon', _('XGS-PON'));
		o.value('epon-10g-1g', _('10G-EPON 10G/1G'));
		o.value('epon-10g-10g', _('10G-EPON 10G/10G'));
		o.description = _('Choose the mode according to the carrier\'s requirements.');
		modeOption = o;

		s = m.section(form.TypedSection, 'omci', _('ONU identity — OMCI'),
			_('Reported to the OLT over OMCI when the line runs in GPON, XG-PON or XGS-PON mode.'));
		s.anonymous = true;
		s.addremove = false;
		s.filter = function(sectionId) {
			return !sectionUsesEpon(sectionId);
		};

		/*
		 * The serial number is what the OLT registers. The burned board serial
		 * is not shown as a separate row: it fills this input as the placeholder
		 * instead, so an empty box visibly means "register under the burned
		 * value". Typing anything overrides it; the burned value itself is
		 * edited further down in the board identity block.
		 */
		var boardSerial = state.boardSerial || '';

		function effectiveSerial(sectionId, override) {
			if (override != null && override !== '')
				return String(override);

			var line = uci.get('pon', sectionId, 'line');
			var saved = line ? uci.get('pon', line, 'serial_number') : null;

			return String(saved || boardSerial || '');
		}

		function vendorPrefixFrom(serial) {
			return serial ? serial.substring(0, 4) : '';
		}

		var serialOption = s.option(form.Value, '_serial_number', _('Serial number (SN)'));
		serialOption.placeholder = boardSerial;
		serialOption.rmempty = true;
		serialOption.validate = validateSerialNumber;
		serialOption.cfgvalue = function(sectionId) {
			var line = uci.get('pon', sectionId, 'line');

			return uci.get('pon', line, 'serial_number') || '';
		};
		serialOption.write = function(sectionId, value) {
			var line = uci.get('pon', sectionId, 'line');

			uci.set('pon', line, 'serial_number', value);
		};
		serialOption.remove = function(sectionId) {
			var line = uci.get('pon', sectionId, 'line');

			uci.unset('pon', line, 'serial_number');
		};
		serialOption.description = _('Overrides the serial number burned into the board identity. Leave empty to register under the burned value.');

		/*
		 * Vendor ID is the four-character vendor code of the serial number, so
		 * an unset value defaults to the first four characters of the effective
		 * SN (the override above, or the burned serial when the box is empty).
		 * The default only fills the box: leaving it untouched keeps vendor_id
		 * unset in UCI, where the PON stack derives it from the SN.
		 */
		var vendorOption = s.option(form.Value, 'vendor_id', _('Vendor ID'));
		vendorOption.rmempty = true;
		vendorOption.validate = asciiLength(4, 4);
		vendorOption.cfgvalue = function(sectionId) {
			var stored = uci.get('pon', sectionId, 'vendor_id');

			if (stored != null && stored !== '')
				return stored;

			return vendorPrefixFrom(effectiveSerial(sectionId));
		};
		vendorOption.description = _('Usually the same as the first four characters of the serial number.');

		/*
		 * Keep the default in sync while the SN is being typed: once a vendor
		 * ID is explicitly stored in UCI or the vendor box has been edited by
		 * hand, stop touching it.
		 */
		serialOption.onchange = function(ev, sectionId, value) {
			if (uci.get('pon', sectionId, 'vendor_id') != null)
				return;

			var node = vendorOption.getUIElement(sectionId);

			if (node && node.isChanged && node.isChanged())
				return;

			if (node && typeof node.setValue === 'function')
				node.setValue(vendorPrefixFrom(effectiveSerial(sectionId, value)));
		};

	o = s.option(form.Value, 'equipment_id', _('Equipment ID'));
	o.rmempty = true;
	o.validate = asciiLength(1, 20);

	o = s.option(form.Value, 'hardware_version', _('Hardware version'));
	o.rmempty = true;
	o.validate = asciiLength(1, 14);

	o = s.option(form.Value, 'software_version', _('Software version'));
	o.rmempty = true;
	o.validate = asciiLength(1, 14);

	o = s.option(form.Value, 'operator_id', _('Operator ID'));
	o.rmempty = true;
	o.validate = asciiLength(1, 4);

	o = s.option(form.DummyValue, '_operator_id_tip', _('Note'));
	o.rawhtml = true;
	o.default = _('The above information should match the equipment nameplate.');

	s = m.section(form.TypedSection, 'oam', _('ONU identity — EPON OAM'),
		_('Reported to the OLT over EPON OAM when the line runs in EPON or 10G-EPON mode.'));
		s.anonymous = true;
		s.addremove = false;
		s.filter = function(sectionId) {
			return sectionUsesEpon(sectionId);
		};

		o = s.option(form.Value, 'vendor_id', _('Vendor ID'));
	o.rmempty = true;
	o.validate = asciiLength(4, 4);

	o = s.option(form.Value, 'model', _('ONU short model'));
	o.rmempty = true;
	o.validate = asciiLength(4, 4);

	o = s.option(form.Value, 'equipment_id', _('Equipment ID'));
	o.rmempty = true;
	o.validate = asciiLength(1, 16);

	o = s.option(form.Value, 'hardware_version', _('Hardware version'));
	o.rmempty = true;
	o.validate = asciiLength(1, 8);

	o = s.option(form.Value, 'software_version', _('Software version'));
	o.rmempty = true;
	o.validate = asciiLength(1, 16);

	o = s.option(form.Value, 'firmware_version', _('Firmware version'));
	o.rmempty = true;
	o.validate = asciiLength(1, 127);

	o = s.option(form.Value, 'chipset_id', _('Chipset ID'));
	o.rmempty = true;
	o.validate = validateChipsetId;

	o = s.option(form.Value, 'ge_ports', _('Ethernet port count'));
	o.default = '4';
	o.datatype = 'range(1,64)';

	o = s.option(form.DummyValue, '_operator_id_tip', _('Note'));
	o.rawhtml = true;
	o.default = _('The above information should match the equipment nameplate.');
		/*
		 * The board flash half of the page. It is built as form sections rather
		 * than as hand-made cards: a form map renders its own children into the
		 * tab containers it creates, so anything assembled outside render() ends
		 * up beside the tabs instead of inside them and is never shown.
		 */
		this.renderBoardBlocks(m, identity, storages);

		return m.render().then(function(node) {
			toggleModeSections(node, modeOption);

			return node;
		});
	},

	/*
	 * The board flash half of the page is one block: the identity fields patched
	 * in place followed by whole-image backup and replacement actions.
	 */
	renderBoardBlocks: function(m, identity, storages) {
		this.renderBoardIdentity(m, identity, storages);
	},

	renderBoardIdentity: function(m, identity, storages) {
		var self = this;
		var targets = mergeTargets(identity, storages);
		var withFields = targets.filter(function(target) {
			return Object.keys(target.fields || {}).length;
		});
		var s, o;

		s = m.section(form.TypedSection, 'pon_identity',
			'%s / %s'.format(_('Board identity'), _('PON board data')),
			_('The board data image is the whole storage target: identity fields and calibration data included. A backup downloads it, an upload replaces it; the previous image is kept under /tmp and both take effect after a reboot.'));
		s.addremove = false;

		/*
		 * The fields live in the board image, not in UCI, so the section is only
		 * a container: it is backed by a single synthetic instance whose options
		 * read and write the storages through pon-board-identity. It is
		 * anonymous so the synthetic name is not printed as a second heading.
		 */
		s.anonymous = true;
		s.cfgsections = function() {
			return [ 'board' ];
		};

		o = s.option(form.DummyValue, '_intro', _('Storage target'));
		o.cfgvalue = function() {
			return targets.map(function(target) {
				return target.label;
			}).join(', ') ||
				_('The board image carries the identity fields and the calibration data together; there is no calibration-only target.');
		};

		this.identityEntries = [];

		/*
		 * Mutable mirror of the values read from flash. CBIMap.save() ends with
		 * renderContents(), which rebuilds every input from cfgvalue(); pointing
		 * cfgvalue at this store lets a successful flash write update the form
		 * in place instead of waiting for a full page reload.
		 */
		this.identityValues = {};

		/*
		 * Say why the fields are missing instead of dropping the block: a card
		 * that vanishes reads as "the feature is gone", while a card that
		 * explains itself still tells the user where to look. This is what a
		 * board with an unreadable field or without an identity declaration
		 * hits.
		 */
		if (!withFields.length) {
			o = s.option(form.DummyValue, '_identity_missing', _('Board identity fields'));
			o.cfgvalue = function() {
				return identity === null
					? _('No board identity layout is available: /etc/board.json declares no identity targets, or pon-board-identity cannot be run.')
					: _('This board declares no writable identity fields.');
			};

		} else {
			withFields.forEach(function(target) {
				Object.keys(target.fields).forEach(function(field) {
					var value = (((identity || {}).data || {})[target.id] || {})[field] || '';
					var optionName = '_identity_' + target.id + '_' + field;

					self.identityValues[target.id] = self.identityValues[target.id] || {};
					self.identityValues[target.id][field] = value;

					var field_option = s.option(form.Value, optionName,
						boardLabels[field] || field);
					field_option.rmempty = true;
					field_option.default = value;
					field_option.cfgvalue = function() {
						return self.identityValues[target.id][field] || '';
					};
					field_option.validate = function(sectionId, newValue) {
						return validateBoardField(target.fields[field], newValue);
					};

					self.identityEntries.push({
						target: target.id,
						field: field,
						def: target.fields[field],
						option: field_option,
						original: value
					});
				});
			});
			o = s.option(form.DummyValue, '_identity_spacer');
			o.rawhtml = true;
			o.cfgvalue = function() {
				return E('div', { 'style': 'height: 1em' });
			};
		}

		/* Keep whole-image backup and upload in the same board section. */
		o = s.option(form.DummyValue, '_file_action', _('Board identity file'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return self.renderFileActions(storages, identity);
		};
	},

	/*
	 * The file downloaded or uploaded here is the board identity file: the
	 * whole image of the storage target, which carries the identity fields and
	 * the calibration data side by side. There is no calibration-only target,
	 * so there is exactly one image to back up and one to write per target.
	 * pon_data normally declares a single partition, so the target picker only
	 * appears when the board really offers more than one.
	 */
	renderFileActions: function(storages, identity) {
		var self = this;
		var options = storages.length ? storages : [];
		var fallback = firstIdentityTarget(identity);

		if (!options.length && fallback)
			options = [ fallback ];

		if (!options.length)
		return E('div', { 'class': 'cbi-section-descr' },
			_('No storage target is available: /etc/board.json declares no pon_data target, so there is no image to back up or write.'));

		/*
		 * With one target its label is already printed by the "Storage target"
		 * row above, so it is not repeated here; only a multi-target board gets
		 * the picker. The backup/write buttons are always shown.
		 */
		var nodes = [];

		if (options.length > 1) {
			nodes.push(E('select', { 'class': 'cbi-input-select', 'id': TARGET_SELECT_ID },
				options.map(function(target, index) {
					return E('option', { 'value': String(index) }, target.label);
				})));
		}

		nodes.push(E('div', { 'class': 'cbi-page-actions' }, [
				/*
				 * Backing up only reads the flash, so it stays available
				 * for a user who may not write.
				 */
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'id': 'pon-identity-backup',
					'click': ui.createHandlerFn(self, 'handleIdentityBackup',
						options, 'pon-identity-backup')
				}, [ _('Download backup') ]),
				/* The button id travels instead of the node: the handler
				   looks it up when the upload actually starts. */
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'id': 'pon-identity-upload',
					'disabled': self.readonly || null,
					'click': ui.createHandlerFn(self, 'handleIdentityUpload',
						options, 'pon-identity-upload')
				}, [ _('Upload and write') ])
			])
		);

		return E('div', {}, nodes);
	},

	/*
	 * The target is looked up when the button is clicked, not when the block is
	 * rendered: a re-render replaces the picker node, and a handler holding the
	 * old one would keep writing the target that was selected before.
	 */
	selectedTarget: function(options) {
		var select = document.getElementById(TARGET_SELECT_ID);
		var index = select ? Number(select.value) : 0;

		return options[index] || options[0] || null;
	},

	/* Reads the current image of one storage target and downloads it. */
	handleIdentityBackup: function(options, buttonId) {
		var button = document.getElementById(buttonId);
		var target = this.selectedTarget(options || []);

		if (!target) {
			ui.addNotification(null, E('p', [
				_('No storage target is available.')
			]), 'danger');

			return Promise.resolve();
		}

		if (button) {
			button.disabled = true;
			button.classList.add('spinning');
		}

		return fs.exec('/usr/libexec/airoha-pon-data', [ 'read', target.id ]).then(function(result) {
			if (result.code != 0)
				throw new Error(result.stderr || result.stdout || _('Backup failed.'));

			return downloadBackup(target.id).then(function() {
				var message = [
					_('Board identity file backed up from %s.').format(target.label)
				];

				if (result.stdout.trim())
					message.push(E('br'), result.stdout.trim());

				ui.addNotification(null, E('p', message), 'info');
			});
		}).catch(function(error) {
			ui.addNotification(null, E('p', [
				_('Backing up the board identity file failed: %s').format(error.message)
			]), 'danger');
		}).finally(function() {
			if (button) {
				button.disabled = false;
				button.classList.remove('spinning');
			}
		});
	},

/* Writes a complete board identity file to one storage target. */
handleIdentityUpload: function(options, buttonId) {
	var self = this;
	var button = document.getElementById(buttonId);
	var target = this.selectedTarget(options || []);

	if (!target) {
		ui.addNotification(null, E('p', [
			_('No storage target is available.')
		]), 'danger');

		return Promise.resolve();
	}

	/*
	 * The image is the whole target: writing it replaces the identity fields
	 * and the calibration data in one step, so it is confirmed first. The
	 * helper still keeps the previous image for recovery.
	 */
	if (!window.confirm(_('Writing replaces the whole image of %s, identity fields and calibration data included. Continue?').format(target.label)))
		return Promise.resolve();

	/*
	 * The button is only locked while the image is written. Locking it
	 * during the file picker too would leave it stuck if the user cancels
	 * the dialog, because ui.uploadFile() never settles in that case.
	 */
	return ui.uploadFile('/tmp/pon-board-data.bin').then(function() {
		if (button) {
			button.disabled = true;
			button.classList.add('spinning');
		}

		return fs.exec('/usr/libexec/airoha-pon-data', [ 'write', target.id ]);
	}).then(function(result) {
		if (result.code != 0)
			throw new Error(result.stderr || result.stdout || _('Write failed.'));

		var message = [
			_('Board identity file written to %s and verified. Reboot the device to apply it.')
				.format(target.label)
		];

		if (result.stdout.trim())
			message.push(E('br'), result.stdout.trim());

		ui.addNotification(null, E('p', message), 'info');
	}).catch(function(error) {
		ui.addNotification(null, E('p', [
			_('Writing the board identity file failed: %s').format(error.message)
		]), 'danger');
	}).finally(function() {
		if (button) {
			button.disabled = self.readonly || null;
			button.classList.remove('spinning');
		}
	});
},

/*
 * Read every board identity input right now and split the entries into the
 * changed values and the first validation failure. This must run BEFORE
 * CBIMap.save(): current LuCI builds finish save() with load() and
 * renderContents(), which rebuild every input from cfgvalue (the burned-in
 * original), so reading the fields afterwards always sees the old value and
 * the write is skipped with "no field changed".
 */
collectIdentityChanges: function() {
	var pending = [];
	var failure = null;

	this.identityEntries.forEach(function(entry) {
		var value = identityFieldValue(entry.option);

		if (value === null)
			value = String(entry.original || '');

		if (value == entry.original)
			return;

		var result = validateBoardField(entry.def, value);

		if (result !== true) {
			failure = failure || result;
			return;
		}

		pending.push({ target: entry.target, field: entry.field, value: value });
	});

	return { pending: pending, failure: failure };
},

/*
 * Writes the collected identity field changes of every storage target
 * straight into the flash image. Runs after CBIMap.save() so the UCI half of
 * the page is saved in the same click. Resolves to true when at least one
 * field was written, or false when nothing changed.
 */
writeIdentityChanges: function(pending) {
	if (!pending.length)
		return Promise.resolve(false);

	var byTarget = {};

	pending.forEach(function(change) {
		byTarget[change.target] = byTarget[change.target] || [];
		byTarget[change.target].push(change);
	});

	var sequence = Promise.resolve();

	Object.keys(byTarget).forEach(function(target) {
		sequence = sequence.then(function() {
			var args = [ 'write', target ];

			byTarget[target].forEach(function(change) {
				args.push(change.field + '=' + change.value);
			});

			return runIdentity(args);
		});
	});

	return sequence.then(function() {
		return true;
	});
},

/*
 * Re-read the flash image after a write and push every new value into the
 * rendered inputs, their comparison baselines and the value store behind
 * cfgvalue(). Also refreshes the burned-serial placeholder on the OMCI SN
 * box. This is what keeps the page correct without a manual Ctrl+F5: the
 * flash image is outside UCI, so CBIMap.save()'s own re-render cannot know
 * the values changed.
 */
refreshIdentityInputs: function() {
	var self = this;

	return loadIdentity().then(function(identity) {
		if (!identity || !identity.data)
			return;

		self.identityEntries.forEach(function(entry) {
			var values = identity.data[entry.target] || {};

			if (!Object.prototype.hasOwnProperty.call(values, entry.field))
				return;

			var value = values[entry.field] || '';

			self.identityValues[entry.target][entry.field] = value;
			entry.original = value;
			setIdentityFieldValue(entry.option, value);
		});

		if (self.boardTarget &&
				Object.prototype.hasOwnProperty.call(
					identity.data[self.boardTarget] || {}, 'pon_sn')) {
			var snField = document.querySelector('[data-field$="._serial_number"]');
			var snInput = snField ? snField.querySelector('input') : null;

			if (snInput)
				snInput.placeholder = identity.data[self.boardTarget].pon_sn || '';
		}
	}).catch(function() {
		/* A failed refresh only costs a manual page reload; the write itself
		   has already been confirmed by the helper. */
	});
},

/*
 * Saving the page covers both halves: UCI carries the line identity overrides,
 * while the board fields are written straight into the flash image. The board
 * fields are captured and validated first: map.save() re-renders the form once
 * it resolves, which would wipe the unsubmitted input values, and an invalid
 * board field must stop the whole save instead of leaving UCI half-applied.
 *
 * "Save" stages UCI and the flash image without applying anything; the new
 * board identity needs a reboot anyway. "Save & Apply" opens the standard
 * apply countdown only when UCI really has staged changes: the board fields
 * live in flash rather than in UCI, so a board-only edit would otherwise
 * trigger the apply endpoint's 204 reply and the misleading "There are no
 * changes to apply" notice even though the write succeeded. A board-only save
 * instead gets one dismissible "written, reboot required" notification - the
 * flash image cannot be covered by the UCI countdown and the old double-modal
 * stacking cannot happen because the countdown modal is not shown. Only
 * failures are surfaced as errors.
 */
savePage: function(andApply, mode) {
	var self = this;
	var map = document.querySelector('.cbi-map');

	if (!map)
		return Promise.resolve();

	var collected = this.collectIdentityChanges();

	if (collected.failure) {
		ui.addNotification(null, E('p', {}, collected.failure), 'danger');
		return Promise.resolve();
	}

	function notifyFlashWritten() {
		ui.addNotification(null, E('p',
			_('Board identity written. Reboot the device to use the new values.')),
			'info');
	}

	return dom.callClassMethod(map, 'save').then(function() {
		return self.writeIdentityChanges(collected.pending);
	}).then(function(flashWritten) {
		return self.refreshIdentityInputs().then(function() {
			return flashWritten;
		});
	}).then(function(flashWritten) {
		if (!andApply) {
			if (flashWritten)
				notifyFlashWritten();
			return;
		}

		return uci.changes().then(function(changes) {
			var hasUciChanges = Object.keys(changes || {}).some(function(config) {
				return L.toArray(changes[config]).length > 0;
			});

			if (hasUciChanges)
				return L.ui.changes.apply(mode == '0');

			/* Flash-only write: no UCI countdown to show, so give the
			   explicit feedback that the write happened. */
			if (flashWritten)
				notifyFlashWritten();
		});
	}).catch(function(error) {
		ui.addNotification(null, E('p', [
			_('Board identity write failed: %s').format(error.message)
		]), 'danger');
	});
},

handleSave: function() {
	return this.savePage(false);
},

handleSaveApply: function(ev, mode) {
	return this.savePage(true, mode);
}
});
