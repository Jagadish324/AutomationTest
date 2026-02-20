/* Jenkins UI — Client-side JS (minimal, server does the heavy lifting) */

'use strict';

/* ── Auto-dismiss alerts after 5 s ──────────────── */
document.querySelectorAll('.alert').forEach(el => {
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 5000);
});

/* ── Confirm before form submit with data-confirm ── */
document.querySelectorAll('form[data-confirm]').forEach(form => {
  form.addEventListener('submit', e => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
});

/* ── Close user dropdown when clicking outside ────── */
document.addEventListener('click', e => {
  const menu = document.querySelector('.user-menu.open');
  if (menu && !menu.contains(e.target)) menu.classList.remove('open');
});
