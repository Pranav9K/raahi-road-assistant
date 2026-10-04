// UI preferences never reset or modify the simulation.
const root = document.documentElement;
const sidebar = document.getElementById('sidebar');
const toggle = document.getElementById('menu-toggle');
const close = document.getElementById('menu-close');
const backdrop = document.getElementById('menu-backdrop');
const themeSwitch = document.getElementById('dark-mode');
const mobile = window.matchMedia('(max-width: 740px)');
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } }

function setTheme(dark) {
  root.dataset.theme = dark ? 'dark' : 'light';
  themeSwitch.checked = dark;
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0e1422' : '#f3f5fa';
  document.dispatchEvent(new Event('raahi:viewchange'));
}
setTheme(read('raahi-theme') === 'dark');
themeSwitch.addEventListener('change', () => {
  setTheme(themeSwitch.checked);
  save('raahi-theme', themeSwitch.checked ? 'dark' : 'light');
});

let open = mobile.matches ? false : read('raahi-menu') !== 'closed';
function setMenu(next, remember = false) {
  open = next;
  root.classList.toggle('menu-collapsed', !open);
  root.classList.toggle('menu-overlay-open', open && mobile.matches);
  sidebar.inert = !open;
  sidebar.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Collapse menu' : 'Expand menu');
  toggle.title = open ? 'Collapse menu' : 'Expand menu';
  backdrop.hidden = !(open && mobile.matches);
  if (remember && !mobile.matches) save('raahi-menu', open ? 'open' : 'closed');
}
function closeMenu() { setMenu(false, true); toggle.focus(); }
toggle.addEventListener('click', () => {
  setMenu(!open, true);
  if (open && mobile.matches) close.focus();
});
close.addEventListener('click', closeMenu);
backdrop.addEventListener('click', closeMenu);
document.getElementById('scenarios').addEventListener('click', event => {
  if (mobile.matches && event.target.closest('.scenario-button')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  if (!open) return;
  if (event.key === 'Escape') { closeMenu(); return; }
  if (event.key !== 'Tab' || !mobile.matches) return;
  const controls = [...sidebar.querySelectorAll('a[href], button:not(:disabled)')];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
mobile.addEventListener('change', () => setMenu(mobile.matches ? false : read('raahi-menu') !== 'closed'));
setMenu(open);
