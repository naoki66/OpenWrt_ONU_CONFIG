// SPDX-License-Identifier: Apache-2.0

'use strict';
'require form';
'require uci';
'require view';

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

function validateSerialNumber(sectionId, value) {
	if (value == null || value === '')
		return true;

	if (/^[0-9a-fA-F]{16}$/.test(value) ||
	    /^[A-Za-z0-9]{4}[0-9a-fA-F]{8}$/.test(value))
		return true;

	return _('Use 16 hexadecimal digits or VEND followed by 8 hexadecimal digits.');
}

function isEponMode(mode) {
	return (mode || '').indexOf('epon-') === 0;
}

function sectionUsesEpon(sectionId) {
	var line = uci.get('pon', sectionId, 'line');

	return isEponMode(uci.get('pon', line, 'mode'));
}

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('pon', _('PON'),
			_('Line mode, registration and authentication settings for the PON interfaces. Calibration data is written on the hardware identity page.'));
		m.readonly = !L.hasViewPermission();

		s = m.section(form.TypedSection, 'xpon', _('PON line'));
		s.anonymous = false;
		s.addremove = false;
		s.description = _('Line mode and registration identity take effect after the PON interface restarts.');

		o = s.option(form.DummyValue, 'device', _('PON interface'));
		o.default = '-';

		o = s.option(form.ListValue, 'mode', _('Line mode'));
		o.default = '';
		o.value('', _('Driver default'));
		o.value('xgpon', _('XG-PON'));
		o.value('xgspon', _('XGS-PON'));
		o.value('epon-10g-1g', _('10G-EPON 10G/1G'));
		o.value('epon-10g-10g', _('10G-EPON 10G/10G'));

		o = s.option(form.Value, 'serial_number', _('Serial number (SN)'));
		o.placeholder = _('Board serial number');
		o.rmempty = true;
		o.validate = validateSerialNumber;
		o.depends('mode', '');
		o.depends('mode', 'xgpon');
		o.depends('mode', 'xgspon');

		o = s.option(form.Value, 'registration_id', _('Registration-ID'));
		o.password = true;
		o.rmempty = true;
		o.depends('mode', '');
		o.depends('mode', 'xgpon');
		o.depends('mode', 'xgspon');
		o.validate = asciiLength(1, 36);
		o.description = _('Optional; sent as all zeros when empty.');

	s = m.section(form.TypedSection, 'omci', _('OMCI settings'),
		_('The ONU identity reported over OMCI is configured on the hardware identity page.'));
	s.anonymous = false;
	s.addremove = false;
	s.filter = function(sectionId) {
		return !sectionUsesEpon(sectionId);
	};
	s.tab('authentication', _('Authentication'));
	s.tab('compatibility', _('Compatibility'));

	o = s.taboption('authentication', form.DummyValue, 'line', _('XG-PON configuration'));
	o.default = '-';

	o = s.taboption('authentication', form.DummyValue, 'device', _('OMCI interface'));
	o.default = '-';

	o = s.taboption('authentication', form.Value, 'loid', _('LOID'));
	o.rmempty = true;
	o.validate = asciiLength(1, 24);

	o = s.taboption('authentication', form.Value, 'loid_password', _('LOID password'));
	o.password = true;
	o.rmempty = true;
	o.validate = asciiLength(1, 12);

	o = s.taboption('compatibility', form.ListValue, 'omcc_version', _('OMCC version'));
	o.value('0xb0', '0xb0');
	o.value('0x86', '0x86');
	o.default = '0xb0';
	o.rmempty = false;
	o.description = _('If the ONU cannot register with a Huawei OLT, try OMCC version 0x86.');

	o = s.taboption('compatibility', form.Flag, 'disable_enhanced_security', _('Disable enhanced security (Class 332)'));
	o.default = '0';
	o.rmempty = true;

	o = s.taboption('compatibility', form.Value, 'alloc_id_timeout', _('Alloc-ID wait timeout'));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.rmempty = true;
		o.description = _('Seconds a data path may wait for PLOAM to assign its Alloc-ID before it is reported as failed. The ONU keeps waiting afterwards; 0 disables the timeout.');

	s = m.section(form.TypedSection, 'oam', _('EPON OAM settings'),
		_('The ONU identity reported over OAM is configured on the hardware identity page.'));
	s.anonymous = false;
	s.addremove = false;
	s.filter = function(sectionId) {
		return sectionUsesEpon(sectionId);
	};

	o = s.option(form.DummyValue, 'line', _('EPON configuration'));
	o.default = '-';

	o = s.option(form.DummyValue, 'device', _('OAM interface'));
	o.default = '-';

	o = s.option(form.ListValue, 'operator', _('OAM profile'));
	o.default = 'ctc';
	o.value('ieee', _('IEEE 802.3ah'));
	o.value('ctc', _('IEEE 802.3ah + CTC'));

	o = s.option(form.Value, 'loid', _('LOID'));
	o.rmempty = true;
	o.depends('operator', 'ctc');
	o.validate = asciiLength(1, 24);

	o = s.option(form.Value, 'loid_password', _('LOID password'));
	o.password = true;
	o.rmempty = true;
	o.depends('operator', 'ctc');
	o.validate = asciiLength(1, 12);

		return m.render();
	}
});
