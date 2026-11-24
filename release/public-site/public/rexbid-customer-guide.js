/* Local help filtering only: no requests, account mutations or persisted queries. */
(() => {
  'use strict';
  const root = document.querySelector('[data-customer-help]');
  if (!root) return;
  const input = root.querySelector('[data-help-query]');
  const tools = root.querySelector('[data-help-tools]');
  const count = root.querySelector('[data-help-count]');
  const empty = root.querySelector('[data-help-empty]');
  const reset = root.querySelector('[data-help-reset]');
  const buttons = Array.from(root.querySelectorAll('[data-help-category]'));
  const groups = Array.from(root.querySelectorAll('[data-help-group]'));
  const items = Array.from(root.querySelectorAll('[data-help-answer]'));
  if (!input || !tools || !count || !empty || !reset || !items.length) return;
  const fold = value => String(value).toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim();
  const texts = new Map(items.map(item => [item, fold(item.textContent)]));
  let category = 'all';
  const apply = () => {
    const terms = fold(input.value).split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const item of items) {
      const matchCategory = category === 'all' || item.closest('[data-help-group]').dataset.helpGroup === category;
      const matchText = terms.every(term => texts.get(item).includes(term));
      item.hidden = !(matchCategory && matchText);
      if (!item.hidden) visible++;
    }
    for (const group of groups) group.hidden = !Array.from(group.querySelectorAll('[data-help-answer]')).some(item => !item.hidden);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.helpCategory === category));
    count.textContent = 'Wyświetlane odpowiedzi: ' + visible + ' z ' + items.length + '.';
    empty.hidden = visible > 0;
  };
  for (const button of buttons) button.addEventListener('click', () => { category = button.dataset.helpCategory; apply(); });
  input.addEventListener('input', apply);
  reset.addEventListener('click', () => { input.value = ''; category = 'all'; apply(); input.focus(); });
  tools.hidden = false;
  apply();
})();
