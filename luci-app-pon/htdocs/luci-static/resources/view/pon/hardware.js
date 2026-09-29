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

/*
 * pon-board-identity resolves its target through board.json's pon_data as
 * well, so a target it reports is always a valid airoha-pon-data target too.
 * That keeps the file upload available when airoha-pon-data list fails.
 */
function firstIdentityTarget(identity) {
	var names = Object.keys((identity && identity.layout && identity.layout.targets) || {});

	return names.length ? { id: names[0], label: names[0] } : null;
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

		/*
		 * The serial number is what the OLT registers; the board identity is
		 * what it is burned from. They are shown together here because a
		 * mismatch is the first thing to check when registration fails, but
		 * only the override is editable here — the burned value belongs to
		 * the flash image, edited further down the page.
		 */
		o = s.option(form.Value, '_serial_number', _('Serial number (SN)'));
		o.placeholder = _('Board serial number');
		o.rmempty = true;
		o.validate = validateSerialNumber;
		o.cfgvalue = function(sectionId) {
			var line = uci.get('pon', sectionId, 'line');

			return uci.get('pon', line, 'serial_number') || '';
		};
		o.write = function(sectionId, value) {
			var line = uci.get('pon', sectionId, 'line');

			uci.set('pon', line, 'serial_number', value);
		};
		o.remove = function(sectionId) {
			var line = uci.get('pon', sectionId, 'line');

			uci.unset('pon', line, 'serial_number');
		};
		o.description = _('Overrides the serial number burned into the board identity. Leave empty to register under the burned value.');

		o = s.option(form.DummyValue, '_board_serial', _('Board serial number (SN)'));
		o.cfgvalue = function(sectionId) {
			var serial = state.boardSerial;

			if (serial === null || serial === undefined)
				return _('Not available');

			return serial || _('Not set');
		};
		o.description = _('Read from the board identity image. Edit it under Calibration data below.');

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

		/*
		 * The board flash half of the page. It is built as a form section rather
		 * than as a hand-made card: a form map renders its own children into the
		 * tab containers it creates, so anything assembled outside render() ends
		 * up beside the tabs instead of inside them and is never shown.
		 */
		this.renderBoardData(m, identity, storages);

		return m.render();
	},

	renderBoardData: function(m, identity, storages) {
		var self = this;
		var targets = mergeTargets(identity, storages);
		var withFields = targets.filter(function(target) {
			return Object.keys(target.fields || {}).length;
		});
		var s, o;

		if (!withFields.length && !storages.length)
			return;

		s = m.section(form.TypedSection, 'pon_identity', _('Calibration data'),
			_('The identity fields and the calibration data are two views of the same flash image of a storage target, and both take effect after a reboot. Identity fields are patched in place; the board identity file replaces the whole target. The previous image is kept as /tmp/pon-board-*.bin.'));
		s.anonymous = false;
		s.addremove = false;

		/*
		 * The fields live in the board image, not in UCI, so the section is only
		 * a container: it is backed by a single synthetic instance whose options
		 * read and write the storages through pon-board-identity.
		 */
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

		withFields.forEach(function(target) {
			Object.keys(target.fields).forEach(function(field) {
				var value = (((identity || {}).data || {})[target.id] || {})[field] || '';
				var optionName = '_identity_' + target.id + '_' + field;

				var field_option = s.option(form.Value, optionName,
					boardLabels[field] || field);
				field_option.rmempty = true;
				field_option.default = value;
				field_option.cfgvalue = function() {
					return value;
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

		o = s.option(form.DummyValue, '_file_action', _('Board identity file'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return self.renderFileActions(storages, identity);
		};
	},

	/*
	 * The file uploaded here is the board identity file: the whole image of the
	 * storage target, which carries the identity fields and the calibration data
	 * side by side. There is no calibration-only target, so there is exactly one
	 * file to write and one button to write it with — and no target picker,
	 * because pon_data declares a single partition.
	 */
	renderFileActions: function(storages, identity) {
		var self = this;
		var uploadTarget = storages.length ? storages[0] : firstIdentityTarget(identity);

		if (!uploadTarget)
			return E('span', {}, _('No storage target is available.'));

		return E('div', {}, [
			E('div', { 'class': 'cbi-section-descr' },
				_('Uploads a complete image of the storage target and replaces it, identity fields and calibration data included. The previous image is kept as /tmp/pon-board-data.*.bin.')),
			E('div', { 'class': 'cbi-page-actions' }, [
				/* The button id travels instead of the node: the handler
				   looks it up when the upload actually starts. */
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'id': 'pon-identity-upload',
					'disabled': self.readonly || null,
					'click': ui.createHandlerFn(self, 'handleIdentityUpload',
						uploadTarget, 'pon-identity-upload')
				}, [ _('Upload and write') ])
			])
		]);
	},

/* Writes a complete board identity file to one storage target. */
handleIdentityUpload: function(target, buttonId) {
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
 * Writes the changed identity fields of every storage target. The values come
 * from the form's own inputs, so the fields are read exactly as the page shows
 * them, whether or not the browser kept a node reference around.
 */
handleIdentityWrite: function() {
	var self = this;
	var pending = [];
	var failure = null;

	this.identityEntries.forEach(function(entry) {
		var node, value, result;

		node = entry.option.getUIElement ? entry.option.getUIElement('board') : null;
		value = node && node.value != null ? node.value.trim() : String(entry.original || '');

		if (value == entry.original)
			return;

		result = validateBoardField(entry.def, value);

		if (result !== true) {
			failure = failure || result;
			return;
		}

		pending.push({ target: entry.target, field: entry.field, value: value });
	});

	if (failure) {
		ui.addNotification(null, E('p', {}, failure), 'danger');
		return Promise.resolve();
	}

	if (!pending.length) {
		ui.addNotification(null, E('p', {}, _('No board identity field was changed.')), 'info');
		return Promise.resolve();
	}

	var byTarget = {};

	pending.forEach(function(change) {
		byTarget[change.target] = byTarget[change.target] || [];
		byTarget[change.target].push(change);
	});

	var sequence = Promise.resolve();
	var output = [];

	Object.keys(byTarget).forEach(function(target) {
		sequence = sequence.then(function() {
			var args = [ 'write', target ];

			byTarget[target].forEach(function(change) {
				args.push(change.field + '=' + change.value);
			});

			return runIdentity(args).then(function(result) {
				output.push(result);
			});
		});
	});

	return sequence.then(function() {
		self.identityEntries.forEach(function(entry) {
			var node = entry.option.getUIElement ? entry.option.getUIElement('board') : null;

			if (node && node.value != null)
				entry.original = node.value.trim();
		});

		ui.addNotification(null, E('p', [
			_('Board identity written. Reboot the device to use the new values.'),
			E('br'), output.join('; ')
		]), 'info');
	}).catch(function(error) {
		ui.addNotification(null, E('p', [
			_('Board identity write failed: %s').format(error.message)
		]), 'danger');
	});
},

/*
 * Saving the page covers both halves: UCI carries the line identity overrides,
 * while the board fields are written straight into the flash image. The board
 * write runs first so a failure there does not silently leave UCI ahead of the
 * image it is supposed to agree with.
 */
handleSave: function() {
	var self = this;
	var map = document.querySelector('.cbi-map');

	if (!map)
		return Promise.resolve();

	return dom.callClassMethod(map, 'save').then(function() {
		return self.handleIdentityWrite();
	}).then(function() {
		ui.hideModal();
		return L.ui.changes.apply();
	});
},

handleSaveApply: null
});
