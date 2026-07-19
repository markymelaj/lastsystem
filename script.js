const header = document.querySelector('[data-header]');
const navToggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-nav]');
const year = document.querySelector('[data-year]');

if (year) year.textContent = new Date().getFullYear();

const setHeaderState = () => {
  if (!header) return;
  header.classList.toggle('is-scrolled', window.scrollY > 8);
};
setHeaderState();
window.addEventListener('scroll', setHeaderState, { passive: true });

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    document.body.classList.toggle('nav-open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      document.body.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.16 });

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

// Ajustar datos antes de publicar en producción.
// Reemplazar el número por el WhatsApp oficial de la fundación (Argentina), sin signos ni espacios.
// Formato: 54 9 + código de área + número (ej: 5491155551234).
const WHATSAPP_NUMBER = '5491100000000'; // PLACEHOLDER - reemplazar por número real
const WHATSAPP_MESSAGE = encodeURIComponent('Hola, quisiera pedir orientación inicial a Fundación Senderos de Libertad.');
document.querySelectorAll('[data-whatsapp-link]').forEach((link) => {
  link.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;
});
