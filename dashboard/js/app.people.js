// ── PEOPLE ────────────────────────────────────────────────────────────────
var PORTAL_ROLES = ['master-admin','owner','admin','activator','client-rep','leader','jd','manager'];
var _ROLE_LABELS = {
  'master-admin':'Master Admin','owner':'Owner','admin':'Admin',
  'activator':'Activator','client-rep':'Client Rep','leader':'Team Leader',
  'jd':'JD','manager':'Manager'
};

function renderPeople() {
  var roster = DATA.roster || {};
  var guestRoster = DATA.guestRoster || {};
  var role = SESSION.role;
  // People management (add + edit) — jd/manager/admin/owner/master-admin, plus activator
  // (activators work across offices; their multi-office badge + the per-office switcher
  // scope them, and _officeAllowed on the backend enforces it). NOT a Teams-management grant.
  var isAdmin   = role === 'master-admin' || role === 'owner' || role === 'admin' || role === 'manager' || role === 'jd' || role === 'activator';
  var isMgr     = false;   // jd is now a full admin here (manager-equivalent)
  // Team LEADS can also add + edit people (assign teams, basics) — restricted fields via buildPersonForm.
  var canManagePeople = isAdmin || role === 'leader';
  // Password reset is a security action — limited to the management tier (mirrors
  // the backend resetUserPin gate = _ADMIN_ROLES; excludes activators + leaders).
  var canResetPw = role === 'master-admin' || role === 'owner' || role === 'admin' || role === 'manager' || role === 'jd';
  var myEmail   = (SESSION.email || '').toLowerCase();
  var homeRows = Object.keys(roster).map(function(email) {
    return Object.assign({ email: email, isGuest: false }, roster[email]);
  });
  var guestRows = Object.keys(guestRoster).filter(function(email) { return !roster[email]; }).map(function(email) {
    return Object.assign({ email: email, isGuest: true }, guestRoster[email]);
  });
  var rows = homeRows.concat(guestRows).sort(function(a,b) { return (a.name||'').localeCompare(b.name||''); });
  if (!rows.length) return noData('No people in the roster yet.', {icon:'people'});
  var addBtn = canManagePeople ? '<button class="refresh-btn" style="margin-bottom:14px" onclick="openAddPersonModal()">+ Add Person</button>' : '';
  return '<div class="card"><div class="card-header dark">People &amp; Roster</div><div class="card-body">' +
    addBtn +
    '<div class="filter-row"><input id="f-people" placeholder="Search name, email, role…"></div>' +
    '<div class="tbl-wrap"><table id="people-table"><thead><tr>' +
    '<th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Phone</th><th>Status</th><th>Tableau Name</th><th>Office Access</th><th>Actions</th>' +
    '</tr></thead><tbody>' +
    rows.map(function(row) {
      var statusBadge = row.deactivated ? '<span class="badge badge-red">Inactive</span>' : '<span class="badge badge-green">Active</span>';
      var perms = (row.permissions || CFG.officeId).split(',').map(function(p) { return OFFICE_NAMES[p.trim()] || p.trim(); }).join(', ');
      var nameCell = esc(row.name) + (row.isGuest ? ' <span style="font-size:.72rem;color:#888;font-weight:400">from ' + esc(OFFICE_NAMES[row.homeOffice]||row.homeOffice) + '</span>' : '');
      var isSelf = row.email.toLowerCase() === myEmail;
      var actions;
      if (row.isGuest) {
        actions = (isAdmin || isMgr) ? '<td style="color:#aaa;font-size:.78rem">Managed in ' + esc(OFFICE_NAMES[row.homeOffice]||row.homeOffice) + '</td>' : '<td></td>';
      } else if (canManagePeople) {
        // Reset Password: management tier only, never your own row, and a
        // master-admin target only by another master-admin (matches the backend).
        var resetBtn = (canResetPw && !isSelf && (row.rank !== 'master-admin' || role === 'master-admin'))
          ? ' <button class="notes-btn" onclick="resetPersonPassword(\''+esc(row.email)+'\')">Reset Password</button>' : '';
        actions = '<td style="white-space:nowrap"><button class="notes-btn" onclick="openEditPersonModal(\''+esc(row.email)+'\')">Edit</button>' +
          resetBtn +
          (role==='master-admin' ? ' <button class="notes-btn" style="color:var(--red)" onclick="deletePerson(\''+esc(row.email)+'\')">Remove</button>' : '') + '</td>';
      } else if (isMgr) {
        actions = '<td><button class="notes-btn" onclick="openEditPersonModal(\''+esc(row.email)+'\')">Edit</button></td>';
      } else if (isSelf) {
        actions = '<td><button class="notes-btn" onclick="openEditPersonModal(\''+esc(row.email)+'\')">Edit Phone</button></td>';
      } else {
        actions = '<td></td>';
      }
      return '<tr'+(row.isGuest?' style="background:#fafafa;color:#555"':'')+'>'+
        '<td>'+nameCell+'</td><td>'+esc(row.email)+'</td><td>'+esc(_ROLE_LABELS[row.rank]||row.rank||'client-rep')+'</td><td>'+esc(row.team||'')+'</td><td>'+esc(row.phone||'—')+'</td><td>'+statusBadge+'</td><td>'+esc(row.tableauName||'—')+'</td><td>'+esc(perms)+'</td>'+actions+'</tr>';
    }).join('') + '</tbody></table></div></div></div>';
}

function buildPersonForm(email, person) {
  var p = person || {};
  var rank = p.rank || 'client-rep';
  var role = SESSION.role;
  var isSelf = email && email.toLowerCase() === (SESSION.email||'').toLowerCase();
  var editLevel;
  if (role === 'master-admin') editLevel = 'full';
  else if (role === 'owner')   editLevel = 'owner';
  else if (role === 'admin')   editLevel = 'admin';
  else if (role === 'jd') editLevel = 'admin';   // jd = manager-equivalent
  else if (role === 'manager') editLevel = 'admin';
  else if (role === 'activator') editLevel = 'admin';   // manages people across their permitted offices
  else if (role === 'leader')    editLevel = 'leaderbasic';   // team leads: add/assign people + edit basics (no role/perms/status)
  else editLevel = 'selfphone';
  var canRole   = editLevel === 'full' || editLevel === 'owner';
  var canPerms  = editLevel === 'full' || editLevel === 'owner';
  var canStatus = editLevel === 'full' || editLevel === 'owner' || editLevel === 'admin';
  var canBasic  = editLevel !== 'selfphone';
  var fs = 'width:100%;padding:8px;border:1.5px solid var(--field-border);border-radius:6px;background:var(--field-bg);color:var(--text)';
  var ds = ';background:var(--field-bg);color:#999';
  var perms = (p.permissions || CFG.officeId).split(',').map(function(o){ return o.trim(); });
  var roleOpts = PORTAL_ROLES
    .filter(function(ro) { return editLevel !== 'owner' || ro !== 'master-admin'; })
    .map(function(ro) { return '<option value="'+ro+'"'+(ro===rank?' selected':'')+'>'+esc(_ROLE_LABELS[ro]||ro)+'</option>'; }).join('');
  var tableauOpts = '<option value="">— Not Assigned —</option>' +
    (PEOPLE_TABLEAU_NAMES||[]).map(function(n){ return '<option value="'+esc(n)+'"'+(n===(p.tableauName||'')?' selected':'')+'>'+esc(n)+'</option>'; }).join('');
  // Team = dropdown of the teams already created (DATA.teams). A former/stale team name that no
  // longer exists is kept as an extra option so editing doesn't silently blank it.
  var _pfTeams = Object.keys(DATA.teams||{}).map(function(tid){ return (DATA.teams[tid]||{}).name||''; }).filter(Boolean).sort(function(a,b){ return a.localeCompare(b); });
  var _pfCurTeam = p.team || '';
  var teamOpts = '<option value="">— No team —</option>' +
    _pfTeams.map(function(n){ return '<option value="'+esc(n)+'"'+(n===_pfCurTeam?' selected':'')+'>'+esc(n)+'</option>'; }).join('') +
    ((_pfCurTeam && _pfTeams.indexOf(_pfCurTeam)===-1) ? '<option value="'+esc(_pfCurTeam)+'" selected>'+esc(_pfCurTeam)+' (former team)</option>' : '');
  var officeChecks = Object.keys(OFFICE_NAMES).map(function(o){
    return '<label style="display:flex;align-items:center;gap:6px;margin:4px 0;font-size:.85rem"><input type="checkbox" value="'+o+'"'+(perms.indexOf(o)!==-1?' checked':'')+(canPerms?'':' disabled')+'>'+OFFICE_NAMES[o]+'</label>';
  }).join('');
  var isEdit = !!email;
  var lock = function(ok) { return ok ? '' : '<span style="font-size:.72rem;color:#aaa;font-weight:400;margin-left:6px">Read only</span>'; };
  var html = '';
  html += '<div class="field"><label>Name</label><input type="text" id="pf-name" value="'+esc(p.name||'')+'"'+(canBasic?'':' readonly')+' style="'+fs+(canBasic?'':ds)+'"></div>';
  html += '<div class="field"><label>Email</label><input type="email" id="pf-email" value="'+esc(email||'')+'"'+(isEdit?' readonly style="'+fs+ds+'"':' style="'+fs+'"')+'></div>';
  html += '<div class="field"><label>Phone</label><input type="text" id="pf-phone" value="'+esc(p.phone||'')+'" placeholder="e.g. 555-867-5309" style="'+fs+'"></div>';
  html += '<div class="field"><label>Role'+lock(canRole)+'</label><select id="pf-role"'+(canRole?'':' disabled')+' style="'+fs+(canRole?'':ds)+'">'+ roleOpts+'</select></div>';
  html += '<div class="field"><label>Team</label><select id="pf-team"'+(canBasic?'':' disabled')+' style="'+fs+(canBasic?'':ds)+'">'+teamOpts+'</select></div>';
  html += '<div class="field"><label>Tableau Name'+lock(canBasic)+'</label><select id="pf-tableau"'+(canBasic?'':' disabled')+' style="'+fs+(canBasic?'':ds)+'">'+tableauOpts+'</select></div>';
  html += '<div class="field"><label>Office Permissions'+lock(canPerms)+'</label><div id="pf-perms" style="padding:8px;border:1.5px solid var(--field-border);border-radius:6px'+(canPerms?'':';background:var(--field-bg)')+'">'+ officeChecks+'</div></div>';
  html += '<div class="field"><label>Status'+lock(canStatus)+'</label><select id="pf-status"'+(canStatus?'':' disabled')+' style="'+fs+(canStatus?'':ds)+'"><option value="false"'+(p.deactivated?'':' selected')+'>Active</option><option value="true"'+(p.deactivated?' selected':'')+'>Inactive</option></select></div>';
  html += '<div class="nm-actions"><button class="nm-add-btn" onclick="savePerson('+(isEdit?'\''+esc(email)+'\'':'null')+')">SAVE</button><button class="nm-close-btn" onclick="closeModal()">CANCEL</button></div>';
  return html;
}

function openAddPersonModal() {
  document.getElementById('modal-title').innerHTML = '<div class="nm-dsi">Add Person</div>';
  document.getElementById('modal-body').innerHTML = buildPersonForm(null, null);
  document.getElementById('detail-modal').classList.add('open');
}

function openEditPersonModal(email) {
  var person = (DATA.roster||{})[email]; if (!person) return;
  document.getElementById('modal-title').innerHTML = '<div class="nm-dsi">Edit Person</div><div class="nm-sub">'+esc(email)+'</div>';
  document.getElementById('modal-body').innerHTML = buildPersonForm(email, person);
  document.getElementById('detail-modal').classList.add('open');
}

function savePerson(existingEmail) {
  var emailVal  = document.getElementById('pf-email').value.trim().toLowerCase();
  var phone     = document.getElementById('pf-phone').value.trim();
  var role      = SESSION.role;
  var editLevel;
  if (role === 'master-admin') editLevel = 'full';
  else if (role === 'owner')   editLevel = 'owner';
  else if (role === 'admin')   editLevel = 'admin';
  else if (role === 'jd') editLevel = 'admin';   // jd = manager-equivalent
  else if (role === 'manager') editLevel = 'admin';
  else if (role === 'activator') editLevel = 'admin';   // manages people across their permitted offices
  else if (role === 'leader')    editLevel = 'leaderbasic';   // team leads: add/assign people + edit basics (no role/perms/status)
  else editLevel = 'selfphone';
  var canRole   = editLevel === 'full' || editLevel === 'owner';
  var canPerms  = editLevel === 'full' || editLevel === 'owner';
  var canStatus = editLevel === 'full' || editLevel === 'owner' || editLevel === 'admin';
  var canBasic  = editLevel !== 'selfphone';
  var existing  = existingEmail ? ((DATA.roster||{})[existingEmail] || {}) : {};
  var name        = canBasic  ? document.getElementById('pf-name').value.trim()    : (existing.name || '');
  var team        = canBasic  ? document.getElementById('pf-team').value.trim()    : (existing.team || '');
  var tableauName = canBasic  ? document.getElementById('pf-tableau').value        : (existing.tableauName || '');
  var deactivated = canStatus ? document.getElementById('pf-status').value==='true': (existing.deactivated || false);
  var rank        = canRole   ? document.getElementById('pf-role').value           : (existing.rank || 'client-rep');
  var checked     = canPerms  ? document.querySelectorAll('#pf-perms input[type=checkbox]:checked') : null;
  var permissions = canPerms
    ? (Array.from(checked).map(function(cb){ return cb.value; }).join(',') || CFG.officeId)
    : (existing.permissions || CFG.officeId);
  if (!emailVal) { alert('Email is required.'); return; }
  var body = { name:name, rank:rank, team:team, tableauName:tableauName, phone:phone, permissions:permissions, deactivated:deactivated };
  if (existingEmail) { body.action = 'updateRosterEntry'; body.email = existingEmail; }
  else               { body.action = 'addRosterEntry';    body.email = emailVal; }
  apiPost(body).then(function(res) {
    if (res.ok) { closeModal(); refreshData(); }
    else alert(res.error || 'Save failed.');
  }).catch(function(){ alert('Connection error.'); });
}

function deletePerson(email) {
  if (!confirm('Remove ' + email + ' from the roster? This cannot be undone.')) return;
  apiPost({ action:'deleteRosterEntry', email:email }).then(function(res) {
    if (res.ok) refreshData(); else alert(res.error||'Delete failed.');
  });
}

// Admin password reset: blanks the person's stored hash so they create a new
// password on their next sign-in. The account has no password in between, so the
// first person to enter that email sets the new one — do it when they're ready.
function resetPersonPassword(email) {
  var person = (DATA.roster || {})[email] || {};
  var who = person.name || email;
  if (!confirm('Reset the password for ' + who + '?\n\n'
    + '• Their current password/PIN stops working right away.\n'
    + '• They create a new password the next time they sign in.\n\n'
    + 'Do this when they are ready to log in — until they set a new one, whoever '
    + 'enters their email first can set it.')) return;
  apiPost({ action:'resetUserPin', email:email }).then(function(res) {
    if (res && res.ok) alert('✅ Password reset for ' + who + '.\nThey will set a new password on their next sign-in.');
    else alert((res && res.error) ? ('Could not reset: ' + res.error) : 'Could not reset the password. Try again.');
  }).catch(function() { alert('Connection error. Try again.'); });
}

// Shared empty-state. noData(msg) still works; pass opts for polish:
//   {icon:'<sprite id>'}  — contextual glyph (default 'inbox')
//   {sub:'…'}             — a lighter explanatory line under the message
//   {action:'<html>'}     — an optional call-to-action (raw HTML, e.g. a button)
function noData(msg, opts) {
  opts = opts || {};
  var sub = opts.sub ? '<div class="empty-sub">'+esc(opts.sub)+'</div>' : '';
  var action = opts.action ? '<div class="empty-action">'+opts.action+'</div>' : '';
  return '<div class="card"><div class="card-body"><div class="empty-state">'+
    '<div class="empty-ico">'+icon(opts.icon||'inbox')+'</div>'+
    '<div class="empty-msg">'+esc(msg)+'</div>'+sub+action+'</div></div></div>';
}

// ── TEAMS TAB ─────────────────────────────────────────────────────────────
var _TM_VIEW = 'list';
var _TM_DETAIL_ID = null;
var _TM_LDR_VIEW = 'days';
var _TM_ORD = { rep:'', status:'', from:'', to:'' };   // Team Orders filters
var _TM_EMOJIS = [
  '🦁','🐯','🐻','🐼','🦊','🐺','🐗','🦝','🦡','🦏','🐘','🦍','🐆','🐅','🐃','🦬',
  '🦅','🦆','🦉','🦚','🦜','🦩','🐦','🦃','🐓','🦤','🪶',
  '🦈','🐬','🐊','🐢','🦂','🦕','🦖','🐉','🐲','🦋','🦗','🕷️','🦟',
  '🏆','🥇','🥈','🥉','🎖️','🏅','🎗️','👑','💎','♠️','♣️','♦️','♥️','🃏','🎴',
  '⚔️','🛡️','🏹','🗡️','🔱','🪃','🥊','🥋','👊','💪','🤜','🦾',
  '⚡','🔥','💥','💣','🌪️','❄️','🌊','🌋','🏔️','☄️','🌀',
  '🚀','🛸','🌙','☀️','⭐','🌟','💫','✨','🌈','🪐','🔭','🛰️',
  '🔮','🪄','🧿','🧲','⚗️','🧪','🔯',
  '🤖','🧠','💻','📡','🔬','⚙️','🔧','🔑','🗝️',
  '🎯','💯','🎭','🎬','🎵','🎸','🥁','🎺','🎻','🎮',
  '🌺','🌸','🍀','🌿','🪸','🌴','🍁','🌾',
  '🏄','🏋️','🤸','⛷️','🏇','🚴','🧗','🤺','🏊','🎽',
  '🏈','⚽','🏀','🎾','⚾','🏒','🎱','🏓','🥏','🏹',
  '🦄','🐲','💀','👻','🤡','🎪','🎠','🃏','🌑','🕶️',
];

// ── Sub-team visibility ───────────────────────────────────────────────────
// A team can be "split off" another via its Parent Team. The leader of the
// PARENT gets full visibility into that child team — and the child's children,
// recursively — from the Teams tab.
//
// Members / leaderboard / breakdown / AR / churn already work for any team
// (those payloads are office-wide). Only the master-tracker pieces — Team
// Orders and the pending/issue/cancel tiles — are scoped to the one team a
// leader leads, so those are fetched per sub-team from readTeamOrders, which
// re-checks the same parent→child rule server-side.
var _TM_ORDERS = {};        // teamId -> orders[] fetched for a sub-team
var _TM_ORD_LOADING = {};   // teamId -> true while that fetch is in flight

function _tmTeamsLedByMe() {
  var teams = DATA.teams || {}, me = (SESSION.email || '').toLowerCase(), ids = [];
  Object.keys(teams).forEach(function(tid) {
    if (String(teams[tid].leaderId || '').trim().toLowerCase() === me) ids.push(tid);
  });
  return ids;
}
// Walk parentId downward from rootIds. Returns a {teamId:true} set INCLUDING
// the roots. Cycle-safe: `out` is the visited set, and the guard caps total
// iterations so a self-referential parentId can't spin the browser.
function _tmDescendantIds(rootIds) {
  var teams = DATA.teams || {}, out = {}, queue = [];
  (rootIds || []).forEach(function(id) { if (id && !out[id]) { out[id] = true; queue.push(id); } });
  var guard = 0;
  while (queue.length && guard++ < 500) {
    var cur = queue.shift();
    Object.keys(teams).forEach(function(tid) {
      if (out[tid]) return;
      if (String(teams[tid].parentId || '').trim() === cur) { out[tid] = true; queue.push(tid); }
    });
  }
  return out;
}
// True when this team's orders are NOT in the user's own DATA.masterTracker:
// i.e. a team below one they lead. Office-wide roles already have everything,
// and the team they lead themselves is already in their payload.
function _tmIsSubTeam(teamId) {
  var role = SESSION.role;
  if (role !== 'leader' && role !== 'client-rep') return false;
  var led = _tmTeamsLedByMe();
  if (led.indexOf(teamId) !== -1) return false;
  return !!_tmDescendantIds(led)[teamId];
}
// Order source for a team's detail: the fetched sub-team payload when we have
// one, else the user's own (already correctly scoped) master tracker.
function _tmOrderSource(teamId) {
  return _TM_ORDERS[teamId] || DATA.masterTracker || [];
}
// True while a sub-team's orders are still on the wire — the detail renders
// the order-derived sections as "loading" rather than as a truthful-looking 0.
function _tmOrdersPending(teamId) {
  return _tmIsSubTeam(teamId) && !_TM_ORDERS[teamId];
}
function _tmEnsureOrders(teamId) {
  if (!_tmIsSubTeam(teamId) || _TM_ORDERS[teamId] || _TM_ORD_LOADING[teamId]) return;
  _TM_ORD_LOADING[teamId] = true;
  api({ action:'readTeamOrders', teamId:teamId }).then(function(res) {
    _TM_ORD_LOADING[teamId] = false;
    _TM_ORDERS[teamId] = (res && res.orders) ? res.orders : [];
    if (CURRENT_TAB === 'teams' && _TM_VIEW === 'detail' && _TM_DETAIL_ID === teamId) {
      var c = document.getElementById('main-content');
      if (c) c.innerHTML = _tmBuildDetail(teamId);
    }
  }).catch(function() {
    _TM_ORD_LOADING[teamId] = false;
    _TM_ORDERS[teamId] = [];   // stop retrying; the sections render empty
  });
}

function renderTeamsTab() {
  var c = document.getElementById('main-content');
  function doRender() {
    c.innerHTML = (_TM_VIEW === 'detail' && _TM_DETAIL_ID) ? _tmBuildDetail(_TM_DETAIL_ID) : _tmBuildList();
  }
  if (_LST_SALES !== null) { doRender(); return; }
  c.innerHTML = skelLoader();
  api({ action:'readPostedSales', officeId:CFG.officeId }).then(function(res) {
    _LST_POSTED = res.sales || []; _LST_SALES = _LST_POSTED.concat(_lstLegacyRows());   // legacy re-merged in _applyMainData once DATA is ready
    if (CURRENT_TAB === 'teams') doRender();
  }).catch(function() {
    if (CURRENT_TAB === 'teams') c.innerHTML = noData('Failed to load sales data.');
  });
}

function _tmBuildList() {
  var teams  = DATA.teams  || {};
  var roster = DATA.roster || {};
  var role = SESSION.role;
  var canManage = ['master-admin','owner','admin','manager','jd'].indexOf(role) !== -1;   // jd can create/manage teams
  var teamArr = Object.keys(teams).map(function(k){ return teams[k]; });
  teamArr.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  // Client reps see ONLY their own team — plus any team that split off one they
  // LEAD (a rep-ranked team lead), so the sub-team is reachable to click into.
  if (role === 'client-rep') {
    var _myTeam = ((roster[(SESSION.email||'').toLowerCase()])||{}).team || '';
    var _visIds = _tmDescendantIds(_tmTeamsLedByMe());
    teamArr = teamArr.filter(function(t){ return t && (t.name === _myTeam || _visIds[t.teamId]); });
    if (!teamArr.length) return '<div class="card"><div class="card-body"><div class="empty">You&rsquo;re not on a team yet.</div></div></div>';
  }

  // Member counts
  var memberCounts = {};
  Object.keys(roster).forEach(function(email) {
    var r = roster[email]; if (r.deactivated) return;
    Object.keys(teams).forEach(function(tid) {
      if (teams[tid].name === r.team) memberCounts[tid] = (memberCounts[tid]||0)+1;
    });
  });

  // This-week units per team
  var weekUnits = {};
  var ws = _lstWeekStart(); var DAY_MS = 86400000;
  (_LST_SALES||[]).forEach(function(s) {
    if (!s.dateOfSale) return;
    var d = new Date(s.dateOfSale+'T12:00:00'); d.setHours(0,0,0,0);
    if (d < ws) return;
    var r = roster[s.repEmail]; if (!r) return;
    Object.keys(teams).forEach(function(tid) {
      if (teams[tid].name === r.team) weekUnits[tid] = (weekUnits[tid]||0)+(Number(s.units)||0);
    });
  });

  var createBtn = canManage ? '<button class="refresh-btn" style="margin-left:8px" onclick="openCreateTeamModal()">+ Create Team</button>' : '';

  if (!teamArr.length) {
    return '<div class="card"><div class="card-body">' +
      '<div class="tm-header"><div><div class="tm-title">Teams</div><div class="tm-count">0 teams</div></div>'+createBtn+'</div>' +
      '<hr class="tm-hr"><div class="empty">No teams yet.'+(canManage?' Click &ldquo;+ Create Team&rdquo; to get started.':'')+' </div>' +
      '</div></div>';
  }

  var rows = teamArr.map(function(team) {
    var leader = team.leaderId ? (roster[team.leaderId]||{}) : {};
    var leaderName = leader.name || team.leaderId || '—';
    var leaderRole = leader.rank ? (_ROLE_LABELS[leader.rank]||leader.rank) : '';
    var cnt  = memberCounts[team.teamId]||0;
    var units = weekUnits[team.teamId]||0;
    var uColor = units>=10?'#4ade80':units>=5?'#fbbf24':units>0?'#94a3b8':'#6b7280';
    var parent = team.parentId && teams[team.parentId] ? '<span class="tm-parent-tag">'+icon('corner-down-right')+' '+esc(teams[team.parentId].name)+'</span>' : '';
    var acts = canManage ?
      '<td class="tm-act-cell"><button class="tm-btn-edit" onclick="openEditTeamModal(\''+esc(team.teamId)+'\')">EDIT</button><button class="tm-btn-del" onclick="_tmDelete(\''+esc(team.teamId)+'\',\''+esc(team.name)+'\')">DEL</button></td>' :
      '<td></td>';
    return '<tr>' +
      '<td class="tm-name-cell"><span class="tm-emoji-col">'+(team.emoji||'👥')+'</span><button class="tm-name-link" onclick="_tmShowDetail(\''+esc(team.teamId)+'\')">'+esc(team.name)+'</button>'+parent+'</td>' +
      '<td class="tm-leader-cell">'+esc(leaderName)+(leaderRole?' <span class="tm-role-tag">('+esc(leaderRole)+')</span>':'')+'</td>' +
      '<td class="tm-num-cell">'+cnt+'</td>' +
      '<td class="tm-num-cell"><span style="color:'+uColor+';font-weight:700">'+units+'</span></td>' +
      acts+'</tr>';
  }).join('');

  return '<div class="card"><div class="card-body">' +
    '<div class="tm-header"><div><div class="tm-title">Teams</div><div class="tm-count">'+teamArr.length+' team'+(teamArr.length!==1?'s':'')+'</div></div>'+createBtn+'</div>' +
    '<hr class="tm-hr">' +
    '<div class="tbl-wrap"><table class="tm-table"><thead><tr>' +
    '<th>TEAM</th><th>LEADER</th><th class="tm-num-hdr">MEMBERS</th><th class="tm-num-hdr">UNITS (WK)</th>'+(canManage?'<th class="tm-act-hdr">ACTIONS</th>':'') +
    '</tr></thead><tbody>'+rows+'</tbody></table></div>' +
    '</div></div>';
}

function _tmShowDetail(teamId) {
  _TM_VIEW = 'detail'; _TM_DETAIL_ID = teamId; _TM_LDR_VIEW = 'days';
  _TM_ORD = { rep:'', status:'', from:'', to:'' };   // fresh Team Orders filters per team
  _tmEnsureOrders(teamId);   // sub-team of a team I lead → pull its orders, then re-render
  document.getElementById('main-content').innerHTML = _tmBuildDetail(teamId);
}

function _tmBackToList() {
  _TM_VIEW = 'list'; _TM_DETAIL_ID = null;
  document.getElementById('main-content').innerHTML = _tmBuildList();
}

function _tmSetLdrView(v) {
  _TM_LDR_VIEW = v;
  var t1 = document.getElementById('tm-ldr-days-btn');
  var t2 = document.getElementById('tm-ldr-weeks-btn');
  if (t1) { t1.className = 'lst-toggle-btn'+(v==='days'?' active':''); }
  if (t2) { t2.className = 'lst-toggle-btn'+(v==='weeks'?' active':''); }
  var wrap = document.getElementById('tm-ldr-wrap');
  if (wrap) wrap.innerHTML = _tmLdrTable(_TM_DETAIL_ID);
}

function _tmBuildDetail(teamId) {
  var teams = DATA.teams||{}; var team = teams[teamId];
  if (!team) return noData('Team not found.');
  var roster = DATA.roster||{};
  var DAY_MS = 86400000;

  // Members
  var memberEmails = Object.keys(roster).filter(function(e){ return !roster[e].deactivated && roster[e].team===team.name; });
  var memberTabs   = memberEmails.map(function(e){ return (roster[e].tableauName||'').toLowerCase(); }).filter(Boolean);

  // ── Rolling 4-week (28-day) unit avg + recent-7-day trend (from _LST_SALES) ──
  // Rolling window ending TODAY (not fixed calendar weeks): sum the team's units over
  // the last 28 days and divide by 4 = avg units/week. The 7-day total drives Remarks.
  var today = new Date(); today.setHours(0,0,0,0);
  var t0 = today.getTime();
  var win28 = t0 - 28*DAY_MS, win7 = t0 - 7*DAY_MS;
  var u28 = 0, u7 = 0;
  (_LST_SALES||[]).forEach(function(s) {
    if (!s.dateOfSale || memberEmails.indexOf(s.repEmail)===-1) return;
    var d = new Date(s.dateOfSale+'T12:00:00'); d.setHours(0,0,0,0);
    var t = d.getTime(); if (t > t0) return;
    var u = Number(s.units)||0;
    if (t > win28) u28 += u;
    if (t > win7)  u7  += u;
  });
  var fourWkAvg = u28/4;
  var vsPct = fourWkAvg>0 ? (u7-fourWkAvg)/fourWkAvg*100 : (u7>0?100:0);

  var trendLabel,trendCls;
  if      (vsPct>=20) { trendLabel='Strong upward trend'; trendCls='tm-trend-up'; }
  else if (vsPct>=5)  { trendLabel='Slight upward trend'; trendCls='tm-trend-up'; }
  else if (vsPct<=-20){ trendLabel='Declining trend';     trendCls='tm-trend-down'; }
  else if (vsPct<=-5) { trendLabel='Slight decline';      trendCls='tm-trend-down'; }
  else                { trendLabel='Steady performance';  trendCls='tm-trend-flat'; }

  // ── Rolling 30-day Pending & Cancel rates (master tracker). Window ENDS 2 days ago
  // (buffer for statuses to settle) and goes 30 days back: orderDate in [t0-32d, t0-2d]. ──
  var wEnd = t0 - 2*DAY_MS, wStart = wEnd - 30*DAY_MS;
  var wTot=0, wPend=0, wIssue=0, wCanc=0;
  _tmOrderSource(teamId).forEach(function(o) {
    if (memberTabs.indexOf((o.rep||'').toLowerCase())===-1) return;
    var od = String(o.orderDate||''); if (!/^\d{4}-\d{2}-\d{2}/.test(od)) return;
    var dt = new Date(od.slice(0,10)+'T12:00:00'); dt.setHours(0,0,0,0);
    var t = dt.getTime(); if (t < wStart || t > wEnd) return;
    // Count LINES per status (statusCounts = per-line DTR_STATUS counts). Order issues
    // (isIssueStatus) are broken out of pending, mirroring the rep Line Stats.
    var sc = o.statusCounts||{};
    Object.keys(sc).forEach(function(st){
      var c = sc[st]||0, sl = String(st).toLowerCase();
      wTot += c;
      if (sl.indexOf('cancel')!==-1) wCanc += c;
      else if (isIssueStatus(sl)) wIssue += c;
      else if (sl!=='active' && sl!=='posted' && sl!=='approved' && sl.indexOf('disco')===-1) wPend += c;
    });
  });
  // A sub-team's orders arrive on a second request; show "…" rather than a
  // truthful-looking 0% while they're still in flight.
  var _ordPend = _tmOrdersPending(teamId);
  function _rate(n) { return _ordPend ? '…' : (wTot ? Math.round(n/wTot*100) : 0) + '%'; }
  var pendRate = _rate(wPend), issueRate = _rate(wIssue), cancRate = _rate(wCanc);

  // Churn data (team) — used by the churn section below
  var churnRows=(DATA.churnReport||[]).filter(function(r){ return memberTabs.indexOf((r.rep||'').toLowerCase())!==-1; });
  var churnBuilt=_buildChurnRepMap(churnRows,'');

  var hdr = '<div class="tm-back" onclick="_tmBackToList()">'+icon('arrow-left')+' Teams</div>' +
    '<div class="tm-detail-hdr"><span class="tm-detail-em">'+(team.emoji||'👥')+'</span><span class="tm-detail-nm">'+esc(team.name)+'</span></div>';

  var breakdown = '<div class="tm-section-label">TEAM BREAKDOWN</div>' +
    '<div class="tm-breakdown-row">' +
    '<div class="tm-remarks-card '+trendCls+'">' +
    '<div class="tm-remarks-label">REMARKS</div>' +
    '<div class="tm-remarks-trend">'+esc(trendLabel)+'</div>' +
    '<div class="tm-remarks-sub">Last 7d: '+u7+' units · 4-wk avg '+fourWkAvg.toFixed(1)+'/wk</div>' +
    '</div>' +
    '<div class="tm-stat-pill"><span class="tm-stat-val">'+fourWkAvg.toFixed(1)+'</span><div class="tm-stat-lbl">4-WK AVG · UNITS/WK</div></div>' +
    '<div class="tm-stat-pill"><span class="tm-stat-val" style="color:#fb923c">'+pendRate+'</span><div class="tm-stat-lbl">PENDING · 30D</div></div>' +
    '<div class="tm-stat-pill"><span class="tm-stat-val" style="color:#fbbf24">'+issueRate+'</span><div class="tm-stat-lbl">ORDER ISSUES · 30D</div></div>' +
    '<div class="tm-stat-pill"><span class="tm-stat-val" style="color:#f87171">'+cancRate+'</span><div class="tm-stat-lbl">CANCEL · 30D</div></div>' +
    '</div>';

  // Activation Rates + Churn — the SAME full tables as the main tabs, filtered to the team.
  // Wrapped in .tm-rate-wrap so the bucket headers center over the badge cells (matches tabs).
  var arSec = '<div class="tm-section-label">ACTIVATION RATES</div><div class="tm-rate-wrap">' + _tmArTableHtml(memberTabs) + '</div>';
  // Team view shows just the TEAM TOTAL row (empty repList); drill into a rep via the
  // leaderboard for their individual churn/AR.
  var churnSec = '<div class="tm-section-label">CHURN</div><div class="tm-rate-wrap">' +
    _churnTableHtml([], {}, churnBuilt.repList, churnBuilt.repMap).replace('>Grand Total<','>Team Total<') + '</div>';

  var ldrSec = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
    '<div class="tm-section-label" style="margin:0;border:none">TEAM LEADERBOARD</div>' +
    '<div class="lst-toggle-row">' +
    '<button id="tm-ldr-days-btn" class="lst-toggle-btn'+(_TM_LDR_VIEW==='days'?' active':'')+'" onclick="_tmSetLdrView(\'days\')">DAYS</button>' +
    '<button id="tm-ldr-weeks-btn" class="lst-toggle-btn'+(_TM_LDR_VIEW==='weeks'?' active':'')+'" onclick="_tmSetLdrView(\'weeks\')">WEEKS</button>' +
    '</div></div>' +
    '<div id="tm-ldr-wrap">'+_tmLdrTable(teamId)+'</div>';

  var ordSec = '<div class="tm-section-label">TEAM ORDERS</div>' + _tmOrdersHtml(teamId);

  return hdr+'<div class="card"><div class="card-body tm-detail-body">'+breakdown+arSec+churnSec+ldrSec+ordSec+'</div></div>';
}

// Team Activation Rates — same coloring/structure as the main AR tab (_buildArTable),
// but filtered to an arbitrary team's tableau names (the main one keys off the logged-in
// user's role/team, so it can't render a team you're just viewing).
function _tmArTableHtml(memberTabs) {
  if (_AR_LINES === null) { _preloadArLines(); return '<div class="empty">Loading activation rates…</div>'; }
  if (!_AR_LINES.length)  return '<div class="empty">No activation rate data.</div>';
  var BKT_MAP = { '0-7 Days':'b0_7', '8-14 Days':'b8_14', '15-30 Days':'b15_30', '31-60 Days':'b31_60' };
  var lines = _AR_LINES.filter(function(l){ return memberTabs.indexOf(String(l.rep||'').trim().toLowerCase()) !== -1; });
  if (!lines.length) return '<div class="empty">No activation rate data for this team.</div>';
  // Team view = team TOTAL only (drill into a rep via the leaderboard for per-rep AR).
  var totals = {b0_7:{t:0,a:0},b8_14:{t:0,a:0},b15_30:{t:0,a:0},b31_60:{t:0,a:0}};
  lines.forEach(function(l){
    var b=BKT_MAP[l.bucket]; if(!b) return;
    totals[b].t+=(l.vol||0); totals[b].a+=(l.acts||0);
  });
  function bktCls(bk,pct){
    if(bk==='b0_7')   return pct>=21?'ar-green':pct>=10?'ar-yellow':'ar-red';
    if(bk==='b8_14')  return pct>=71?'ar-green':pct>=51?'ar-yellow':'ar-red';
    if(bk==='b15_30') return pct>=75?'ar-green':pct>=70?'ar-yellow':'ar-red';
    if(bk==='b31_60') return pct>=86?'ar-green':pct>=79?'ar-yellow':'ar-red';
    return pct>=80?'ar-green':pct>=60?'ar-yellow':'ar-red';
  }
  function arColorCls(c){ c=String(c||'').toLowerCase(); return c==='green'?'ar-green':c==='yellow'?'ar-yellow':c==='red'?'ar-red':''; }
  var arCuts={};
  (_AR_LINES||[]).forEach(function(l){
    var bk=BKT_MAP[l.bucket]; if(!bk||!l.vol) return;
    var p=Math.round(l.acts/l.vol*100), cc=String(l.color||'').toLowerCase();
    if(!arCuts[bk]) arCuts[bk]={greenMin:Infinity,redMax:-Infinity};
    if(cc==='green'&&p<arCuts[bk].greenMin) arCuts[bk].greenMin=p;
    if(cc==='red'&&p>arCuts[bk].redMax) arCuts[bk].redMax=p;
  });
  function arTotalCls(bk,pct){
    var c=arCuts[bk];
    if(c&&c.greenMin!==Infinity&&c.redMax!==-Infinity&&c.redMax<c.greenMin){
      if(pct>=c.greenMin) return 'ar-green';
      if(pct<=c.redMax) return 'ar-red';
      return 'ar-yellow';
    }
    return bktCls(bk,pct);
  }
  function cell(b,bk,isTotal){
    if(!isTotal&&b.t===0) return '<td></td>';
    if(b.t===0) return '<td class="ar-cell"><div class="ar-badge ar-blue">(0/0)<br>—</div></td>';
    var pct=Math.round(b.a/b.t*100);
    var cls=isTotal?arTotalCls(bk,pct):(arColorCls(b.color)||bktCls(bk,pct));
    return '<td class="ar-cell"><div class="ar-badge '+cls+'">('+b.a+'/'+b.t+')<br>'+pct+'%</div></td>';
  }
  var grandRow='<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Team Total</td>'+cell(totals.b0_7,'b0_7',true)+cell(totals.b8_14,'b8_14',true)+cell(totals.b15_30,'b15_30',true)+cell(totals.b31_60,'b31_60',true)+'</tr>';
  return '<div class="tbl-wrap"><table class="call-table"><thead><tr><th>Rep</th><th>0–7 Days</th><th>8–14 Days</th><th>15–30 Days</th><th>31–60 Days</th></tr></thead><tbody>'+grandRow+'</tbody></table></div>';
}

// Team Orders — all the team's orders from the Tableau order log (60-day window),
// filterable by Rep / Status / Date. Order-grouped (one row per DSI).
function _tmOrdersHtml(teamId) {
  var team = (DATA.teams||{})[teamId]; if (!team) return '';
  if (_tmOrdersPending(teamId)) return '<div class="empty">Loading team orders…</div>';
  var roster = DATA.roster||{};
  var memberTabs = Object.keys(roster)
    .filter(function(e){ return !roster[e].deactivated && roster[e].team===team.name; })
    .map(function(e){ return (roster[e].tableauName||'').toLowerCase(); }).filter(Boolean);
  var orders = _tmOrderSource(teamId).filter(function(o){ return memberTabs.indexOf((o.rep||'').toLowerCase())!==-1; });

  var reps={}, stats={};
  orders.forEach(function(o){
    if(o.rep) reps[o.rep]=true;
    Object.keys(o.statusCounts||{}).forEach(function(s){ if(s) stats[s]=true; });
  });
  var repOpts='<option value="">All reps</option>'+Object.keys(reps).sort().map(function(r){return '<option value="'+esc(r)+'"'+(_TM_ORD.rep===r?' selected':'')+'>'+esc(r)+'</option>';}).join('');
  var statOpts='<option value="">All statuses</option>'+Object.keys(stats).sort().map(function(s){return '<option value="'+esc(s)+'"'+(_TM_ORD.status===s?' selected':'')+'>'+esc(s)+'</option>';}).join('');

  var rows = orders.filter(function(o){
    if(_TM_ORD.rep && o.rep!==_TM_ORD.rep) return false;
    if(_TM_ORD.status && !((o.statusCounts||{})[_TM_ORD.status])) return false;
    var od=String(o.orderDate||'').slice(0,10);
    if(_TM_ORD.from && od < _TM_ORD.from) return false;
    if(_TM_ORD.to   && od > _TM_ORD.to)   return false;
    return true;
  }).slice().sort(_byOrderDateDesc);

  var body = rows.length ? rows.map(function(o){
    var nc=((DATA.notes||{})[o.dsi]||[]).length, sid=String(o.dsi||'').replace(/\W/g,'_');
    return '<tr>'+
      '<td><span class="rep-name">'+esc(o.rep)+'</span></td>'+
      '<td>'+esc(o.dsi)+'</td>'+
      '<td>'+esc(o.orderDate)+'</td>'+
      '<td>'+productBreakdown(o.productCounts,false)+'</td>'+
      '<td>'+statusBreakdown(o.statusCounts,false)+'</td>'+
      '<td><button class="notes-btn'+(nc>0?' has-notes':'')+'" data-dsi="'+esc(o.dsi)+'" onclick="openNotesModal(\''+esc(o.dsi)+'\',\''+esc(o.spe||'')+'\',\''+esc(o.rep)+'\')">NOTES'+(nc>0?'<span class="notes-count" id="nc-'+sid+'">'+nc+'</span>':'')+'</button></td>'+
    '</tr>';
  }).join('') : '<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--text2)">No orders match these filters.</td></tr>';

  var anyFilter = _TM_ORD.rep||_TM_ORD.status||_TM_ORD.from||_TM_ORD.to;
  var cS='width:auto;min-width:140px;max-width:220px';
  var filters='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">'+
    '<select class="ps-select" style="'+cS+'" onchange="_tmOrdSet(\'rep\',this.value)">'+repOpts+'</select>'+
    '<select class="ps-select" style="'+cS+'" onchange="_tmOrdSet(\'status\',this.value)">'+statOpts+'</select>'+
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(_TM_ORD.from)+'" onchange="_tmOrdSet(\'from\',this.value)" title="From date">'+
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(_TM_ORD.to)+'" onchange="_tmOrdSet(\'to\',this.value)" title="To date">'+
    (anyFilter?'<button class="lst-toggle-btn" onclick="_tmOrdClear()">Clear</button>':'')+
    '</div>';

  return '<div id="tm-ord-wrap">'+filters+
    '<div class="tbl-wrap"><table class="call-table"><thead><tr><th>Rep</th><th>DSI</th><th>Date</th><th>Products</th><th>Status</th><th>Notes</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div style="font-size:11px;color:var(--text2);margin-top:8px">'+rows.length+' order'+(rows.length!==1?'s':'')+' · last 60 days</div></div>';
}
function _tmOrdSet(field, val){ _TM_ORD[field]=val; _tmOrdRerender(); }
function _tmOrdClear(){ _TM_ORD={rep:'',status:'',from:'',to:''}; _tmOrdRerender(); }
function _tmOrdRerender(){
  var w=document.getElementById('tm-ord-wrap'); if(!w||!_TM_DETAIL_ID) return;
  w.outerHTML=_tmOrdersHtml(_TM_DETAIL_ID);
}

function _tmLdrTable(teamId) {
  var teams=DATA.teams||{}; var team=teams[teamId]; if(!team) return '';
  var roster=DATA.roster||{};
  var emails=Object.keys(roster).filter(function(e){ return !roster[e].deactivated&&roster[e].team===team.name; });
  return _TM_LDR_VIEW==='days' ? _tmLdrDays(emails,roster) : _tmLdrWeeks(emails,roster);
}

function _tmLdrDays(emails, roster) {
  var ws=_lstWeekStart(); var DAY_MS=86400000;
  var today=new Date(); today.setHours(0,0,0,0);
  var todayIdx=Math.min(6,Math.floor((today.getTime()-ws.getTime())/DAY_MS));
  var days=['MON','TUE','WED','THU','FRI','SAT','SUN'];

  var agg={};
  emails.forEach(function(e){ var r=roster[e]; agg[e]={name:r.name||e,rank:r.rank||'client-rep',days:[0,1,2,3,4,5,6].map(function(){ return {o:0,u:0}; })}; });
  (_LST_SALES||[]).forEach(function(s){
    if(!s.dateOfSale||!agg[s.repEmail]) return;
    var d=new Date(s.dateOfSale+'T12:00:00'); d.setHours(0,0,0,0); if(d<ws) return;
    var idx=Math.floor((d.getTime()-ws.getTime())/DAY_MS); if(idx<0||idx>6) return;
    agg[s.repEmail].days[idx].o++; agg[s.repEmail].days[idx].u+=Number(s.units)||0;
  });
  var sorted=emails.slice().sort(function(a,b){
    var au=agg[a].days.reduce(function(s,d){return s+d.u;},0);
    var bu=agg[b].days.reduce(function(s,d){return s+d.u;},0);
    return bu-au;
  });
  var totDays=[0,1,2,3,4,5,6].map(function(i){ var o=0,u=0; emails.forEach(function(e){o+=agg[e].days[i].o;u+=agg[e].days[i].u;}); return {o:o,u:u}; });

  function uCls(u,past){ if(!past)return 'lst-u-grey'; return u>=3?'lst-u-green':u===2?'lst-u-yellow':u===1?'lst-u-orange':'lst-u-red'; }

  var hdCols=days.map(function(d,i){ return '<th colspan="2" class="tm-day-hdr">'+d+'</th>'; }).join('');
  var subCols=days.map(function(){ return '<th class="tm-sub-hdr">ORD</th><th class="tm-sub-hdr">UNITS</th>'; }).join('');

  var repRows=sorted.map(function(e,idx){
    var a=agg[e];
    var dayCells=a.days.map(function(day,i){
      var past=i<=todayIdx;
      return '<td class="tm-day-cell">'+(past?day.o:'—')+'</td>' +
             '<td class="tm-day-cell tm-unit-cell '+uCls(day.u,past)+'">'+(past?day.u:'—')+'</td>';
    }).join('');
    return '<tr><td class="tm-ldr-rank">'+(idx+1)+'</td>' +
      '<td class="tm-ldr-name-cell"><span class="tm-ldr-name" onclick="_lstShowRepProfile(\''+esc(e)+'\')">'+esc(a.name)+'</span>' +
      '<div class="lst-rep-role">'+esc(_LST_RNKL[a.rank]||a.rank)+'</div></td>'+dayCells+'</tr>';
  }).join('');

  var totCells=totDays.map(function(day,i){ var past=i<=todayIdx; return '<td class="tm-day-cell"><b>'+(past?day.o:'—')+'</b></td><td class="tm-day-cell tm-unit-cell"><b>'+(past?day.u:'—')+'</b></td>'; }).join('');
  var totRow='<tr class="tm-total-row"><td></td><td class="tm-ldr-name-cell" style="font-weight:700;font-size:.8rem">TEAM TOTAL</td>'+totCells+'</tr>';

  return '<div class="tbl-wrap"><table class="tm-ldr-table"><thead><tr><th></th><th>NAME</th>'+hdCols+'</tr><tr><th></th><th></th>'+subCols+'</tr></thead><tbody>'+repRows+totRow+'</tbody></table></div>';
}

function _tmLdrWeeks(emails, roster) {
  var ws=_lstWeekStart(); var DAY_MS=86400000;
  var WK=['This Wk','Last Wk','2 Wks Ago','3 Wks Ago'];
  var agg={};
  emails.forEach(function(e){ var r=roster[e]; agg[e]={name:r.name||e,rank:r.rank||'client-rep',wks:[{o:0,u:0},{o:0,u:0},{o:0,u:0},{o:0,u:0}]}; });
  (_LST_SALES||[]).forEach(function(s){
    if(!s.dateOfSale||!agg[s.repEmail]) return;
    var d=new Date(s.dateOfSale+'T12:00:00'); d.setHours(0,0,0,0);
    var wi=d>=ws?0:Math.floor((ws.getTime()-d.getTime())/DAY_MS/7)+1;
    if(wi<0||wi>3) return;
    agg[s.repEmail].wks[wi].o++; agg[s.repEmail].wks[wi].u+=Number(s.units)||0;
  });
  var sorted=emails.slice().sort(function(a,b){ return agg[b].wks[0].u-agg[a].wks[0].u||agg[b].wks[0].o-agg[a].wks[0].o; });
  var totWks=[0,1,2,3].map(function(w){ var o=0,u=0; emails.forEach(function(e){o+=agg[e].wks[w].o;u+=agg[e].wks[w].u;}); return {o:o,u:u}; });

  var hdCols=WK.map(function(l){ return '<th colspan="2" class="tm-day-hdr">'+l+'</th>'; }).join('');
  var subCols=WK.map(function(){ return '<th class="tm-sub-hdr">ORD</th><th class="tm-sub-hdr">UNITS</th>'; }).join('');
  var repRows=sorted.map(function(e,idx){
    var a=agg[e];
    var wkCells=a.wks.map(function(wk){ return '<td class="tm-day-cell">'+wk.o+'</td><td class="tm-day-cell">'+wk.u+'</td>'; }).join('');
    return '<tr><td class="tm-ldr-rank">'+(idx+1)+'</td>' +
      '<td class="tm-ldr-name-cell"><span class="tm-ldr-name" onclick="_lstShowRepProfile(\''+esc(e)+'\')">'+esc(a.name)+'</span>' +
      '<div class="lst-rep-role">'+esc(_LST_RNKL[a.rank]||a.rank)+'</div></td>'+wkCells+'</tr>';
  }).join('');
  var totCells=totWks.map(function(wk){ return '<td class="tm-day-cell"><b>'+wk.o+'</b></td><td class="tm-day-cell"><b>'+wk.u+'</b></td>'; }).join('');
  var totRow='<tr class="tm-total-row"><td></td><td class="tm-ldr-name-cell" style="font-weight:700;font-size:.8rem">TEAM TOTAL</td>'+totCells+'</tr>';

  return '<div class="tbl-wrap"><table class="tm-ldr-table"><thead><tr><th></th><th>NAME</th>'+hdCols+'</tr><tr><th></th><th></th>'+subCols+'</tr></thead><tbody>'+repRows+totRow+'</tbody></table></div>';
}

function openCreateTeamModal() {
  document.getElementById('modal-title').innerHTML = '<div class="nm-dsi">Create Team</div>';
  document.getElementById('modal-body').innerHTML = _tmBuildForm(null);
  document.getElementById('detail-modal').classList.add('open');
}

function openEditTeamModal(teamId) {
  var team=(DATA.teams||{})[teamId]; if(!team) return;
  document.getElementById('modal-title').innerHTML = '<div class="nm-dsi">Edit Team</div><div class="nm-sub">'+esc(team.name)+'</div>';
  document.getElementById('modal-body').innerHTML = _tmBuildForm(teamId);
  document.getElementById('detail-modal').classList.add('open');
}

function _tmBuildForm(teamId) {
  var teams=DATA.teams||{}; var roster=DATA.roster||{};
  var team=teamId?(teams[teamId]||{}):{};
  var fs='width:100%;padding:8px;border:1.5px solid var(--field-border);border-radius:6px;background:var(--field-bg);color:var(--text)';
  var ldrRoles=['master-admin','owner','admin','manager','jd','leader'];
  var leaderOpts='<option value="">— No Leader —</option>'+
    Object.keys(roster).filter(function(e){ return ldrRoles.indexOf(roster[e].rank)!==-1&&!roster[e].deactivated; })
      .sort(function(a,b){ return (roster[a].name||'').localeCompare(roster[b].name||''); })
      .map(function(e){ var r=roster[e]; return '<option value="'+esc(e)+'"'+(team.leaderId===e?' selected':'')+'>'+esc(r.name||e)+' ('+esc(_ROLE_LABELS[r.rank]||r.rank)+')</option>'; }).join('');
  var parentOpts='<option value="">None (Top Level)</option>'+
    Object.keys(teams).filter(function(tid){ return tid!==teamId; })
      .sort(function(a,b){ return (teams[a].name||'').localeCompare(teams[b].name||''); })
      .map(function(tid){ return '<option value="'+esc(tid)+'"'+(team.parentId===tid?' selected':'')+'>'+esc(teams[tid].name)+'</option>'; }).join('');
  var cur=team.emoji||'';
  var grid=_TM_EMOJIS.map(function(em){
    var sel=em===cur;
    return '<button type="button" onclick="_tmPickEmoji(\''+em+'\')" style="font-size:1.4rem;padding:4px 6px;background:'+(sel?'rgba(var(--blue2-rgb),.15)':'transparent')+';border:1.5px solid '+(sel?'#4A9FD4':'transparent')+';border-radius:6px;cursor:pointer;transition:all .15s" data-emoji="'+em+'" title="'+em+'">'+em+'</button>';
  }).join('');
  return '<div class="field"><label>Team Name</label><input type="text" id="tm-f-name" value="'+esc(team.name||'')+'" placeholder="e.g. Aces" style="'+fs+'"></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
    '<div class="field" style="margin:0"><label>Parent Team</label><select id="tm-f-parent" style="'+fs+'">'+parentOpts+'</select></div>'+
    '<div class="field" style="margin:0"><label>Leader</label><select id="tm-f-leader" style="'+fs+'">'+leaderOpts+'</select></div>'+
    '</div>'+
    '<div class="field"><label>Emoji</label>'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
    '<div id="tm-emoji-preview" style="font-size:2rem;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:var(--surface2);border-radius:8px;border:1.5px solid var(--field-border)">'+(cur||'👥')+'</div>'+
    '<input type="text" id="tm-f-emoji" value="'+esc(cur)+'" placeholder="Type or paste emoji" oninput="_tmEmojiInput()" style="flex:1;padding:8px;border:1.5px solid var(--field-border);border-radius:6px;background:var(--field-bg);color:var(--text);font-size:1.1rem">'+
    '</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:2px;max-height:160px;overflow-y:auto;padding:4px;background:var(--field-bg);border:1.5px solid var(--field-border);border-radius:6px">'+grid+'</div>'+
    '</div>'+
    '<div class="nm-actions">'+
    '<button class="nm-add-btn" onclick="saveTeamModal(\''+esc(teamId||'')+'\')">SAVE</button>'+
    '<button class="nm-close-btn" onclick="closeModal()">CANCEL</button>'+
    '</div>';
}

function _tmPickEmoji(em) {
  var inp=document.getElementById('tm-f-emoji');
  var prev=document.getElementById('tm-emoji-preview');
  if(inp) inp.value=em; if(prev) prev.textContent=em;
  document.querySelectorAll('[data-emoji]').forEach(function(btn){
    var sel=btn.getAttribute('data-emoji')===em;
    btn.style.background=sel?'rgba(var(--blue2-rgb),.15)':'transparent';
    btn.style.borderColor=sel?'#4A9FD4':'transparent';
  });
}

function _tmEmojiInput() {
  var val=(document.getElementById('tm-f-emoji')||{}).value||'';
  if(val.trim()){
    var prev=document.getElementById('tm-emoji-preview');
    if(prev) prev.textContent=val.trim();
    document.querySelectorAll('[data-emoji]').forEach(function(btn){
      var sel=btn.getAttribute('data-emoji')===val.trim();
      btn.style.background=sel?'rgba(var(--blue2-rgb),.15)':'transparent';
      btn.style.borderColor=sel?'#4A9FD4':'transparent';
    });
  }
}

function saveTeamModal(existingId) {
  var name=(document.getElementById('tm-f-name')||{}).value||''; name=name.trim();
  var emoji=(document.getElementById('tm-f-emoji')||{}).value||''; emoji=emoji.trim();
  var leaderId=(document.getElementById('tm-f-leader')||{}).value||'';
  var parentId=(document.getElementById('tm-f-parent')||{}).value||'';
  if(!name){ alert('Team name is required.'); return; }
  var body;
  if(existingId) {
    body={action:'updateTeam',teamId:existingId,name:name,emoji:emoji,leaderId:leaderId,parentId:parentId};
  } else {
    var tid=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+Date.now().toString(36);
    body={action:'addTeam',teamId:tid,name:name,emoji:emoji,leaderId:leaderId,parentId:parentId};
  }
  apiPost(body).then(function(res){
    if(res.ok){ closeModal(); refreshData(); } else alert(res.error||'Save failed.');
  }).catch(function(){ alert('Connection error.'); });
}

function _tmDelete(teamId, name) {
  if(!confirm('Delete team "'+name+'"? This cannot be undone.')) return;
  apiPost({action:'deleteTeam',teamId:teamId}).then(function(res){
    if(res.ok) refreshData(); else alert(res.error||'Delete failed.');
  }).catch(function(){ alert('Connection error.'); });
}

// ── LIVE FILTER BINDING ───────────────────────────────────────────────────
function bindFilters() {
  document.querySelectorAll('[id^="f-"]').forEach(function(input) {
    input.addEventListener('input', function() {
      var tblId = input.id.replace('f-','') + '-table';
      var tbl = document.getElementById(tblId);
      if (!tbl) return;
      var q = input.value.toLowerCase();
      Array.from(tbl.querySelectorAll('tbody tr')).forEach(function(tr) {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      if (tblId === 'ct-table') {
        var countEl = document.getElementById('ct-count');
        if (countEl) {
          var visible = Array.from(tbl.querySelectorAll('tbody tr')).filter(function(tr){ return tr.style.display !== 'none'; }).length;
          countEl.textContent = visible === _tabOrders.length
            ? 'Showing all ' + _tabOrders.length + ' orders'
            : 'Showing ' + visible + ' of ' + _tabOrders.length + ' orders';
        }
        _updateFilterBadge();
      }
    });
  });
}

