export function navigate(url, { replace = false } = {}) {
  const next = typeof url === 'string' ? url : `${url.pathname}${url.search}`;
  const current = `${location.pathname}${location.search}`;
  if (next === current) {
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  history[replace ? 'replaceState' : 'pushState']({}, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function startRouter(onChange) {
  window.addEventListener('popstate', onChange);
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  });
}
