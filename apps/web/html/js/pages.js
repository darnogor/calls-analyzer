import { ApiError, api } from './api.js';
import {
  DEFAULT_STAGE_TITLES,
  callsApiSearch,
  callsPageSearch,
  dealAtCallStage,
  dealCurrentStage,
  dealTitle,
  directionLabel,
  esc,
  formatClock,
  formatDateTime,
  formatDuration,
  formatWeight,
  isMissingEndpoint,
  isProgressStatus,
  managersApiSearch,
  managersPageSearch,
  nowDateTimeLocal,
  pluginConnectPath,
  plural,
  projectPath,
  readCallsQuery,
  readManagersQuery,
  routeAllowed,
  stageColumns,
  toggleSort,
  translateCallError,
  translateRequestError,
  translateStatus,
  zonedIso,
} from './format.js';
import { navigate } from './router.js';
import {
  callsTable,
  externalLink,
  filtersHtml,
  forbidden,
  notice,
  pagination,
  panel,
  scoreHtml,
  stageScoreHtml,
  transcriptHtml,
  unavailable,
} from './view.js';

const CALLS_NOUN = ['звонок', 'звонка', 'звонков'];
const MANAGERS_NOUN = ['менеджер', 'менеджера', 'менеджеров'];

export async function renderPage(ctx) {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  switch (ctx.route.name) {
    case 'login':
      return renderLogin(ctx);
    case 'projects':
      return renderProjects(ctx);
    case 'accounts':
      return renderAccounts(ctx);
    case 'calls':
      return renderCallList(ctx, 'calls');
    case 'problems':
      return renderCallList(ctx, 'problems');
    case 'progress':
      return renderCallList(ctx, 'progress');
    case 'call':
      return renderCall(ctx);
    case 'call-new':
      return renderUpload(ctx);
    case 'managers':
      return renderManagers(ctx);
    case 'manager':
      return renderManager(ctx);
    case 'settings':
      return renderSettings(ctx);
    case 'inputs':
      return renderInputs(ctx);
    default:
      return { title: 'Страница не найдена', heading: '<h1>Страница не найдена</h1>', html: unavailable('Такой страницы нет') };
  }
}

function guard(ctx) {
  if (ctx.route.projectId && !ctx.caps.read) {
    return { title: 'Проект не найден', heading: '<h1>Проект не найден</h1>', html: unavailable('Проект не найден') };
  }
  if (!routeAllowed(ctx.route.name, ctx.caps)) {
    const text = {
      progress: 'Этот список открывают администратор и руководитель.',
      problems: 'Этот список открывают администратор и руководитель.',
      settings: 'Настройки анализа доступны администратору.',
      accounts: 'Аккаунты доступны администратору.',
      inputs: 'Этот раздел доступен администратору и руководителю.',
      'call-new': 'Загрузка звонка доступна администратору и руководителю.',
    }[ctx.route.name] || 'Недостаточно прав';
    return { title: 'Недоступно', heading: '<h1>Недоступно</h1>', html: forbidden(text) };
  }
  return null;
}

function renderLogin(ctx) {
  const next = landing(ctx.search.get('next'));
  return {
    bare: true,
    title: 'Вход',
    html: `<div class="login-screen">
      <form class="login-card" data-login>
        <div class="brand brand-large"><span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 13h2.2l1.6-4.2 2.3 8.4 2-6.2 1.5 2h6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Call Analytics</span></div>
        <h1>Вход</h1>
        <p class="muted">Почта и пароль. Регистрации нет: аккаунт заводит администратор.</p>
        <label>Почта <input name="email" type="email" autocomplete="username" required></label>
        <label>Пароль <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" data-error hidden></p>
        <button class="button" type="submit">Войти</button>
      </form>
    </div>`,
    bind(root) {
      const form = root.querySelector('[data-login]');
      const error = form.querySelector('[data-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        const data = new FormData(form);
        try {
          await api('/api/session', {
            method: 'POST',
            body: { email: String(data.get('email') || ''), password: String(data.get('password') || '') },
          });
          await ctx.reloadSession();
          navigate(next, { replace: true });
        } catch (err) {
          error.hidden = false;
          error.textContent = err instanceof ApiError && err.status === 401
            ? 'Неверная почта или пароль'
            : translateRequestError(err.body, err.status);
        }
      });
    },
  };
}

async function renderProjects(ctx) {
  const items = ctx.state.projects;
  const create = ctx.caps.createProject
    ? `<form class="inline-form" data-create-project>
        <label>Новый проект <input name="name" required placeholder="Название"></label>
        <button class="button" type="submit">Создать</button>
      </form><p class="form-error" data-error hidden></p>`
    : '';
  const list = items.length
    ? `<ul class="choice-list">${items
        .map(
          (project) => `<li><a href="${esc(projectPath(project.id, 'calls'))}">${esc(project.name)}</a><span>${esc(project.timezone || '')}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">Проектов пока нет.</p>';
  return {
    title: 'Проекты',
    heading: '<h1>Проекты</h1>',
    html: panel('', `${create}${list}`),
    bind(root) {
      const form = root.querySelector('[data-create-project]');
      if (!form) return;
      const error = root.querySelector('[data-error]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        try {
          const created = await api('/api/projects', {
            method: 'POST',
            body: { name: String(new FormData(form).get('name') || '') },
          });
          await ctx.reloadSession();
          navigate(projectPath(created.id, 'calls'));
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) throw err;
          showError(error, err);
        }
      });
    },
  };
}

async function renderAccounts(ctx) {
  let body;
  try {
    body = await api('/api/accounts');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError('Аккаунты', error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const items = Array.isArray(body?.items) ? body.items : [];
  const rows = items
    .map((account) => {
      const memberships = Array.isArray(account.projects) ? account.projects : [];
      const roles = account.is_administrator
        ? '<p class="muted">Администратор видит все проекты.</p>'
        : `<form data-roles="${esc(account.id)}" class="stack">
            ${ctx.state.projects
              .map((project) => {
                const current = memberships.find((item) => item.id === project.id)?.role || '';
                return `<label>${esc(project.name)}
                  <select name="role:${esc(project.id)}">
                    <option value="" ${current === '' ? 'selected' : ''}>Нет доступа</option>
                    <option value="lead" ${current === 'lead' ? 'selected' : ''}>Руководитель</option>
                    <option value="sales_manager" ${current === 'sales_manager' ? 'selected' : ''}>Менеджер по продажам</option>
                  </select>
                </label>`;
              })
              .join('')}
            <button class="button button-secondary" type="submit">Сохранить роли</button>
          </form>`;
      return `<article class="account-card">
        <header>
          <div><strong>${esc(account.name || '')}</strong><div class="muted">${esc(account.email || '')}</div></div>
          <span class="badge">${account.is_active ? 'Активен' : 'Выключен'}</span>
        </header>
        <div class="account-actions">
          <button type="button" class="button button-secondary" data-active="${esc(account.id)}" data-next="${account.is_active ? 'false' : 'true'}">${account.is_active ? 'Выключить' : 'Включить'}</button>
          <form data-password="${esc(account.id)}" class="inline-form">
            <input name="password" type="password" autocomplete="new-password" placeholder="Новый пароль" required>
            <button class="button button-secondary" type="submit">Задать пароль</button>
          </form>
        </div>
        ${roles}
        <p class="form-error" data-error hidden></p>
      </article>`;
    })
    .join('');
  return {
    title: 'Аккаунты',
    heading: '<h1>Аккаунты</h1>',
    html: `${panel(
      'Новый аккаунт',
      `<form class="stack" data-create-account>
        <label>Имя <input name="name" required></label>
        <label>Почта <input name="email" type="email" required></label>
        <label>Пароль <input name="password" type="password" autocomplete="new-password" required></label>
        <label class="check"><input type="checkbox" name="is_administrator"> Администратор</label>
        <button class="button" type="submit">Создать аккаунт</button>
        <p class="form-error" data-error hidden></p>
      </form>`,
    )}
    <section class="stack">${rows || '<p class="muted">Аккаунтов пока нет.</p>'}</section>`,
    bind(root) {
      root.querySelector('[data-create-account]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const error = form.querySelector('[data-error]');
        const data = new FormData(form);
        try {
          await api('/api/accounts', {
            method: 'POST',
            body: {
              name: String(data.get('name') || ''),
              email: String(data.get('email') || ''),
              password: String(data.get('password') || ''),
              is_administrator: data.get('is_administrator') === 'on',
            },
          });
          navigate(location.pathname, { replace: true });
        } catch (err) {
          if (auth(err)) return;
          showError(error, err);
        }
      });
      root.querySelectorAll('[data-active]').forEach((button) => {
        button.addEventListener('click', async () => {
          const error = button.closest('.account-card').querySelector('[data-error]');
          try {
            await api(`/api/accounts/${encodeURIComponent(button.dataset.active)}`, {
              method: 'PATCH',
              body: { is_active: button.dataset.next === 'true' },
            });
            navigate(location.pathname, { replace: true });
          } catch (err) {
            if (auth(err)) return;
            showError(error, err);
          }
        });
      });
      root.querySelectorAll('[data-password]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const error = form.closest('.account-card').querySelector('[data-error]');
          try {
            await api(`/api/accounts/${encodeURIComponent(form.dataset.password)}`, {
              method: 'PATCH',
              body: { password: String(new FormData(form).get('password') || '') },
            });
            form.reset();
            error.hidden = false;
            error.textContent = 'Пароль сохранён';
            error.classList.add('is-ok');
          } catch (err) {
            if (auth(err)) return;
            showError(error, err);
          }
        });
      });
      root.querySelectorAll('[data-roles]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const error = form.closest('.account-card').querySelector('[data-error]');
          const data = new FormData(form);
          const items = [];
          for (const [key, value] of data.entries()) {
            if (!key.startsWith('role:') || !value) continue;
            items.push({ project_id: key.slice('role:'.length), role: String(value) });
          }
          try {
            await api(`/api/accounts/${encodeURIComponent(form.dataset.roles)}/projects`, {
              method: 'PUT',
              body: { items },
            });
            navigate(location.pathname, { replace: true });
          } catch (err) {
            if (auth(err)) return;
            showError(error, err);
          }
        });
      });
    },
  };
}

async function renderCallList(ctx, mode) {
  const tail = mode === 'calls' ? 'calls' : mode;
  const query = readCallsQuery(ctx.search, ctx.timeZone, mode);
  if (query.appliedDefault) {
    navigate(projectPath(ctx.route.projectId, tail, callsPageSearch(query)), { replace: true });
    return { skip: true };
  }
  remember(`calls:${ctx.route.projectId}`, location.search);
  const filters = await loadFilters(ctx.route.projectId);
  if (!ctx.isCurrent()) return { skip: true };
  const stages = stageColumns(filters.data?.stages);
  let data;
  try {
    const view = mode === 'calls' ? undefined : mode;
    data = await api(`/api/projects/${encodeURIComponent(ctx.route.projectId)}/calls?${callsApiSearch(query, view)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError(listTitle(mode), error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.total) || 0;
  const button = mode === 'calls' && ctx.caps.write
    ? `<a class="button" href="${esc(projectPath(ctx.route.projectId, 'calls/new'))}">Новый звонок</a>`
    : '';
  const fieldNote = Boolean(query.fieldKey) !== Boolean(query.fieldValue)
    ? notice('Ключ и значение произвольного поля нужно указать вместе.')
    : '';
  const filterNote = filters.missing
    ? notice('Справочник менеджеров и стадий сделки сейчас недоступен. Колонки этапов подписаны шаблоном проекта.')
    : '';
  const html = `${fieldNote}${filterNote}${filtersHtml({
    query,
    filters: filters.data,
    includeManager: true,
    includeDeal: true,
    includeField: true,
  })}${callsTable({
    items,
    stages,
    timeZone: ctx.timeZone,
    projectId: ctx.route.projectId,
    showManager: true,
    showScores: mode === 'calls',
    showStatus: mode !== 'calls',
    showError: mode === 'problems',
    sort: query.sort,
    order: query.order,
  })}${pagination({
    page: query.page,
    perPage: query.perPage,
    total,
    noun: CALLS_NOUN,
    hrefFor: (page, perPage) => projectPath(ctx.route.projectId, tail, callsPageSearch({ ...query, page, perPage })),
  })}`;
  return {
    title: listTitle(mode),
    heading: `<div class="title-row"><h1>${esc(listTitle(mode))}</h1>${button}</div>`,
    html,
    bind(root) {
      bindFilters(root, (filtersState) => {
        const state = { ...query, ...filtersState, page: 1 };
        navigate(projectPath(ctx.route.projectId, tail, callsPageSearch(state)));
      });
      bindSort(root, query, (next) => {
        const formState = readFilterForm(root.querySelector('[data-filters]'));
        navigate(projectPath(ctx.route.projectId, tail, callsPageSearch({ ...query, ...formState, ...next, page: 1 })));
      });
      bindPager(root, (perPage) => {
        navigate(projectPath(ctx.route.projectId, tail, callsPageSearch({ ...query, perPage, page: 1 })));
      });
      bindRows(root);
    },
  };
}

async function renderCall(ctx) {
  const projectId = ctx.route.projectId;
  const callId = ctx.route.callId;
  let call;
  try {
    call = await api(`/api/projects/${encodeURIComponent(projectId)}/calls/${encodeURIComponent(callId)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError('Звонок', error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const back = recall(`calls:${projectId}`);
  const backHref = `${projectPath(projectId, 'calls')}${back && back.startsWith('?') ? back : ''}`;
  const company = typeof call.company_name === 'string' ? call.company_name.trim() : '';
  const contact = call.contact?.name ? String(call.contact.name).trim() : '';
  const crumbs = [`<a href="${esc(backHref)}">Звонки</a>`];
  if (company) crumbs.push(`<span>${esc(company)}</span>`);
  if (contact) crumbs.push(externalLink(call.contact?.external_url, contact));
  const title = [company, contact].filter(Boolean).join(' / ') || 'Звонок';
  const manager = call.manager?.id
    ? `<a href="${esc(projectPath(projectId, `managers/${encodeURIComponent(call.manager.id)}`))}">${esc(call.manager.name || '')}</a>`
    : '<span class="muted">—</span>';
  const dealName = dealTitle(call.deal);
  const dealHtml = dealName ? externalLink(call.deal?.external_url, dealName) : '<span class="muted">—</span>';
  const atCall = dealAtCallStage(call.deal);
  const current = dealCurrentStage(call.deal);
  const meta = [call.phone, directionLabel(call.direction)].filter(Boolean).join(' · ');
  const failed = call.processing_status === 'failed';
  const errorText = failed ? translateCallError(call.error?.message) || 'Ошибка обработки' : '';
  const banner = call.processing_status !== 'completed'
    ? `<div class="status-banner ${failed ? 'is-bad' : ''}"><strong>${esc(translateStatus(call.processing_status))}</strong>${errorText ? `<span>${esc(errorText)}</span>` : ''}</div>`
    : '';
  const player = call.has_recording
    ? `<div class="player" data-player>
        <button type="button" class="play" data-play data-state="play" aria-label="Воспроизведение"><span class="play-icon"></span><span class="pause-icon"></span></button>
        <span class="player-time" data-time>0:00 / ${esc(formatDuration(call.duration_sec))}</span>
        <input data-seek type="range" min="0" max="1000" value="0" aria-label="Перемотка">
        <div class="speeds">
          <button type="button" data-speed="1" aria-pressed="true">1x</button>
          <button type="button" data-speed="1.5" aria-pressed="false">1.5x</button>
          <button type="button" data-speed="2" aria-pressed="false">2x</button>
        </div>
        <audio preload="metadata" data-fallback="${Number(call.duration_sec) || 0}" src="/api/projects/${encodeURIComponent(projectId)}/calls/${encodeURIComponent(callId)}/recording"></audio>
        <p class="form-error" data-audio-error hidden>Не удалось загрузить запись</p>
      </div>`
    : '<div class="player player-off">Записи нет</div>';
  const stages = Array.isArray(call.stages) ? call.stages : null;
  const scoreBlock = stages
    ? `<section class="panel">
        <h2>Оценка звонка</h2>
        <div class="overall">${scoreHtml(call.overall_score, 'score-lg')}<span>Итоговая оценка</span></div>
        ${coverageNote(call)}
        <table class="score-table">
          <thead><tr><th>Этап</th><th>Оценка</th><th>Обоснование</th></tr></thead>
          <tbody>${stages
            .map((stage) => {
              const meaning = stage.high_score || stage.instruction || '';
              return `<tr>
                <td><div class="stage-title">${esc(stage.title || DEFAULT_STAGE_TITLES[stage.key] || stage.key || '')}${
                  stage.weight !== null && stage.weight !== undefined ? `<span class="weight">вес ${esc(formatWeight(stage.weight))}</span>` : ''
                }</div>${meaning ? `<p class="instruction">${esc(meaning)}</p>` : ''}${
                  stage.defect_example ? `<p class="instruction">Пример недочёта: ${esc(stage.defect_example)}</p>` : ''
                }${stage.sample_line ? `<p class="instruction">Образец смысла, не обязательный текст: ${esc(stage.sample_line)}</p>` : ''}</td>
                <td class="score-cell">${stageScoreHtml(stage)}</td>
                <td>${stage.reason ? esc(stage.reason) : '<span class="muted">—</span>'}${evidenceHtml(stage.evidence_ids)}</td>
              </tr>`;
            })
            .join('')}</tbody>
        </table>
        ${flagsAndPayment(call)}
        <h3>Краткий вывод</h3>
        <p>${call.summary ? esc(call.summary) : '<span class="muted">Краткого вывода нет</span>'}</p>
        ${contextHtml(call.context)}
      </section>`
    : `<section class="panel"><h2>Оценка звонка</h2><p class="muted">Оценка появится, когда разговор будет обработан.</p>${contextHtml(call.context)}</section>`;
  const transcript = stages || Array.isArray(call.transcript)
    ? `<section class="panel transcript-panel">
        <div class="panel-head"><h2>Транскрипт</h2><input type="search" data-transcript-search placeholder="Поиск по тексту" aria-label="Поиск по тексту"></div>
        <div class="transcript">${transcriptHtml(call.transcript)}</div>
      </section>`
    : '<section class="panel"><h2>Транскрипт</h2><p class="muted">Транскрипт появится после распознавания.</p></section>';
  return {
    title,
    heading: `<h1 class="crumbs">${crumbs.join('<span class="crumb-sep">/</span>')}</h1>`,
    html: `${banner}
      ${meta ? `<p class="meta-line">${esc(meta)}</p>` : ''}
      <div class="stats">
        ${stat('Менеджер', manager, true)}
        ${stat('Дата', esc(formatDateTime(call.started_at, ctx.timeZone)), true)}
        ${stat('Длит.', esc(formatDuration(call.duration_sec)), true)}
        ${stat('Сделка', dealHtml, true)}
        ${stat('Этап сделки', atCall ? esc(atCall) : '<span class="muted">—</span>', true)}
        ${stat('Статус', current ? esc(current) : '<span class="muted">—</span>', true)}
        ${stat('Итог', scoreHtml(call.overall_score), true)}
      </div>
      ${player}
      <div class="split">${transcript}${scoreBlock}</div>`,
    bind(root) {
      bindPlayer(root);
      bindTranscriptSearch(root);
      if (isProgressStatus(call.processing_status)) {
        ctx.schedule(async () => {
          if (!ctx.isCurrent()) return;
          try {
            const next = await api(`/api/projects/${encodeURIComponent(projectId)}/calls/${encodeURIComponent(callId)}`);
            if (!ctx.isCurrent()) return;
            if (next?.processing_status !== call.processing_status) navigate(`${location.pathname}${location.search}`, { replace: true });
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) navigate('/login', { replace: true });
          }
        }, 4000);
      }
    },
  };
}

async function renderUpload(ctx) {
  const filters = await loadFilters(ctx.route.projectId);
  if (!ctx.isCurrent()) return { skip: true };
  const managers = Array.isArray(filters.data?.managers) ? filters.data.managers : [];
  const managerOptions = [`<option value="">Не указан</option>`]
    .concat(managers.map((manager) => `<option value="${esc(manager.id)}">${esc(manager.name || '')}</option>`))
    .join('');
  return {
    title: 'Новый звонок',
    heading: `<h1 class="crumbs"><a href="${esc(projectPath(ctx.route.projectId, 'calls'))}">Звонки</a><span class="crumb-sep">/</span><span>Новый звонок</span></h1>`,
    html: panel(
      '',
      `<form class="stack" data-upload>
        <label>Запись <input name="file" type="file" accept="audio/*,.mp3,.wav,.ogg,.mpeg" required></label>
        <label>Дата и время <input name="started_at" type="datetime-local" required value="${esc(nowDateTimeLocal(ctx.timeZone))}"></label>
        <label>Менеджер <select name="manager_id">${managerOptions}</select></label>
        <label>Новое имя <input name="manager_name" placeholder="Если менеджера ещё нет в проекте"></label>
        <label>Телефон <input name="phone"></label>
        <label>Направление <select name="direction"><option value="">Не указано</option><option value="in">Входящий</option><option value="out">Исходящий</option></select></label>
        <label>Контакт <input name="contact"></label>
        <label>Компания <input name="company_name"></label>
        <label>Название сделки <input name="deal_name"></label>
        <label>Стадия на момент звонка <input name="status_at_call"></label>
        <label>Заметка <textarea name="notes" rows="3"></textarea></label>
        <div class="fields" data-fields></div>
        <button class="button button-secondary" type="button" data-add-field>Добавить поле</button>
        <p class="muted">У поля есть ключ, подпись и значение. Одинаковый ключ можно использовать в фильтре списка.</p>
        <p class="form-error" data-error hidden></p>
        <button class="button" type="submit">Загрузить</button>
      </form>`,
    ),
    bind(root) {
      const form = root.querySelector('[data-upload]');
      const error = form.querySelector('[data-error]');
      const fields = form.querySelector('[data-fields]');
      const select = form.querySelector('[name=manager_id]');
      const name = form.querySelector('[name=manager_name]');
      const idempotency = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`;
      const syncName = () => {
        name.disabled = Boolean(select.value);
      };
      select.addEventListener('change', syncName);
      form.querySelector('[data-add-field]').addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'field-row';
        row.innerHTML = `<input name="field_key" placeholder="Ключ" aria-label="Ключ поля">
          <input name="field_label" placeholder="Подпись" aria-label="Подпись поля">
          <input name="field_value" placeholder="Значение" aria-label="Значение поля">
          <button type="button" data-remove-field>Удалить</button>`;
        row.querySelector('[data-remove-field]').addEventListener('click', () => row.remove());
        fields.append(row);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        const data = new FormData(form);
        const file = data.get('file');
        if (!(file instanceof File) || file.size === 0) {
          error.hidden = false;
          error.textContent = 'Выберите файл записи';
          return;
        }
        const started = zonedIso(String(data.get('started_at') || ''), ctx.timeZone);
        if (!started) {
          error.hidden = false;
          error.textContent = 'Укажите дату и время';
          return;
        }
        const payload = { started_at: started };
        const managerId = String(data.get('manager_id') || '');
        const managerName = String(data.get('manager_name') || '').trim();
        if (managerId) payload.manager = { id: managerId };
        else if (managerName) payload.manager = { name: managerName };
        const phone = String(data.get('phone') || '').trim();
        if (phone) payload.phone = phone;
        const direction = String(data.get('direction') || '');
        if (direction === 'in' || direction === 'out') payload.direction = direction;
        const contact = String(data.get('contact') || '').trim();
        if (contact) payload.contact = { name: contact };
        const company = String(data.get('company_name') || '').trim();
        if (company) payload.company_name = company;
        const dealName = String(data.get('deal_name') || '').trim();
        const stage = String(data.get('status_at_call') || '').trim();
        if (dealName || stage) {
          payload.deal = {};
          if (dealName) payload.deal.name = dealName;
          if (stage) payload.deal.status_at_call_name = stage;
        }
        const notes = String(data.get('notes') || '');
        const custom = readCustomFields(form);
        if (custom.error) {
          error.hidden = false;
          error.textContent = custom.error;
          return;
        }
        payload.context = { notes: notes.trim() ? notes : null, fields: custom.fields };
        const body = new FormData();
        body.append('payload', JSON.stringify(payload));
        body.append('file', file);
        try {
          const created = await api(`/api/projects/${encodeURIComponent(ctx.route.projectId)}/calls`, {
            method: 'POST',
            body,
            headers: { 'Idempotency-Key': idempotency },
          });
          navigate(projectPath(ctx.route.projectId, `calls/${encodeURIComponent(created.id)}`));
        } catch (err) {
          if (auth(err)) return;
          showError(error, err);
        }
      });
    },
  };
}

async function renderManagers(ctx) {
  const query = readManagersQuery(ctx.search, ctx.timeZone);
  if (query.appliedDefault) {
    navigate(projectPath(ctx.route.projectId, 'managers', managersPageSearch(query)), { replace: true });
    return { skip: true };
  }
  let data;
  try {
    data = await api(`/api/projects/${encodeURIComponent(ctx.route.projectId)}/managers?${managersApiSearch(query)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError('Менеджеры', error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const items = Array.isArray(data?.items) ? data.items : [];
  const filters = await loadFilters(ctx.route.projectId);
  if (!ctx.isCurrent()) return { skip: true };
  const stages = !filters.missing && Array.isArray(filters.data?.stages) && filters.data.stages.length
    ? stageColumns(filters.data.stages)
    : managerStageColumns(items);
  const needle = query.q.trim().toLowerCase();
  const rows = items
    .map((manager) => {
      const href = projectPath(
        ctx.route.projectId,
        `managers/${encodeURIComponent(manager.id)}`,
        periodSearch(query),
      );
      const inactive = manager.is_active === false ? ' <span class="badge">неактивен</span>' : '';
      return `<tr data-href="${esc(href)}" data-name="${esc(manager.name || '')}">
        <td><a class="row-link" href="${esc(href)}">${esc(manager.name || '')}</a>${inactive}</td>
        <td>${esc(manager.calls_count ?? 0)}</td>
        <td>${lastCallCell(manager.last_call_at, ctx.timeZone)}</td>
        ${stages.map((stage) => `<td class="score-cell">${stageScoreHtml({ score: stageScoreOf(manager, stage.key) })}</td>`).join('')}
        <td class="score-cell">${scoreHtml(manager.overall_score)}</td>
      </tr>`;
    })
    .join('');
  const shown = needle ? items.filter((manager) => String(manager.name || '').toLowerCase().includes(needle)) : items;
  return {
    title: 'Менеджеры',
    heading: '<h1>Менеджеры</h1>',
    html: `<form class="filters" data-filters>
        <label class="period-all"><input type="checkbox" name="period" value="all" ${query.period === 'all' ? 'checked' : ''}> Весь период</label>
        <label>С <input type="date" name="date_from" value="${esc(query.dateFrom)}" ${query.period === 'all' ? 'disabled' : ''}></label>
        <label>По <input type="date" name="date_to" value="${esc(query.dateTo)}" ${query.period === 'all' ? 'disabled' : ''}></label>
        <label class="search">Поиск по имени <input type="search" name="q" value="${esc(query.q)}" placeholder="Имя менеджера"></label>
        <button class="button" type="submit">Показать</button>
      </form>
      <div class="table-wrap"><table class="grid">
        <thead><tr>
          ${sortButton('Менеджер', 'name', query)}
          ${sortButton('Звонков', 'calls_count', query)}
          <th>Последний звонок</th>
          ${stages.map((stage) => sortButton(stage.title, `stage.${stage.key}`, query)).join('')}
          ${sortButton('Средний итог', 'overall', query)}
        </tr></thead>
        <tbody>${rows || '<tr><td class="empty-cell" colspan="12">Нет менеджеров</td></tr>'}</tbody>
      </table></div>
      <p class="pager" data-count>${managerCount(shown.length, items.length)}</p>`,
    bind(root) {
      bindFilters(root, (filtersState) => {
        navigate(projectPath(ctx.route.projectId, 'managers', managersPageSearch({ ...query, ...filtersState })));
      });
      bindSort(root, query, (next) => {
        const formState = readFilterForm(root.querySelector('[data-filters]'));
        navigate(projectPath(ctx.route.projectId, 'managers', managersPageSearch({ ...query, q: formState.q, period: formState.period, dateFrom: formState.dateFrom, dateTo: formState.dateTo, ...next })));
      });
      bindRows(root);
      const input = root.querySelector('input[name=q]');
      const apply = () => {
        const value = input.value.trim().toLowerCase();
        let visible = 0;
        root.querySelectorAll('tbody tr[data-name]').forEach((row) => {
          const match = !value || row.dataset.name.toLowerCase().includes(value);
          row.hidden = !match;
          if (match) visible += 1;
        });
        const count = root.querySelector('[data-count]');
        if (count) count.textContent = managerCount(visible, items.length);
      };
      input?.addEventListener('input', apply);
      apply();
    },
  };
}

async function renderManager(ctx) {
  const projectId = ctx.route.projectId;
  const managerId = ctx.route.managerId;
  const query = readCallsQuery(ctx.search, ctx.timeZone);
  if (query.appliedDefault) {
    navigate(projectPath(projectId, `managers/${encodeURIComponent(managerId)}`, callsPageSearch(query)), { replace: true });
    return { skip: true };
  }
  const summaryParams = new URLSearchParams();
  if (query.dateFrom) summaryParams.set('date_from', query.dateFrom);
  if (query.dateTo) summaryParams.set('date_to', query.dateTo);
  let manager;
  try {
    manager = await api(`/api/projects/${encodeURIComponent(projectId)}/managers/${encodeURIComponent(managerId)}?${summaryParams}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError('Менеджер', error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const filters = await loadFilters(projectId);
  let callsResult;
  try {
    callsResult = {
      ok: true,
      data: await api(
        `/api/projects/${encodeURIComponent(projectId)}/managers/${encodeURIComponent(managerId)}/calls?${callsApiSearch(query)}`,
      ),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    callsResult = { ok: false, error };
  }
  if (!ctx.isCurrent()) return { skip: true };
  const stages = Array.isArray(manager.stages) && manager.stages.length
    ? manager.stages.map((stage) => ({ key: stage.key, title: stage.title || DEFAULT_STAGE_TITLES[stage.key] || stage.key }))
    : stageColumns(filters.data?.stages);
  const stats = `<div class="stats">
    ${stat('Звонков', esc(manager.calls_count ?? 0), true)}
    ${stages.map((stage) => stat(stage.title, stageScoreHtml({ score: stageScoreOf(manager, stage.key) }), true)).join('')}
    ${stat('Средний итог', scoreHtml(manager.overall_score), true)}
  </div>`;
  const canRename = ctx.caps.write && manager.source?.kind && manager.source.kind !== 'plugin';
  const rename = canRename
    ? `<form class="inline-form" data-rename><input name="name" value="${esc(manager.name || '')}" required><button class="button button-secondary" type="submit">Сохранить имя</button></form>`
    : manager.source?.kind === 'plugin'
      ? '<p class="muted">Имя обновляет плагин.</p>'
      : '';
  const callsHtml = callsResult.ok
    ? `${filters.missing ? notice('Справочник стадий сделки сейчас недоступен.') : ''}${filtersHtml({
        query,
        filters: filters.data,
        includeManager: false,
        includeDeal: true,
        includeField: true,
      })}${callsTable({
        items: Array.isArray(callsResult.data?.items) ? callsResult.data.items : [],
        stages: stageColumns(filters.data?.stages),
        timeZone: ctx.timeZone,
        projectId,
        showManager: false,
        showScores: true,
        showStatus: false,
        showError: false,
        sort: query.sort,
        order: query.order,
      })}${pagination({
        page: query.page,
        perPage: query.perPage,
        total: Number(callsResult.data?.total) || 0,
        noun: CALLS_NOUN,
        hrefFor: (page, perPage) =>
          projectPath(projectId, `managers/${encodeURIComponent(managerId)}`, callsPageSearch({ ...query, page, perPage })),
      })}`
    : unavailable(translateRequestError(callsResult.error.body, callsResult.error.status));
  const email = manager.email ? `<p class="muted">${esc(manager.email)}</p>` : '';
  return {
    title: manager.name || 'Менеджер',
    heading: `<h1 class="crumbs"><a href="${esc(projectPath(projectId, 'managers', periodSearch(query)))}">Менеджеры</a><span class="crumb-sep">/</span><span>${esc(manager.name || '')}</span></h1>`,
    html: `${email}${rename}<p class="form-error" data-error hidden></p>${stats}${callsHtml}`,
    bind(root) {
      bindFilters(root, (filtersState) => {
        navigate(projectPath(projectId, `managers/${encodeURIComponent(managerId)}`, callsPageSearch({ ...query, ...filtersState, page: 1 })));
      });
      bindSort(root, query, (next) => {
        const form = root.querySelector('[data-filters]');
        const formState = form ? readFilterForm(form) : {};
        navigate(projectPath(projectId, `managers/${encodeURIComponent(managerId)}`, callsPageSearch({ ...query, ...formState, ...next, page: 1 })));
      });
      bindPager(root, (perPage) => {
        navigate(projectPath(projectId, `managers/${encodeURIComponent(managerId)}`, callsPageSearch({ ...query, perPage, page: 1 })));
      });
      bindRows(root);
      root.querySelector('[data-rename]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = root.querySelector('[data-error]');
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/managers/${encodeURIComponent(managerId)}`, {
            method: 'PATCH',
            body: { name: String(new FormData(event.currentTarget).get('name') || '') },
          });
          navigate(`${location.pathname}${location.search}`, { replace: true });
        } catch (err) {
          if (auth(err)) return;
          showError(error, err);
        }
      });
    },
  };
}

async function renderSettings(ctx) {
  let body;
  try {
    body = await api(`/api/projects/${encodeURIComponent(ctx.route.projectId)}/settings`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return missingOrError('Настройки', error);
  }
  if (!ctx.isCurrent()) return { skip: true };
  const stages = Array.isArray(body?.stages) && body.stages.length
    ? body.stages
    : [{ key: 'stage_1', title: '', weight: 1, high_score: '', defect_example: '', sample_line: '' }];
  const rows = stages.map((stage, index) => stageEditor(stage, index)).join('');
  const cardKey = typeof body?.card_key === 'string' && body.card_key ? body.card_key : '';
  return {
    title: 'Настройки',
    heading: '<h1>Настройки</h1>',
    html: `${panel(
      'Карточка этапов',
      `<form class="stack" data-settings>
        ${cardKey ? `<p class="muted">Ключ карточки: ${esc(cardKey)}</p>` : ''}
        <label>Часовой пояс <input name="timezone" value="${esc(body?.timezone || ctx.timeZone)}" required></label>
        <label>Порог длительности, секунды <input name="min_call_duration_sec" type="number" min="1" step="1" value="${esc(body?.min_call_duration_sec ?? '')}" required></label>
        <div data-stage-list>${rows}</div>
        <button class="button button-secondary" type="button" data-add-stage>Добавить этап</button>
        <p class="muted">Веса — положительные числа, сумма не обязана быть 100. Образец реплики иллюстрирует смысл и не является обязательным текстом. Уже оценённые звонки не пересчитываются.</p>
        <p class="form-error" data-error hidden></p>
        <p class="form-ok" data-saved hidden>Сохранено</p>
        <button class="button" type="submit">Сохранить карточку</button>
      </form>`,
    )}
    ${panel(
      'Промпт оценки',
      `<form class="stack" data-prompt>
        <label>Как оценивать <textarea name="body" rows="12">${esc(body?.scoring_prompt || '')}</textarea></label>
        <p class="muted">Правила балла, неприменимости и записи. Формат JSON задаёт система, этот текст его не меняет.</p>
        <p class="form-error" data-error hidden></p>
        <p class="form-ok" data-saved hidden>Сохранено</p>
        <button class="button" type="submit">Сохранить промпт</button>
      </form>`,
    )}
    ${panel(
      'Утверждённые факты продукта',
      `<form class="stack" data-facts>
        <label>Факты <textarea name="body" rows="8">${esc(body?.product_facts || '')}</textarea></label>
        <p class="muted">В оценку уходит только этот текст. Пустое поле значит, что факты не утверждены.</p>
        <p class="form-error" data-error hidden></p>
        <p class="form-ok" data-saved hidden>Сохранено</p>
        <button class="button" type="submit">Сохранить факты</button>
      </form>`,
    )}`,
    bind(root) {
      const projectId = ctx.route.projectId;
      bindScorecard(root, projectId);
      bindTextSetting(root.querySelector('[data-prompt]'), projectId, 'prompt');
      bindTextSetting(root.querySelector('[data-facts]'), projectId, 'product-facts');
    },
  };
}

function stageEditor(stage, index) {
  const key = stage.key || `stage_${index + 1}`;
  return `<fieldset class="stage-edit" data-stage>
    <legend>Этап ${index + 1}</legend>
    <label>Ключ <input name="key" value="${esc(key)}" required></label>
    <label>Название <input name="title" value="${esc(stage.title || '')}" required></label>
    <label>Вес <input name="weight" type="number" min="0.01" step="any" value="${esc(stage.weight ?? '')}" required></label>
    <label>Что значит высокий балл <textarea name="high_score" rows="2">${esc(stage.high_score || '')}</textarea></label>
    <label>Пример недочёта <textarea name="defect_example" rows="2">${esc(stage.defect_example || '')}</textarea></label>
    <label>Образец реплики <textarea name="sample_line" rows="2">${esc(stage.sample_line || '')}</textarea></label>
    <button class="button button-ghost" type="button" data-remove-stage>Убрать этап</button>
  </fieldset>`;
}

function bindScorecard(root, projectId) {
  const form = root.querySelector('[data-settings]');
  const list = form.querySelector('[data-stage-list]');
  const error = form.querySelector('[data-error]');
  const saved = form.querySelector('[data-saved]');
  form.querySelector('[data-add-stage]')?.addEventListener('click', () => {
    const index = list.querySelectorAll('[data-stage]').length;
    list.insertAdjacentHTML('beforeend', stageEditor({ key: `stage_${index + 1}`, weight: 1 }, index));
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-stage]');
    if (!button) return;
    const cards = list.querySelectorAll('[data-stage]');
    if (cards.length < 2) {
      error.hidden = false;
      error.textContent = 'В карточке нужен хотя бы один этап';
      return;
    }
    button.closest('[data-stage]')?.remove();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    saved.hidden = true;
    const duration = Number(new FormData(form).get('min_call_duration_sec'));
    if (!Number.isInteger(duration) || duration < 1) {
      error.hidden = false;
      error.textContent = 'Порог длительности — целое число больше нуля';
      return;
    }
    const stages = [...list.querySelectorAll('[data-stage]')].map((card) => {
      const fields = new FormData();
      card.querySelectorAll('input, textarea').forEach((input) => fields.append(input.name, input.value));
      return {
        key: String(fields.get('key') || '').trim(),
        title: String(fields.get('title') || '').trim(),
        weight: Number(fields.get('weight')),
        high_score: String(fields.get('high_score') || ''),
        defect_example: String(fields.get('defect_example') || ''),
        sample_line: String(fields.get('sample_line') || ''),
      };
    });
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
        method: 'PUT',
        body: {
          timezone: String(new FormData(form).get('timezone') || '').trim(),
          min_call_duration_sec: duration,
          stages,
        },
      });
      saved.hidden = false;
    } catch (err) {
      if (auth(err)) return;
      showError(error, err);
    }
  });
}

function bindTextSetting(form, projectId, path) {
  if (!form) return;
  const error = form.querySelector('[data-error]');
  const saved = form.querySelector('[data-saved]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    saved.hidden = true;
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/settings/${path}`, {
        method: 'PUT',
        body: { body: String(new FormData(form).get('body') || '') },
      });
      saved.hidden = false;
    } catch (err) {
      if (auth(err)) return;
      showError(error, err);
    }
  });
}

async function renderInputs(ctx) {
  const projectId = ctx.route.projectId;
  const scripts = await loadCollection(`/api/projects/${encodeURIComponent(projectId)}/inputs`);
  const sources = await loadCollection(`/api/projects/${encodeURIComponent(projectId)}/sources`);
  if (!ctx.isCurrent()) return { skip: true };
  const scriptItems = scripts.ok && Array.isArray(scripts.data?.items) ? scripts.data.items : [];
  const sourceItems = sources.ok && Array.isArray(sources.data?.items) ? sources.data.items : [];
  const scriptHtml = scripts.ok
    ? `${scriptItems
        .map(
          (script) => `<form class="stack script-card" data-script="${esc(script.id)}">
            <label>Название <input name="title" value="${esc(script.title || '')}" required></label>
            <label>Текст <textarea name="body" rows="4" required>${esc(script.body || '')}</textarea></label>
            <div class="inline-form">
              <button class="button button-secondary" type="submit">Сохранить</button>
              <button class="button button-ghost" type="button" data-delete-script="${esc(script.id)}">Удалить</button>
            </div>
          </form>`,
        )
        .join('') || '<p class="muted">Скриптов пока нет.</p>'}
      <form class="stack" data-new-script>
        <h3>Новый сценарий</h3>
        <label>Название <input name="title" required></label>
        <label>Текст <textarea name="body" rows="4" required></textarea></label>
        <button class="button" type="submit">Добавить скрипт</button>
      </form>`
    : unavailable(translateRequestError(scripts.error.body, scripts.error.status));
  const sourceHtml = sources.ok
    ? `<ul class="choice-list">${sourceItems
        .map((source) => {
          const when = source.last_intake_at ? formatDateTime(source.last_intake_at, ctx.timeZone) : 'приёма ещё не было';
          return `<li><span>${esc(source.display_name || '')}</span><span>${esc(source.kind || '')}${source.provider ? ` · ${esc(source.provider)}` : ''} · ${esc(when)}</span></li>`;
        })
        .join('')}</ul>
      <form class="stack" data-new-source>
        <h3>Подключить источник</h3>
        <label>Название <input name="display_name" required></label>
        <label>Поставщик
          <select name="provider">
            <option value="amocrm">amoCRM</option>
            <option value="other">Другой</option>
          </select>
        </label>
        <label data-other hidden>Код поставщика <input name="provider_other" placeholder="latin-name"></label>
        <button class="button" type="submit">Выпустить код</button>
      </form>`
    : unavailable(translateRequestError(sources.error.body, sources.error.status));
  return {
    title: 'Входные данные',
    heading: '<h1>Входные данные</h1>',
    html: `${panel('Сценарий менеджера', `<p class="muted">Текст хранится в проекте и в запрос модели не копируется.</p>${scriptHtml}`)}<p class="form-error" data-error hidden></p>${panel('Источники', sourceHtml)}`,
    bind(root) {
      const error = root.querySelector('[data-error]');
      root.querySelector('[data-new-script]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/inputs`, {
            method: 'POST',
            body: { title: String(data.get('title') || ''), body: String(data.get('body') || '') },
          });
          navigate(location.pathname, { replace: true });
        } catch (err) {
          if (auth(err)) return;
          showError(error, err);
        }
      });
      root.querySelectorAll('[data-script]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = new FormData(form);
          try {
            await api(`/api/projects/${encodeURIComponent(projectId)}/inputs/${encodeURIComponent(form.dataset.script)}`, {
              method: 'PATCH',
              body: { title: String(data.get('title') || ''), body: String(data.get('body') || '') },
            });
            error.hidden = false;
            error.classList.add('is-ok');
            error.textContent = 'Скрипт сохранён';
          } catch (err) {
            if (auth(err)) return;
            showError(error, err);
          }
        });
      });
      root.querySelectorAll('[data-delete-script]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!confirm('Удалить скрипт?')) return;
          try {
            await api(`/api/projects/${encodeURIComponent(projectId)}/inputs/${encodeURIComponent(button.dataset.deleteScript)}`, {
              method: 'DELETE',
            });
            navigate(location.pathname, { replace: true });
          } catch (err) {
            if (auth(err)) return;
            showError(error, err);
          }
        });
      });
      const sourceForm = root.querySelector('[data-new-source]');
      const provider = sourceForm?.querySelector('[name=provider]');
      const other = sourceForm?.querySelector('[data-other]');
      provider?.addEventListener('change', () => {
        other.hidden = provider.value !== 'other';
      });
      sourceForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(sourceForm);
        const selected = String(data.get('provider') || '');
        const code = selected === 'other' ? String(data.get('provider_other') || '').trim() : selected;
        if (!/^[a-z0-9_-]+$/.test(code)) {
          error.hidden = false;
          error.classList.remove('is-ok');
          error.textContent = 'Код поставщика: латиница, цифры и дефис';
          return;
        }
        try {
          const created = await api(`/api/projects/${encodeURIComponent(projectId)}/sources`, {
            method: 'POST',
            body: { provider: code, display_name: String(data.get('display_name') || '') },
          });
          location.assign(pluginConnectPath(code, created.setup_code));
        } catch (err) {
          if (auth(err)) return;
          showError(error, err);
        }
      });
    },
  };
}

function listTitle(mode) {
  if (mode === 'problems') return 'Проблемы обработки';
  if (mode === 'progress') return 'Звонки в работе';
  return 'Звонки';
}

function landing(next) {
  if (!next || next === '/login' || next.startsWith('/login?')) return '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function stat(label, valueHtml, trusted = false) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${trusted ? valueHtml : esc(valueHtml)}</div></div>`;
}

function contextHtml(context) {
  const notes = context?.notes ? `<h3>Заметка</h3><p>${esc(context.notes)}</p>` : '';
  const fields = Array.isArray(context?.fields) ? context.fields : [];
  const list = fields.length
    ? `<h3>Поля</h3><dl class="fields-list">${fields
        .map(
          (field) => `<div><dt>${esc(field.label || field.key || '')}</dt><dd>${esc(field.value || '')}</dd></div>`,
        )
        .join('')}</dl>`
    : '';
  return notes || list ? `<div class="context">${notes}${list}</div>` : '';
}

function sortButton(label, key, query) {
  const active = query.sort === key;
  const arrow = active ? (query.order === 'asc' ? '↑' : '↓') : '';
  return `<th><button type="button" class="sort${active ? ' is-active' : ''}" data-sort="${esc(key)}">${esc(label)} <span class="arrow">${arrow}</span></button></th>`;
}

function lastCallCell(value, timeZone) {
  if (!value) return '<span class="muted">—</span>';
  return esc(formatDateTime(value, timeZone));
}

function coverageNote(call) {
  if (call?.preliminary !== true) return '';
  const coverage = Number(call.coverage);
  const percent = Number.isFinite(coverage) ? `${Math.round(coverage * 100)}%` : '—';
  return `<p class="muted">Предварительно: часть этапов не видна в записи. Покрытие ${percent}.</p>`;
}

function evidenceHtml(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  const links = ids
    .map((id) => `<a href="#turn-${esc(id)}">${esc(id)}</a>`)
    .join(', ');
  return `<div class="instruction">Реплики: ${links}</div>`;
}

function flagsAndPayment(call) {
  if (!Array.isArray(call?.flags) && !call?.payment_agreement) return '';
  const flags = Array.isArray(call.flags) ? call.flags : [];
  const flagList = flags.length
    ? `<ul class="choice-list">${flags
        .map((flag) => `<li><span>${esc(flag.code || '')}</span><span>${evidenceHtml(flag.evidence_ids)}</span></li>`)
        .join('')}</ul>`
    : '<p class="muted">Нарушений нет</p>';
  const payment = call.payment_agreement || {};
  const agreed = payment.agreed === true ? 'Есть' : payment.agreed === false ? 'Нет' : 'Не определена';
  const summary = payment.summary ? ` · ${esc(payment.summary)}` : '';
  return `<h3>Нарушения</h3>${flagList}<h3>Договорённость об оплате</h3><p>${agreed}${summary}</p>${evidenceHtml(payment.evidence_ids)}`;
}

function managerStageColumns(items) {
  const sample = items.find((item) => Array.isArray(item.stages) && item.stages.length);
  if (!sample) return [];
  return sample.stages.map((stage) => ({
    key: stage.key,
    title: stage.title || DEFAULT_STAGE_TITLES[stage.key] || stage.key,
  }));
}

function stageScoreOf(manager, key) {
  const found = Array.isArray(manager.stages) ? manager.stages.find((stage) => stage.key === key) : null;
  return found ? found.score : null;
}

function managerCount(shown, total) {
  if (shown === total) return `${total} ${plural(total, ...MANAGERS_NOUN)}`;
  return `Показано ${shown} из ${total}`;
}

function periodSearch(query) {
  const params = new URLSearchParams();
  if (query.period === 'all') params.set('period', 'all');
  else {
    if (query.dateFrom) params.set('date_from', query.dateFrom);
    if (query.dateTo) params.set('date_to', query.dateTo);
  }
  return params;
}

function readFilterForm(form) {
  const data = new FormData(form);
  const period = data.get('period') === 'all';
  return {
    period: period ? 'all' : '',
    dateFrom: period ? '' : String(data.get('date_from') || ''),
    dateTo: period ? '' : String(data.get('date_to') || ''),
    q: String(data.get('q') || '').trim(),
    manager: String(data.get('manager') || ''),
    dealStatus: String(data.get('deal_status') || ''),
    fieldKey: String(data.get('field_key') || '').trim(),
    fieldValue: String(data.get('field_value') || '').trim(),
  };
}

function bindFilters(root, onApply) {
  const form = root.querySelector('[data-filters]');
  if (!form) return;
  const error = root.querySelector('[data-filter-error]');
  const dates = () => form.querySelectorAll('input[type="date"]');
  form.addEventListener('change', (event) => {
    if (event.target.name === 'period') {
      const disabled = event.target.checked;
      dates().forEach((input) => {
        input.disabled = disabled;
      });
    }
    if (event.target.matches('input[type="search"]')) return;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const state = readFilterForm(form);
    if (Boolean(state.fieldKey) !== Boolean(state.fieldValue)) {
      if (error) {
        error.hidden = false;
        error.textContent = 'Ключ и значение произвольного поля нужно указать вместе.';
      }
      return;
    }
    if (error) error.hidden = true;
    onApply(state);
  });
}

function bindSort(root, query, onSort) {
  root.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => onSort(toggleSort(query.sort, query.order, button.dataset.sort)));
  });
}

function bindPager(root, onPerPage) {
  root.querySelector('[data-per-page]')?.addEventListener('change', (event) => {
    onPerPage(Number(event.target.value));
  });
}

function bindRows(root) {
  const scope = root.querySelector('.main') || root.querySelector('.table-wrap');
  scope?.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, select, textarea, label')) return;
    const row = event.target.closest('[data-href]');
    if (row) navigate(row.dataset.href);
  });
}

function bindPlayer(root) {
  const audio = root.querySelector('audio');
  const play = root.querySelector('[data-play]');
  if (!audio || !play) return;
  const seek = root.querySelector('[data-seek]');
  const time = root.querySelector('[data-time]');
  const speeds = [...root.querySelectorAll('[data-speed]')];
  const paint = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : Number(audio.dataset.fallback || 0);
    const clock = `${formatClock(audio.currentTime)} / ${formatClock(duration || 0)}`;
    if (time) time.textContent = clock;
    if (seek && document.activeElement !== seek && duration > 0) {
      seek.value = String(Math.round((audio.currentTime / duration) * 1000));
    }
    let active = null;
    root.querySelectorAll('[data-line]').forEach((line) => {
      if (Number(line.dataset.start) <= audio.currentTime) active = line;
      line.classList.remove('is-active');
    });
    active?.classList.add('is-active');
  };
  const syncPlay = () => {
    const paused = audio.paused;
    play.dataset.state = paused ? 'play' : 'pause';
    play.setAttribute('aria-label', paused ? 'Воспроизведение' : 'Пауза');
  };
  play.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => showAudioError(root));
    else audio.pause();
  });
  audio.addEventListener('play', syncPlay);
  audio.addEventListener('pause', syncPlay);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('error', () => showAudioError(root));
  seek?.addEventListener('input', () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : Number(audio.dataset.fallback || 0);
    if (duration > 0) audio.currentTime = (Number(seek.value) / 1000) * duration;
  });
  speeds.forEach((button) => {
    button.addEventListener('click', () => {
      audio.playbackRate = Number(button.dataset.speed);
      speeds.forEach((item) => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
    });
  });
  root.querySelectorAll('[data-seek-to]').forEach((button) => {
    button.addEventListener('click', () => {
      audio.currentTime = Number(button.dataset.seekTo) || 0;
      audio.play().catch(() => showAudioError(root));
    });
  });
}

function bindTranscriptSearch(root) {
  const input = root.querySelector('[data-transcript-search]');
  input?.addEventListener('input', () => {
    const needle = input.value.trim().toLowerCase();
    root.querySelectorAll('[data-line]').forEach((line) => {
      const text = line.querySelector('.line-text')?.textContent?.toLowerCase() || '';
      line.hidden = Boolean(needle) && !text.includes(needle);
    });
  });
}

function showAudioError(root) {
  const error = root.querySelector('[data-audio-error]');
  if (error) error.hidden = false;
}

function readCustomFields(form) {
  const keys = [...form.querySelectorAll('[name=field_key]')].map((input) => input.value.trim());
  const labels = [...form.querySelectorAll('[name=field_label]')].map((input) => input.value.trim());
  const values = [...form.querySelectorAll('[name=field_value]')].map((input) => input.value);
  const fields = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const label = labels[index];
    const value = values[index] ?? '';
    if (!key && !label && !value.trim()) continue;
    if (!key || !label) return { error: 'У произвольного поля нужны ключ и подпись' };
    fields.push({ key, label, value });
  }
  return { fields };
}

async function loadFilters(projectId) {
  try {
    return { missing: false, data: await api(`/api/projects/${encodeURIComponent(projectId)}/filters`) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return { missing: true, data: null, error };
  }
}

async function loadCollection(path) {
  try {
    return { ok: true, data: await api(path) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return { ok: false, error };
  }
}

function missingOrError(title, error) {
  const text = isMissingEndpoint(error)
    ? 'Сервер пока не отдаёт этот раздел.'
    : translateRequestError(error.body, error.status);
  return { title, heading: `<h1>${esc(title)}</h1>`, html: unavailable(text) };
}

function showError(node, error) {
  if (!node) return;
  node.hidden = false;
  node.classList.remove('is-ok');
  node.textContent = error instanceof ApiError ? translateRequestError(error.body, error.status) : 'Не удалось выполнить запрос';
}

function auth(error) {
  if (error instanceof ApiError && error.status === 401) {
    navigate('/login', { replace: true });
    return true;
  }
  return false;
}

function remember(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable */
  }
}

function recall(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

