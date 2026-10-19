/* Platform console (SaaS owner): every transport company on the platform, its plan,
 * domain, status and volume; create companies and open any of them. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, t = App.t, store = App.store;
  var PLANS = ['starter', 'pro', 'enterprise'];

  function call(method, path, body) { return App.API.call(method, path, body, store.get('platformToken')); }

  App.views.platform = function () {
    if (!store.get('platformToken')) {
      $('#main').innerHTML = App.loginBox(t('platformTitle'), t('password'), 'password', 'text', App.API.mode === 'demo' ? t('demoPlatform') : '');
      $('#loginForm').onsubmit = function (e) {
        e.preventDefault();
        App.API.call('POST', '/api/platform/login', { password: $('#secret').value }).then(function (r) {
          if (r.status !== 200) return App.loginErr(r);
          store.set('platformToken', r.body.token); App.views.platform();
        });
      };
      return;
    }
    call('GET', '/api/platform/state').then(function (r) {
      if (r.status === 401) { store.set('platformToken', null); return App.views.platform(); }
      draw(r.body.tenants);
    });
  };

  function draw(list) {
    var total = list.reduce(function (s, x) { return s + x.revenue30; }, 0);
    $('#main').innerHTML = '<section class="ops"><header class="ops-head"><div><p class="eyebrow">' + t('platformTitle') + '</p><h1>' + t('platformH') + '</h1><p class="fine">' + t('platformSub') + '</p></div>' +
      '<div class="row"><button class="btn primary sm" id="newT">+ ' + t('newTenant') + '</button><button class="btn ghost sm" id="pOut">' + t('logout') + '</button></div></header>' +
      '<div class="kpis three">' + App.kpi(t('companies'), list.length, t('activeN', { n: list.filter(function (x) { return x.status === 'active'; }).length })) +
        App.kpi(t('bookings30'), list.reduce(function (s, x) { return s + x.bookings30; }, 0)) + App.kpi(t('revenue30'), App.money(total)) + '</div>' +
      '<div class="tenant-grid">' + list.map(function (x) {
        return '<article class="tenant' + (x.status === 'suspended' ? ' off' : '') + '" style="--accent:' + esc(x.accent || '#0f8b7f') + '"><header><i class="swatch"></i><div><h3>' + esc(x.name) + '</h3><p class="fine mono">' + esc(x.slug) + (x.domain ? ' · ' + esc(x.domain) : '') + '</p></div>' +
          '<span class="pill">' + esc(t('plan_' + x.plan) === 'plan_' + x.plan ? x.plan : t('plan_' + x.plan)) + '</span></header>' +
          '<dl class="mini-stats"><div><dt>' + t('bookings30') + '</dt><dd>' + x.bookings30 + '</dd></div><div><dt>' + t('revenue30') + '</dt><dd>' + App.money(x.revenue30) + '</dd></div><div><dt>' + t('tab_drivers') + '</dt><dd>' + x.drivers + '</dd></div><div><dt>' + t('vehicles') + '</dt><dd>' + x.vehicles + '</dd></div></dl>' +
          '<div class="row"><button class="btn sm" data-open="' + esc(x.slug) + '">' + t('openAs') + '</button><button class="btn sm ghost" data-edit="' + esc(x.slug) + '">' + t('edit') + '</button>' +
          (x.status === 'suspended' ? '<span class="pill st-cancelled">' + t('suspended') + '</span>' : '') + '</div></article>';
      }).join('') + '</div>' +
      '<section class="panel"><h3>' + t('saasRoadmap') + '</h3><p class="fine">' + t('saasHint') + '</p></section></section>';
    $('#pOut').onclick = function () { store.set('platformToken', null); App.views.platform(); };
    $('#newT').onclick = function () { sheet(null); };
    $$('[data-edit]').forEach(function (b) { b.onclick = function () { sheet(list.find(function (x) { return x.slug === b.dataset.edit; })); }; });
    $$('[data-open]').forEach(function (b) {
      b.onclick = function () {
        // Switch this browser to that company: its booking page, branding and dashboard.
        App.setTenant(b.dataset.open === 'default' ? '' : b.dataset.open);
        store.set('adminToken', null); store.set('driverToken', null);
        App.reloadConfig().then(function () { location.hash = 'admin'; App.toast(t('nowViewing', { name: list.find(function (x) { return x.slug === b.dataset.open; }).name })); });
      };
    });
  }

  function sheet(x) {
    var f = function (id, label, val, type, extra) { return '<label class="fld" for="' + id + '"><span>' + label + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"' + (extra || '') + '></label>'; };
    App.openSheet('<h2>' + (x ? esc(x.name) : t('newTenant')) + '</h2><div class="grid2">' + f('tName', t('companyName'), x && x.name) + (x ? '' : f('tSlug', t('slug'), '', 'text', ' placeholder="lonestar-limo"')) +
      f('tDomain', t('customDomain'), x && x.domain, 'text', ' placeholder="book.example.com"') +
      '<label class="fld" for="tPlan"><span>' + t('plan') + '</span><select id="tPlan">' + PLANS.map(function (p) { return '<option value="' + p + '"' + (x && x.plan === p ? ' selected' : '') + '>' + t('plan_' + p) + '</option>'; }).join('') + '</select></label>' +
      f('tPw', x ? t('newPasswordOpt') : t('ownerPassword'), '', 'password', ' autocomplete="new-password"') + (x ? '' : '<label class="fld color" for="tAccent"><span>' + t('accentColor') + '</span><input id="tAccent" type="color" value="#3d8bf2"></label>') + '</div>' +
      '<p class="fine">' + t('tenantHint') + '</p>' +
      '<div class="sheet-actions">' + (x ? '<button class="btn ghost' + (x.status === 'active' ? ' danger' : '') + '" id="tSusp">' + (x.status === 'active' ? t('suspend') : t('activate')) + '</button>' : '') +
      '<button class="btn ghost" data-close>' + t('close') + '</button><button class="btn primary" id="tSave">' + t('save') + '</button></div>', true);
    var done = function (r) { if (r.status === 200) { App.closeSheet(); App.toast(t('saved'), 'good'); App.views.platform(); } else App.toast(App.errText(r), 'bad'); };
    $('#tSave').onclick = function () {
      if (x) call('POST', '/api/platform/tenants/' + x.slug, { name: $('#tName').value, domain: $('#tDomain').value, plan: $('#tPlan').value, ownerPassword: $('#tPw').value }).then(done);
      else call('POST', '/api/platform/tenants', { name: $('#tName').value, slug: $('#tSlug').value || $('#tName').value, domain: $('#tDomain').value, plan: $('#tPlan').value, ownerPassword: $('#tPw').value, accent: $('#tAccent').value }).then(done);
    };
    var s = $('#tSusp');
    if (s) s.onclick = function () { call('POST', '/api/platform/tenants/' + x.slug, { status: x.status === 'active' ? 'suspended' : 'active' }).then(done); };
  }
})();
