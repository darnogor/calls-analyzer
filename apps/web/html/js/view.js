import {
  ALL_MANAGERS,
  EMPTY_DEAL_STAGE,
  dealCurrentStage,
  directionLabel,
  esc,
  formatDateTime,
  formatDuration,
  formatScore,
  formatTimecode,
  initials,
  plural,
  projectPath,
  roleLabel,
  safeHttpUrl,
  scoreBand,
  speakerLabel,
  stageEntry,
  translateCallError,
  translateStatus,
} from './format.js';

const ICONS = {
  phone:
    '<path d="M8 4.5h2.2l1.2 3-1.7 1a11 11 0 0 0 5.8 5.8l1-1.7 3 1.2V16a1.5 1.5 0 0 1-1.6 1.5A14.5 14.5 0 0 1 6.5 6.1 1.5 1.5 0 0 1 8 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  clock:
    '<circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.2V12l2.6 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  alert:
    '<path d="M12 4.5 20 18.5H4L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.7" r="0.8" fill="currentColor"/>',
  person:
    '<circle cx="12" cy="8" r="2.7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 18.2c.8-2.6 2.8-3.9 5.5-3.9s4.7 1.3 5.5 3.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  doc:
    '<path d="M8 4.5h5.2L18 9.2V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 19V6A1.5 1.5 0 0 1 8.5 4.5H8z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 4.8V9h4.2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  gear:
    '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 4.5v1.8M12 17.7v1.8M4.5 12h1.8M17.7 12h1.8M6.7 6.7l1.3 1.3M16 16l1.3 1.3M17.3 6.7 16 8M8 16l-1.3 1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  grid:
    '<rect x="4.5" y="4.5" width="6.2" height="6.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="4.5" width="6.2" height="6.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="4.5" y="13.3" width="6.2" height="6.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="13.3" width="6.2" height="6.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  users:
    '<circle cx="9" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="9.5" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.8 17.8c.6-2.3 2.3-3.5 4.2-3.5s3.6 1.2 4.2 3.5M13.2 14.5c1.5-.2 3 .6 3.7 2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function shell({ heading, me, project, caps, route, content }) {
  return `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/">
        <span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 13h2.2l1.6-4.2 2.3 8.4 2-6.2 1.5 2h6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span>Call Analytics</span>
      </a>
      ${project ? `<a class="project-chip" href="/">${esc(project.name)}</a>` : ''}
      <nav class="nav">${navHtml(project, caps, route)}</nav>
      ${project && caps?.role ? `<p class="role-note">${esc(roleLabel(caps.role))}</p>` : ''}
    </aside>
    <main class="main">
      <div class="page-head">
        <div class="page-title">${heading}</div>
        ${userMenu(me)}
      </div>
      ${content}
    </main>
  </div>`;
}

export function scoreHtml(score, extraClass = '') {
  const text = formatScore(score);
  const classes = ['score', text == null ? 'score-empty' : `score-${scoreBand(score)}`, extraClass].filter(Boolean).join(' ');
  if (text == null) return `<span class="${classes}">—</span>`;
  return `<span class="${classes}">${esc(text)}</span>`;
}

export function stageScoreHtml(stage) {
  const status = stage && typeof stage === 'object' ? stage.status : undefined;
  if (status === 'not_applicable' || status === 'unobservable') {
    return '<span class="score score-dash">—</span>';
  }
  const score = stage && typeof stage === 'object' ? stage.score : stage;
  const text = formatScore(score);
  if (text == null) return '<span class="score score-empty">—</span>';
  const value = Number(score);
  const band = value <= 4 ? pointBand(value) : scoreBand(value);
  return `<span class="score score-${band}">${esc(text)}</span>`;
}

function pointBand(value) {
  if (value >= 4) return 'green';
  if (value >= 3) return 'yellow';
  return 'red';
}

export function personHtml(call) {
  const company = typeof call.company_name === 'string' ? call.company_name.trim() : '';
  const contactName = call.contact?.name ? String(call.contact.name).trim() : '';
  const url = safeHttpUrl(call.contact?.external_url);
  const companyHtml = company ? `<div class="primary">${esc(company)}</div>` : '';
  let contactHtml = '';
  if (contactName && url) {
    contactHtml = `<a class="subtle-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(contactName)}</a>`;
  } else if (contactName) {
    contactHtml = `<div class="secondary">${esc(contactName)}</div>`;
  }
  if (!companyHtml && !contactHtml) return '<span class="muted">—</span>';
  return companyHtml + contactHtml;
}

export function callsTable({
  items,
  stages,
  timeZone,
  projectId,
  showManager,
  showScores,
  showStatus,
  showError,
  sort,
  order,
}) {
  const headers = [
    sortHeader('Дата / время', 'started_at', sort, order),
    showManager ? sortHeader('Менеджер', 'manager', sort, order) : '',
    '<th>Клиент / компания</th>',
    '<th>Длит.</th>',
    '<th>Этап сделки</th>',
    showScores ? stages.map((stage) => sortHeader(stage.title, `stage.${stage.key}`, sort, order)).join('') : '',
    showScores ? sortHeader('Итог', 'overall', sort, order) : '',
    showStatus ? '<th>Обработка</th>' : '',
    showError ? '<th>Ошибка</th>' : '',
  ].join('');
  const rows = items.length
    ? items.map((call) => callRow(call, { stages, timeZone, projectId, showManager, showScores, showStatus, showError })).join('')
    : '';
  const columns = 4 + (showManager ? 1 : 0) + (showScores ? stages.length + 1 : 0) + (showStatus ? 1 : 0) + (showError ? 1 : 0);
  return `<div class="table-wrap"><table class="grid">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows || `<tr><td class="empty-cell" colspan="${columns}">Нет звонков</td></tr>`}</tbody>
  </table></div>`;
}

export function pagination({ page, perPage, total, noun, hrefFor }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const range = total === 0 ? '0' : `${from}–${to}`;
  const label = plural(total, noun[0], noun[1], noun[2]);
  const prev = page > 1 ? `<a class="page-btn" href="${esc(hrefFor(page - 1, perPage))}" aria-label="Предыдущая">‹</a>` : '<span class="page-btn is-disabled">‹</span>';
  const next = page < pages ? `<a class="page-btn" href="${esc(hrefFor(page + 1, perPage))}" aria-label="Следующая">›</a>` : '<span class="page-btn is-disabled">›</span>';
  const options = [20, 50, 100]
    .map((size) => `<option value="${size}" ${size === perPage ? 'selected' : ''}>${size}</option>`)
    .join('');
  return `<div class="pager">
    <p>Показано ${range} из ${total} ${label}</p>
    <div class="pager-side">
      ${prev}<span class="page-current">${page}</span>${next}
      <label class="per-page">На странице <select data-per-page>${options}</select></label>
    </div>
  </div>`;
}

export function filtersHtml({ query, filters, includeManager, includeDeal, includeField }) {
  const managers = Array.isArray(filters?.managers) ? filters.managers : [];
  const deals = Array.isArray(filters?.deal_statuses) ? filters.deal_statuses : [];
  const managerOptions = [`<option value="">${esc(ALL_MANAGERS)}</option>`]
    .concat(managers.map((manager) => option(manager.id, manager.name, query.manager)))
    .join('');
  const knownManager = !query.manager || managers.some((manager) => manager.id === query.manager);
  const managerSelect = knownManager
    ? managerOptions
    : `${managerOptions}<option value="${esc(query.manager)}" selected>Выбранный менеджер</option>`;
  const dealOptions = [`<option value="">${esc(EMPTY_DEAL_STAGE)}</option>`]
    .concat(deals.map((status) => option(status, status, query.dealStatus)))
    .join('');
  const dealSelect =
    query.dealStatus && !deals.includes(query.dealStatus)
      ? `${dealOptions}<option value="${esc(query.dealStatus)}" selected>${esc(query.dealStatus)}</option>`
      : dealOptions;
  return `<form class="filters" data-filters>
    <label class="period-all"><input type="checkbox" name="period" value="all" ${query.period === 'all' ? 'checked' : ''}> Весь период</label>
    <label>С <input type="date" name="date_from" value="${esc(query.dateFrom)}" ${query.period === 'all' ? 'disabled' : ''}></label>
    <label>По <input type="date" name="date_to" value="${esc(query.dateTo)}" ${query.period === 'all' ? 'disabled' : ''}></label>
    <label class="search">Поиск
      <input type="search" name="q" value="${esc(query.q)}" placeholder="Клиент, компания, телефон, менеджер или сделка">
    </label>
    ${includeManager ? `<label>Менеджер <select name="manager" aria-label="Менеджер">${managerSelect}</select></label>` : ''}
    ${includeDeal ? `<label>Стадия сделки <select name="deal_status" aria-label="Стадия сделки">${dealSelect}</select></label>` : ''}
    ${
      includeField
        ? `<label>Ключ поля <input name="field_key" value="${esc(query.fieldKey || '')}" placeholder="segment"></label>
           <label>Значение <input name="field_value" value="${esc(query.fieldValue || '')}"></label>`
        : ''
    }
    <button class="button" type="submit">Показать</button>
  </form>
  <p class="form-error" data-filter-error hidden></p>`;
}

export function notice(text) {
  return `<p class="notice">${esc(text)}</p>`;
}

export function panel(title, body) {
  return `<section class="panel">${title ? `<h2>${esc(title)}</h2>` : ''}${body}</section>`;
}

export function unavailable(text) {
  return panel('', `<div class="empty-state"><p>${esc(text)}</p></div>`);
}

export function forbidden(text) {
  return panel('', `<div class="empty-state"><h2>Недоступно</h2><p>${esc(text)}</p></div>`);
}

function navHtml(project, caps, route) {
  const items = [];
  if (!project) {
    items.push({ href: '/', id: 'projects', label: 'Проекты', icon: 'grid' });
    if (caps?.accounts) items.push({ href: '/accounts', id: 'accounts', label: 'Аккаунты', icon: 'users' });
  } else {
    items.push({
      href: projectPath(project.id, 'calls'),
      id: 'calls',
      label: 'Звонки',
      icon: 'phone',
      names: ['calls', 'call', 'call-new'],
    });
    if (caps?.problems) {
      items.push({ href: projectPath(project.id, 'progress'), id: 'progress', label: 'В работе', icon: 'clock' });
      items.push({ href: projectPath(project.id, 'problems'), id: 'problems', label: 'Проблемы', icon: 'alert' });
    }
    items.push({
      href: projectPath(project.id, 'managers'),
      id: 'managers',
      label: 'Менеджеры',
      icon: 'person',
      names: ['managers', 'manager'],
    });
    if (caps?.write) items.push({ href: projectPath(project.id, 'inputs'), id: 'inputs', label: 'Входные данные', icon: 'doc' });
    if (caps?.settings) items.push({ href: projectPath(project.id, 'settings'), id: 'settings', label: 'Настройки', icon: 'gear' });
  }
  return items
    .map((item) => {
      const names = item.names || [item.id];
      const active = names.includes(route?.name) ? ' is-active' : '';
      return `<a class="nav-link${active}" href="${esc(item.href)}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
    })
    .join('');
}

function userMenu(me) {
  if (!me) return '';
  const accounts = me.is_administrator ? '<a href="/accounts">Аккаунты</a>' : '';
  return `<div class="user">
    <button type="button" class="avatar" data-user aria-haspopup="menu" aria-label="Меню аккаунта">${esc(initials(me.name))}</button>
    <div class="user-menu" data-user-menu hidden>
      <strong>${esc(me.name || '')}</strong>
      <span>${esc(me.email || '')}</span>
      <a href="/">Проекты</a>
      ${accounts}
      <button type="button" data-logout>Выйти</button>
    </div>
  </div>`;
}

function sortHeader(label, key, sort, order) {
  const active = sort === key;
  const arrow = active ? (order === 'asc' ? '↑' : '↓') : '';
  return `<th><button type="button" class="sort${active ? ' is-active' : ''}" data-sort="${esc(key)}">${esc(label)} <span class="arrow">${arrow}</span></button></th>`;
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
}

function callRow(call, options) {
  const href = projectPath(options.projectId, `calls/${encodeURIComponent(call.id)}`);
  const when = formatDateTime(call.started_at, options.timeZone);
  const manager = call.manager?.name ? esc(call.manager.name) : '<span class="muted">—</span>';
  const stage = dealCurrentStage(call.deal);
  const scores = options.showScores
    ? options.stages.map((column) => `<td class="score-cell">${stageScoreHtml(stageEntry(call.stages, column.key))}</td>`).join('') +
      `<td class="score-cell">${scoreHtml(call.overall_score)}</td>`
    : '';
  const status = options.showStatus ? `<td>${esc(translateStatus(call.processing_status))}</td>` : '';
  const errorCode = call.error && typeof call.error === 'object' ? call.error.message : '';
  const errorText = translateCallError(typeof errorCode === 'string' ? errorCode : '');
  const error = options.showError ? `<td>${errorText ? esc(errorText) : '<span class="muted">—</span>'}</td>` : '';
  return `<tr data-href="${esc(href)}">
    <td><a class="row-link" href="${esc(href)}">${esc(when)}</a></td>
    ${options.showManager ? `<td>${manager}</td>` : ''}
    <td>${personHtml(call)}</td>
    <td>${esc(formatDuration(call.duration_sec))}</td>
    <td>${stage ? esc(stage) : '<span class="muted">—</span>'}</td>
    ${scores}${status}${error}
  </tr>`;
}

export function transcriptHtml(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '<p class="muted">Транскрипта нет</p>';
  }
  return lines
    .map((line) => {
      const speaker = line?.speaker === 'client' ? 'client' : line?.speaker === 'manager' ? 'manager' : 'other';
      const start = Number(line?.start);
      const text = typeof line?.text === 'string' ? line.text : '';
      const turnId = typeof line?.id === 'string' ? line.id : '';
      const anchor = turnId ? ` id="turn-${esc(turnId)}"` : '';
      return `<div class="line" data-line data-start="${Number.isFinite(start) ? start : 0}"${anchor}>
        <button type="button" class="timecode" data-seek-to="${Number.isFinite(start) ? start : 0}">${esc(formatTimecode(start))}</button>
        <span class="speaker speaker-${speaker}">${esc(speakerLabel(line?.speaker))}</span>
        <p class="line-text">${esc(text)}</p>
      </div>`;
    })
    .join('');
}

export function externalLink(url, label) {
  const safe = safeHttpUrl(url);
  if (!label) return '<span class="muted">—</span>';
  if (!safe) return esc(label);
  return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

export function directionText(direction) {
  return directionLabel(direction);
}
