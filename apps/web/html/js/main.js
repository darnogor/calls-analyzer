import { ApiError, api } from './api.js';
import { capabilities, esc, parseRoute, safeNext, translateRequestError } from './format.js';
import { renderPage } from './pages.js';
import { navigate, startRouter } from './router.js';
import { shell } from './view.js';

const root = document.querySelector('#app');
const state = { me: null, projects: [], ready: false };
let generation = 0;
let poll = 0;

function clearPoll() {
  if (poll) clearInterval(poll);
  poll = 0;
}

function schedule(fn, ms) {
  clearPoll();
  poll = setInterval(fn, ms);
}

async function reloadSession() {
  state.me = await api('/api/me');
  const projects = await api('/api/projects');
  state.projects = Array.isArray(projects?.items) ? projects.items : [];
}

function homeAfterLogin(search) {
  const next = safeNext(search.get('next') || '/');
  if (next === '/login' || next.startsWith('/login?')) return '/';
  return next;
}

async function draw() {
  const gen = ++generation;
  clearPoll();
  const route = parseRoute(location.pathname);
  const search = new URLSearchParams(location.search);

  if (!state.ready) {
    root.innerHTML = '<div class="boot">Загрузка…</div>';
    try {
      await reloadSession();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        const text = translateRequestError(error?.body, error?.status);
        root.innerHTML = `<div class="boot">${esc(text)}</div>`;
        return;
      }
      state.me = null;
      state.projects = [];
    }
    state.ready = true;
    if (gen !== generation) return;
  }

  if (route.name !== 'login' && !state.me) {
    const next = safeNext(`${location.pathname}${location.search}`);
    navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    return;
  }
  if (route.name === 'login' && state.me) {
    navigate(homeAfterLogin(search), { replace: true });
    return;
  }

  if (route.projectId && state.me && !state.projects.some((item) => item.id === route.projectId)) {
    try {
      await reloadSession();
    } catch {
      /* the page request reports a missing project */
    }
    if (gen !== generation) return;
  }

  const project = state.projects.find((item) => item.id === route.projectId) || null;
  const caps = capabilities(state.me, route.projectId);
  const ctx = {
    route,
    search,
    state,
    project,
    caps,
    timeZone: project?.timezone || 'Europe/Moscow',
    isCurrent: () => gen === generation,
    reloadSession,
    schedule,
  };

  let page;
  try {
    page = await renderPage(ctx);
  } catch (error) {
    if (gen !== generation) return;
    if (error instanceof ApiError && error.status === 401) {
      state.me = null;
      navigate('/login', { replace: true });
      return;
    }
    page = {
      title: 'Ошибка',
      heading: '<h1>Ошибка</h1>',
      html: `<section class="panel"><div class="empty-state"><p>${esc(translateRequestError(error?.body, error?.status))}</p></div></section>`,
    };
  }
  if (!page || page.skip || gen !== generation) return;
  document.title = `${page.title} — Call Analytics`;
  root.innerHTML = page.bare
    ? page.html
    : shell({
        heading: page.heading,
        me: state.me,
        project,
        caps,
        route,
        content: page.html,
      });
  page.bind?.(root);
}

async function logout() {
  try {
    await api('/api/session', { method: 'DELETE' });
  } catch {
    /* clearing the cookie is enough when the request fails */
  }
  state.me = null;
  state.projects = [];
  navigate('/login', { replace: true });
}

document.addEventListener('click', (event) => {
  const menu = document.querySelector('[data-user-menu]');
  const button = document.querySelector('[data-user]');
  if (event.target.closest('[data-logout]')) {
    event.preventDefault();
    logout();
    return;
  }
  if (event.target.closest('[data-user]')) {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    button?.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    return;
  }
  if (menu && !event.target.closest('[data-user-menu]')) {
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  }
});

startRouter(draw);
draw();
