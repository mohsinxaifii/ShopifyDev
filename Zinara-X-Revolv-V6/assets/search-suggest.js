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
        `&resources[type]=product,query&resources[limit]=${LIMIT}` +
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

      if (queries.length) {
        this.panel.appendChild(
          this.section(
            'Suggestions',
            queries.map((query) => {
              const row = document.createElement('a');
              row.className = 'search-suggest_panel_row search-suggest_panel_row--query';
              row.href = query.url;
              row.setAttribute('role', 'option');
              row.textContent = query.text;
              return row;
            }),
          ),
        );
      }

      if (products.length) {
        this.panel.appendChild(
          this.section(
            'Products',
            products.map((product) => {
              const row = document.createElement('a');
              row.className = 'search-suggest_panel_row search-suggest_panel_row--product';
              row.href = product.url;
              row.setAttribute('role', 'option');

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
      return link;
    }
  }

  if (!customElements.get('search-suggest')) customElements.define('search-suggest', SearchSuggest);
})();
