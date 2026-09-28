// SPDX-License-Identifier: Apache-2.0

'use strict';
'require view';

var STYLESHEET = 'view/pon/pon.css';

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

/*
 * Placeholder for the FXO voice configuration. It renders no form because the
 * voice daemon and its UCI schema do not exist yet; the page exists so the tab
 * order is stable and the settings have an obvious home once they land.
 */
return view.extend({
	render: function() {
		ensureStylesheet();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Voice')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Voice services carried by the PON uplink.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('FXO voice')),
				E('div', { 'class': 'cbi-section-descr' }, [
					_('FXO voice configuration is not available yet.'),
					E('br'),
					_('The settings will be stored in /etc/config/voice once the voice daemon is available.')
				])
			])
		]);
	}
});
