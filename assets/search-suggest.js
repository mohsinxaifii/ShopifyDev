/**
 * Header predictive search. Figma: "Search active" 7930:105820, "Results found"
 * 7930:106038, "Results not found" 7930:106256.
 *
 * Backed by Shopify's /search/suggest.json rather than a filtered product feed:
 * only that endpoint ranks a partial term and returns the query suggestions the
 * design shows above the products.
 */
(() => {
  const DEBOUNCE = 220;
  const LIMIT = 3;

  class SearchSuggest extends HTMLElement {
    connectedCallback() {
      this.form = this.querySelector('[data-suggest-form]');
      this.input = this.querySelector('[data-suggest-input]');
      this.panel = this.querySelector('[data-suggest-panel]');
      this.clear = this.querySelector('[data-suggest-clear]');
      if (!this.form || !this.input || !this.panel) return;

      this.header = this.closest('.header') || document.querySelector('.header');
      try {
        this.znow = JSON.parse(this.querySelector('[data-suggest-znow]')?.textContent || 'null');
      } catch {
        this.znow = null;
      }
      this.timer = null;
      this.controller = null;

      this.input.addEventListener('focus', () => this.open());
      this.input.addEventListener('input', () => {
        this.syncClear();
        this.schedule();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          this.input.blur();
          this.close();
        }
      });

      this.clear?.addEventListener('click', () => {
        this.input.value = '';
        this.syncClear();
        this.renderPanel(null);
        this.input.focus();
      });

      // A pointerdown outside closes; using pointerdown rather than click means
      // a press that starts on the page dismisses before it can also activate
      // whatever sits under the scrim.
      this.onOutside = (event) => {
        if (!this.contains(event.target)) this.close();
      };
      document.addEventListener('pointerdown', this.onOutside);

      this.syncClear();
    }

    disconnectedCallback() {
      document.removeEventListener('pointerdown', this.onOutside);
      clearTimeout(this.timer);
      this.controller?.abort();
    }

    /* -------------------------------------------------------------- state */

    open() {
      // Once per opening. On phones the header's search icon reveals and
      // focuses this field, which is where the search was opened from.
      if (!this.header?.classList.contains('is-searching')) {
        const fromIcon = this.header?.getAttribute('data-search-open') === 'true';
        window.zinaraTrack?.('search_open', { click_location: fromIcon ? 'header_icon' : 'search_bar' });
      }
      this.header?.classList.add('is-searching');
      document.documentElement.classList.add('search-suggest-open');
      if (this.input.value.trim()) this.schedule();
    }

    close() {
      this.header?.classList.remove('is-searching');
      document.documentElement.classList.remove('search-suggest-open');
      this.panel.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
    }

    syncClear() {
      if (this.clear) this.clear.hidden = this.input.value.trim() === '';
    }

    /* ------------------------------------------------------------- fetch */

    schedule() {
      clearTimeout(this.timer);
      const term = this.input.value.trim();
      if (term === '') {
        this.renderPanel(null);
        return;
      }
      this.timer = setTimeout(() => this.fetch(term), DEBOUNCE);
    }

    async fetch(term) {
      // Abort the previous request: without this a slow early keystroke can
      // resolve after a fast later one and repaint the panel with stale hits.
      this.controller?.abort();
      this.controller = new AbortController();

      const root = window.Shopify?.routes?.root || '/';
      const url =
        `${root}search/suggest.json?q=${encodeURIComponent(term)}` +
        // limit_scope=each: without it the limit is shared by both types, so
        // the query suggestions crowded the products down to one.
        `&resources[type]=product,query&resources[limit]=${LIMIT}&resources[limit_scope]=each` +
        `&resources[options][unavailable_products]=last`;

      try {
        const response = await fetch(url, { signal: this.controller.signal });
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        this.renderPanel(data.resources?.results || {}, term);
      } catch (error) {
        if (error.name === 'AbortError') return;
        // A failed suggestion lookup should still leave the shopper a way
        // through to the full results page.
        this.renderPanel({}, term);
      }
    }

    /* ------------------------------------------------------------ render */

    renderPanel(results, term) {
      if (!results) {
        this.panel.hidden = true;
        this.panel.replaceChildren();
        this.input.setAttribute('aria-expanded', 'false');
        return;
      }

      const queries = (results.queries || []).slice(0, LIMIT);
      const products = (results.products || []).slice(0, LIMIT);
      this.panel.replaceChildren();

      const suggestions = queries.map((query, index) => {
        const row = document.createElement('a');
        row.className = 'search-suggest_panel_row search-suggest_panel_row--query';
        row.href = query.url;
        row.setAttribute('role', 'option');
        row.textContent = query.text;
        this.tagRow(row, term, query.text, 'query', index + 1);
        return row;
      });
      const znowRow = this.znowRow(term, suggestions.length + 1);
      if (znowRow) suggestions.push(znowRow);

      if (suggestions.length) {
        this.panel.appendChild(this.section('Suggestions', suggestions));
      }

      if (products.length) {
        this.panel.appendChild(
          this.section(
            'Products',
            products.map((product, index) => {
              const row = document.createElement('a');
              row.className = 'search-suggest_panel_row search-suggest_panel_row--product';
              row.href = product.url;
              row.setAttribute('role', 'option');
              this.tagRow(row, term, product.title, 'product', index + 1);

              const media = document.createElement('span');
              media.className = 'search-suggest_panel_row_media';
              const src = product.featured_image?.url;
              if (src) {
                const img = document.createElement('img');
                img.src = src;
                img.alt = '';
                img.loading = 'lazy';
                media.appendChild(img);
              }

              const title = document.createElement('span');
              title.className = 'search-suggest_panel_row_title';
              title.textContent = product.title;

              row.append(media, title);
              return row;
            }),
          ),
        );
      }

      this.panel.appendChild(this.footer(term));
      this.panel.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    }

    /* Z-Now (Figma 8470:74266): "Rings · Now · Get today" under the
       suggestions when the term names a category with same-day stock -
       "ring", "rings", "earr" - for a shopper in the ZNow area; it opens
       that category in the ZNow collection. "Get today" turns "Get tomorrow"
       past the cut-off ([data-znow-when], snippets/location). */
    znowRow(term, position) {
      if (!this.znow?.categories?.length || !document.documentElement.classList.contains('is-znow')) return null;
      const stem = (word) => word.replace(/s$/, '');
      const words = term.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3).map(stem);
      if (!words.length) return null;
      const category = this.znow.categories.find((entry) =>
        entry.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((word) => word && word !== 'and')
          .map(stem)
          .some((name) => words.some((word) => name.startsWith(word))),
      );
      if (!category) return null;

      const row = document.createElement('a');
      row.className = 'search-suggest_panel_row search-suggest_panel_row--query search-suggest_panel_row--znow';
      row.href = category.url;
      row.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = category.name;
      const pill = document.createElement('span');
      pill.className = 'search-suggest_znow';
      pill.innerHTML =
        `<span class="search-suggest_znow_now">${this.znow.icon}<span>Now</span></span>` +
        `<span aria-hidden="true">·</span>` +
        `<span data-znow-when="today">Get today</span><span data-znow-when="tomorrow">Get tomorrow</span>`;
      row.append(label, pill);
      this.tagRow(row, term, `${category.name} (Z-Now)`, 'znow', position);
      return row;
    }

    section(label, rows) {
      const group = document.createElement('div');
      group.className = 'search-suggest_panel_group';

      const heading = document.createElement('p');
      heading.className = 'search-suggest_panel_group_label';
      heading.textContent = label;

      const list = document.createElement('div');
      list.className = 'search-suggest_panel_group_rows';
      list.append(...rows);

      group.append(heading, list);
      return group;
    }

    footer(term) {
      const root = window.Shopify?.routes?.root || '/';
      const link = document.createElement('a');
      link.className = 'search-suggest_panel_all';
      link.href = `${root}search?q=${encodeURIComponent(term)}&type=product`;
      link.innerHTML =
        `<span class="search-suggest_panel_all_label"></span>` +
        `<span class="search-suggest_panel_all_icon" aria-hidden="true">` +
        `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12m0 0-4.5-4.5M16 10l-4.5 4.5" ` +
        `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
      link.querySelector('.search-suggest_panel_all_label').textContent = `Search for “${term}”`;
      this.tagRow(link, term, term, 'search_all', 1);
      return link;
    }

    /* search_suggestion_click, sent by analytics.js when the row is followed. */
    tagRow(row, term, text, type, position) {
      row.dataset.analytics = 'search_suggestion_click';
      row.dataset.analyticsSearchTerm = term;
      row.dataset.analyticsSuggestionText = text;
      row.dataset.analyticsSuggestionType = type;
      row.dataset.analyticsPosition = String(position);
    }
  }

  if (!customElements.get('search-suggest')) customElements.define('search-suggest', SearchSuggest);
})();
