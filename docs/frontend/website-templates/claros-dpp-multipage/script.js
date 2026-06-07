
const nav = document.querySelector('.nav');
const toggle = document.querySelector('.menu-toggle');
if (toggle && nav) toggle.addEventListener('click', () => nav.classList.toggle('open'));
document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => nav?.classList.remove('open')));
const obs = new IntersectionObserver(entries => entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }}), {threshold:.12});
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
document.querySelectorAll('.faq-q').forEach(btn => btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open')));
document.querySelectorAll('[data-tabs]').forEach(group => {
  const buttons = group.querySelectorAll('.tab-btn');
  const panels = group.querySelectorAll('.tab-panel');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    group.querySelector(`#${btn.dataset.tab}`)?.classList.add('active');
  }));
});
document.querySelectorAll('form[data-static-form]').forEach(form => form.addEventListener('submit', e => {
  e.preventDefault();
  const msg = form.querySelector('.form-message');
  if(msg){ msg.textContent = 'Thank you — this is a static preview form. Connect it to your backend or form service when deploying.'; msg.hidden = false; }
}));
