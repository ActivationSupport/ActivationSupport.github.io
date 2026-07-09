// ── BOOT ─────────────────────────────────────────────────────────────────
document.addEventListener('click', function(e) {
  var panel = document.getElementById('office-dd-panel');
  if (panel) panel.classList.remove('open');
  if (!e.target.closest || !e.target.closest('.dd-filter')) {
    document.querySelectorAll('.dd-panel.open').forEach(function(p){ p.classList.remove('open'); });
  }
});
initLogin();
