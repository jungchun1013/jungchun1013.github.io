/*
 * theme.js — site colour scheme ('light' / 'dark'). Loaded in <head> so the first paint already
 * has the right colours. Choice is stored in localStorage; otherwise follows the system scheme.
 * The homepage ocean (ocean.js) listens for changes and swaps its scene.
 */
(function () {
	var KEY = 'theme', root = document.documentElement, listeners = [];
	function read() {
		try { var t = localStorage.getItem(KEY); if (t === 'light' || t === 'dark') return t; } catch (e) {}
		return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
	}
	var theme = read();
	root.setAttribute('data-theme', theme);

	function updateToggles() {
		var els = document.querySelectorAll('.theme-toggle');
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			// the icon shows the scheme you would switch to
			el.classList.toggle('fa-sun', theme === 'dark');
			el.classList.toggle('fa-moon', theme === 'light');
			el.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
			el.setAttribute('title', el.getAttribute('aria-label'));
		}
	}
	function set(t, animate) {
		if (t !== 'light' && t !== 'dark') return;
		theme = t;
		if (animate) {
			root.classList.add('theme-transition');
			setTimeout(function () { root.classList.remove('theme-transition'); }, 700);
		}
		root.setAttribute('data-theme', t);
		try { localStorage.setItem(KEY, t); } catch (e) {}
		updateToggles();
		for (var i = 0; i < listeners.length; i++) listeners[i](t);
	}
	window.siteTheme = {
		get: function () { return theme; },
		set: set,
		toggle: function () { set(theme === 'dark' ? 'light' : 'dark', true); },
		onChange: function (fn) { listeners.push(fn); }
	};
	document.addEventListener('DOMContentLoaded', function () {
		updateToggles();
		document.addEventListener('click', function (e) {
			var el = e.target.closest && e.target.closest('.theme-toggle');
			if (!el) return;
			e.preventDefault();
			window.siteTheme.toggle();
		});
	});
})();
