// SPDX-License-Identifier: Apache-2.0

'use strict';
'require dom';
'require form';
'require fs';
'require uci';
'require ui';
'require view';

var STYLESHEET = 'view/pon/pon.css';

var boardLabels = {
	pon_sn: _('PON serial number'),
	device_sn: _('Device serial number'),
	pon_mac: _('PON MAC address'),
	board_mac: _('Board MAC address'),
	lan_base_mac: _('LAN base MAC address')
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
	default: return mode || _('Not configured');
	}
}

function sectionUsesEpon(sectionId) {
	var line = uci.get('pon', sectionId, 'line');

	return isEponMode(uci.get('pon', line, 'mode'));
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

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('pon'),
			L.resolveDefault(loadIdentity(), null),
			L.resolveDefault(loadStorages(), [])
		]).then(function(results) {
			return { identity: results[1], storages: results[2] };
		});
	},

	render: function(state) {
		var identity = (state || {}).identity;
		var storages = (state || {}).storages || [];
		var m, s, o;
		var readonly = !L.hasViewPermission();

		this.readonly = readonly;
		ensureStylesheet();

		/*
		 * One page for everything that identifies this unit on the board and
		 * towards the OLT: the board identity and the calibration image stored
		 * in flash, plus the ONU identity sent over the wire. The protocol
		 * half is split by line mode because EPON reports it over OAM while
		 * GPON, XG-PON and XGS-PON report it over OMCI.
		 */
		m = new form.Map('pon', _('Hardware identity'),
			_('Board identity and calibration data stored in flash, and the ONU identity reported to the OLT.'));
		m.readonly = readonly;

		s = m.section(form.TypedSection, 'omci', _('ONU identity — OMCI'),
			_('Reported to the OLT over OMCI when the line runs in GPON, XG-PON or XGS-PON mode.'));
		s.anonymous = false;
		s.addremove = false;
		s.filter = function(sectionId) {
			return !sectionUsesEpon(sectionId);
		};

		o = s.option(form.DummyValue, 'line', _('PON line'));
		o.default = '-';

		o = s.option(form.DummyValue, '_mode', _('Line mode'));
		o.cfgvalue = function(sectionId) {
			return modeLabel(uci.get('pon', uci.get('pon', sectionId, 'line'), 'mode'));
		};

		o = s.option(form.Value, 'vendor_id', _('Vendor ID'));
		o.rmempty = true;
		o.validate = asciiLength(4, 4);
		o.description = _('Usually the same as the first four characters of the serial number.');

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

		s = m.section(form.TypedSection, 'oam', _('ONU identity — EPON OAM'),
			_('Reported to the OLT over EPON OAM when the line runs in EPON or 10G-EPON mode.'));
		s.anonymous = false;
		s.addremove = false;
		s.filter = function(sectionId) {
			return sectionUsesEpon(sectionId);
		};

		o = s.option(form.DummyValue, 'line', _('PON line'));
		o.default = '-';

		o = s.option(form.DummyValue, '_mode', _('Line mode'));
		o.cfgvalue = function(sectionId) {
			return modeLabel(uci.get('pon', uci.get('pon', sectionId, 'line'), 'mode'));
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
		o.default = '1';
		o.datatype = 'range(1,64)';

		var cards = [];

		/* One card for everything written to the board's flash, grouped by
		   storage target. The two halves still degrade independently. */
		if (identity || storages.length)
			cards.push(this.renderBoardData(identity, storages));

		return m.render().then(L.bind(function(map) {
			return E([], cards.concat([ map ]));
		}, this));
	},

	renderBoardData: function(identity, storages) {
		var self = this;
		var entries = [];
		var blocks = mergeTargets(identity, storages).map(function(target) {
			var rows = [];

			Object.keys(target.fields || {}).forEach(function(field) {
				var id = 'pon-identity-' + target.id + '-' + field;
				var input = E('input', {
					'class': 'cbi-input-text',
					'type': 'text',
					'id': id,
					'value': (((identity || {}).data || {})[target.id] || {})[field] || ''
				});

				if (self.readonly)
					input.disabled = true;

				entries.push({ target: target.id, field: field, def: target.fields[field], input: input });

				rows.push(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': id },
						boardLabels[field] || field),
					E('div', { 'class': 'cbi-value-field' }, input)
				]));
			});

			if (!rows.length)
				return null;

			return E('div', {}, [
				E('h4', { 'class': 'pon-subhead' }, _('Storage target: %s').format(target.label)),
				rows,
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'disabled': self.readonly || null,
						'click': ui.createHandlerFn(self, 'handleIdentityWrite', target.id)
					}, _('Write board identity'))
				])
			]);
		}).filter(function(block) {
			return block != null;
		});

		/*
		 * One calibration image, one target: the image replaces the whole
		 * target, so it is picked explicitly instead of getting a button per
		 * target next to the identity fields.
		 */
		/*
		 * A board carries a single board data partition, so the image always
		 * goes to the one target that pon_data declares — no target picker.
		 */
		if (storages.length)
			blocks.push(E('div', {}, [
				E('h4', { 'class': 'pon-subhead' }, _('Calibration image')),
				E('div', { 'class': 'cbi-page-actions' }, [
					/* The button id travels instead of the node: the handler
					   looks it up when the upload actually starts. */
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'id': 'pon-calibration-upload',
						'disabled': self.readonly || null,
						'click': ui.createHandlerFn(self, 'handleCalibrationUpload',
							storages[0], 'pon-calibration-upload')
					}, [ _('Upload and write') ])
				])
			]));

		this.identityEntries = entries;
		this.identityOriginal = JSON.parse(JSON.stringify((identity || {}).data || {}));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Calibration data')),
			E('div', { 'class': 'cbi-section-descr' },
				_('The identity fields and the calibration image are the same flash image of a storage target, and both take effect after a reboot. Identity fields are patched in place; a calibration image replaces the whole target. The previous image is kept as /tmp/pon-board-*.bin.')),
			blocks
		]);
	},

	handleCalibrationUpload: function(target, buttonId) {
		var self = this;
		var button = document.getElementById(buttonId);

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
				_('Calibration data written to %s and verified. Reboot the device to apply it.')
					.format(target.label)
			];

			if (result.stdout.trim())
				message.push(E('br'), result.stdout.trim());

			ui.addNotification(null, E('p', message), 'info');
		}).catch(function(error) {
			ui.addNotification(null, E('p', [
				_('Writing calibration data failed: %s').format(error.message)
			]), 'danger');
		}).finally(function() {
			if (button) {
				button.disabled = self.readonly || null;
				button.classList.remove('spinning');
			}
		});
	},

	/* Writes the changed identity fields of a single storage target. */
	handleIdentityWrite: function(target) {
		var self = this;
		var pending = [];
		var failure = null;

		this.identityEntries.forEach(function(entry) {
			var original, value, result;

			if (entry.target !== target)
				return;

			original = (self.identityOriginal[entry.target] || {})[entry.field] || '';
			value = entry.input.value.trim();
			result = validateBoardField(entry.def, value);

			entry.input.classList.remove('cbi-input-invalid');

			if (value == original)
				return;

			if (result !== true) {
				entry.input.classList.add('cbi-input-invalid');
				failure = failure || result;
				return;
			}

			entry.input.value = value;
			pending.push(entry);
		});

		if (failure) {
			ui.addNotification(null, E('p', {}, failure), 'danger');
			return;
		}

		if (!pending.length) {
			ui.addNotification(null, E('p', {}, _('No board identity field was changed.')), 'info');
			return;
		}

		var args = [ 'write', target ];

		pending.forEach(function(entry) {
			args.push(entry.field + '=' + entry.input.value);
		});

		return runIdentity(args).then(function(output) {
			pending.forEach(function(entry) {
				self.identityOriginal[entry.target] = self.identityOriginal[entry.target] || {};
				self.identityOriginal[entry.target][entry.field] = entry.input.value;
			});

			ui.addNotification(null, E('p', [
				_('Board identity written. Reboot the device to use the new values.'),
				E('br'), output
			]), 'info');
		}).catch(function(error) {
			ui.addNotification(null, E('p', [
				_('Board identity write failed: %s').format(error.message)
			]), 'danger');
		});
	},

	handleSaveApply: null
});
