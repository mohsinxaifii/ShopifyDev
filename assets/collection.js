/**
 * PLP behaviour: the filter rail, the sort menu, the price range and load-more.
 *
 * Filtering and sorting both go through the same path - rewrite the query string
 * from the form, fetch that URL, and swap in the grid, the rail and the count
 * from the response. That keeps Shopify's storefront filtering as the source of
 * truth (counts, disabled values, the sort list) instead of reimplementing it,
 * and it keeps the URL shareable.
 *
 * On phones the rail is a full-screen panel (Figma Mobile Filters 8190:42455)
 * where changes are only staged: nothing is fetched until Apply, the close
 * button puts back what was there when it opened, and Clear all empties it.
 */
class CollectionPage extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('[data-filter-form]');
    if (!this.form) return;

    this.sortInput = this.querySelector('[data-sort-input]');

    this.form.addEventListener('change', (event) => {
      if (event.target.closest('[data-price-filter]')) return; // price commits on release
      if (this.isStaging()) return this.syncTabCounts();
      this.submit();
    });

    this.addEventListener('click', (event) => {
      // Phones: the Sort | Filters bar and the two sheets it opens.
      if (event.target.closest('[data-mobile-sort]')) return this.toggleSort();
      if (event.target.closest('[data-mobile-filters]')) return this.setFiltersOpen(true);
      if (event.target.closest('[data-filters-close]')) return this.discardFilters();
      if (event.target.closest('[data-filters-apply]')) return this.applyFilters();
      if (event.target.closest('[data-filters-clear]')) return this.clearFilters();
      if (event.target.closest('[data-sort-close]')) return this.closeSort();
      if (event.target.closest('[data-sheet-scrim]')) {
        this.discardFilters();
        return this.closeSort();
      }

      const tab = event.target.closest('[data-filter-tab]');
      if (tab) return this.selectTab(Number(tab.dataset.filterTab));

      const preset = event.target.closest('[data-price-preset]');
      if (preset) return this.applyPreset(preset);

      const sortOption = event.target.closest('[data-sort-option]');
      if (sortOption) return this.applySort(sortOption);

      if (event.target.closest('[data-sort-trigger]')) return this.toggleSort();

      const moreLink = event.target.closest('[data-more-link]');
      if (moreLink) {
        event.preventDefault();
        return this.loadMore(moreLink);
      }

      // A card's Add to cart is handled site-wide by variant-drawer.js, which
      // asks for the variant first.
    });

    document.addEventListener('click', this.closeSortOnOutsideClick);
    this.setupPrice();

    // Restore the grid when the shopper walks back through filter states.
    window.addEventListener('popstate', () => this.render(window.location.href, false));
  }

  /* Looked up each time: every filter request swaps in a new grid. */
  get grid() {
    return this.querySelector('[data-grid]');
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.closeSortOnOutsideClick);
  }

  /* ---------------------------------------------------------------- sorting */

  toggleSort() {
    const menu = this.querySelector('[data-sort-menu]');
    if (!menu || menu.classList.contains('is-closing')) return;
    if (!menu.hidden) return this.closeSort();
    this.querySelector('[data-sort-trigger]')?.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    this.liftSheet(menu, true);
  }

  closeSort() {
    this.querySelector('[data-sort-trigger]')?.setAttribute('aria-expanded', 'false');
    const menu = this.querySelector('[data-sort-menu]');
    if (!menu || menu.hidden) return;
    this.dismissSheet(menu, () => {
      menu.hidden = true;
      this.liftSheet(menu, false);
    });
  }

  /* On phones a sheet plays its slide-down (collection.css, .is-closing) before
     it is really hidden. The desktop dropdown and rail have no exit animation,
     so they are hidden straight away. */
  dismissSheet(sheet, done) {
    if (sheet.classList.contains('is-closing')) return;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      sheet.removeEventListener('animationend', onEnd);
      sheet.classList.remove('is-closing');
      done();
    };
    const onEnd = (event) => {
      if (event.target === sheet) finish();
    };

    sheet.classList.add('is-closing');
    const { animationName, animationDuration } = getComputedStyle(sheet);
    if (!animationName || animationName === 'none') return finish();
    sheet.addEventListener('animationend', onEnd);
    // In case the animation is interrupted and never reports its end.
    timer = setTimeout(finish, parseFloat(animationDuration) * 1000 + 100);
  }

  closeSortOnOutsideClick = (event) => {
    const sort = this.querySelector('[data-sort]');
    // The phone bar's Sort button lives outside the menu but opens it.
    if (!sort || sort.contains(event.target) || event.target.closest('[data-mobile-sort]')) return;
    this.closeSort();
  };

  /* ---------------------------------------------------------- filter sheet */

  /* Phones only: the rail opens as a sheet. It is revealed by hand because the
     scroll-reveal never sees it while it is hidden, and motion.css holds every
     unrevealed [data-animate] element at zero opacity. */
  setFiltersOpen(open) {
    const rail = this.querySelector('[data-filters]');
    if (rail?.classList.contains('is-closing')) return Promise.resolve();

    if (open) {
      window.zinaraTrack?.('filter_open', {
        collection_name: this.dataset.analyticsCollection,
        active_filter_count: this.filterState(window.location.href).count,
      });
      this.setAttribute('data-filters-open', '');
      document.body.style.overflow = 'hidden';
      this.revealFilters();
      // What the close button puts back.
      this.staged = this.railInputs().map((input) => [input, input.checked, input.value]);
      return Promise.resolve();
    }

    if (!this.hasAttribute('data-filters-open')) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        this.liftSheet(this.querySelector('[data-filters]'), false);
        this.removeAttribute('data-filters-open');
        document.body.style.overflow = '';
        resolve();
      };
      if (rail) this.dismissSheet(rail, finish);
      else finish();
    });
  }

  /* The panel only stages changes while it is open on a phone. */
  isStaging() {
    return this.hasAttribute('data-filters-open');
  }

  railInputs() {
    return Array.from(this.querySelectorAll('[data-filters] input'));
  }

  /* Closed without applying: the panel goes back to what is on the page. */
  discardFilters() {
    if (!this.isStaging()) return;
    (this.staged || []).forEach(([input, checked, value]) => {
      input.checked = checked;
      input.value = value;
    });
    this.syncPrice();
    this.syncTabCounts();
    this.setFiltersOpen(false);
  }

  /* Closes first, so the new rail lands on a closed panel instead of lifting
     it back over the page, then fetches only if something changed. */
  async applyFilters() {
    const changed = (this.staged || []).some(
      ([input, checked, value]) => input.checked !== checked || input.value !== value,
    );
    await this.setFiltersOpen(false);
    if (changed) this.submit();
  }

  /* Empties the panel; nothing is sent until Apply. */
  clearFilters() {
    this.railInputs().forEach((input) => {
      if (input.type === 'checkbox') input.checked = false;
    });
    const scope = this.querySelector('[data-price-filter]');
    if (scope) {
      scope.querySelector('[data-price-min]').value = 0;
      scope.querySelector('[data-price-max]').value = scope.dataset.rangeMax;
      scope.querySelector('[data-price-min-input]').value = '';
      scope.querySelector('[data-price-max-input]').value = '';
    }
    this.syncPrice();
    this.syncTabCounts();
    if (!this.isStaging()) this.submit();
  }

  /* Phones: one group at a time, picked from the tabs down the left. */
  selectTab(index) {
    const tabs = Array.from(this.querySelectorAll('[data-filter-tab]'));
    if (tabs.length === 0) return;
    this.currentTab = Math.min(Math.max(index, 0), tabs.length - 1);
    tabs.forEach((tab, i) => {
      tab.classList.toggle('is-current', i === this.currentTab);
      tab.setAttribute('aria-selected', String(i === this.currentTab));
    });
    this.querySelectorAll('[data-filter-group]').forEach((group, i) => {
      group.classList.toggle('is-current', i === this.currentTab);
      // A group folded on desktop would show an empty panel.
      if (i === this.currentTab) group.open = true;
    });
    this.querySelector('.collection_wrapper_filters_groups')?.scrollTo?.(0, 0);
  }

  /* The number beside each tab: its ticked values, or 1 for a set price. */
  syncTabCounts() {
    const groups = Array.from(this.querySelectorAll('[data-filter-group]'));
    this.querySelectorAll('[data-filter-tab-count]').forEach((count, i) => {
      const group = groups[i];
      if (!group) return;
      let n = group.querySelectorAll('input[type="checkbox"]:checked').length;
      const price = group.querySelector('[data-price-filter]');
      if (price) {
        n =
          price.querySelector('[data-price-min-input]').value || price.querySelector('[data-price-max-input]').value
            ? 1
            : 0;
      }
      count.textContent = n > 0 ? String(n) : '';
    });
  }

  revealFilters() {
    const rail = this.querySelector('[data-filters]');
    if (!rail) return;
    rail.classList.add('is-visible');
    rail.style.removeProperty('opacity');
    rail.style.removeProperty('transform');
    // Also reached after a filter change swaps in a fresh rail mid-sheet.
    this.liftSheet(rail, true);
  }

  /* Phones: an open sheet and its scrim go into the browser's top layer, where
     nothing on the page - sticky bars, the product bar, app widgets, whatever
     their z-index - can sit over them. The scrim goes in first so the sheet
     stacks above it. `popover` is only added while open: the filter rail is
     also the desktop sidebar, and a closed popover is hidden. Browsers without
     popovers keep the plain fixed positioning. */
  liftSheet(sheet, on) {
    const scrim = this.querySelector('[data-sheet-scrim]');
    const layer = (element, show) => {
      if (!element || typeof element.showPopover !== 'function') return;
      if (show) {
        element.setAttribute('popover', 'manual');
        element.setAttribute('data-top-layer', '');
        try {
          if (!element.matches(':popover-open')) element.showPopover();
        } catch (error) {
          // Already showing.
        }
        return;
      }
      try {
        if (element.matches(':popover-open')) element.hidePopover();
      } catch (error) {
        // Already hidden.
      }
      element.removeAttribute('popover');
      element.removeAttribute('data-top-layer');
    };

    if (on) {
      if (!window.matchMedia('(max-width: 749px)').matches) return;
      layer(scrim, true);
      layer(sheet, true);
      return;
    }
    layer(sheet, false);
    // The scrim stays while the other sheet is still open.
    const isSort = Boolean(sheet?.matches?.('[data-sort-menu]'));
    const otherOpen = isSort
      ? this.hasAttribute('data-filters-open')
      : this.querySelector('[data-sort-menu]')?.hidden === false;
    if (!otherOpen) layer(scrim, false);
  }

  applySort(option) {
    if (this.sortInput) this.sortInput.value = option.value;
    this.toggleSort();
    this.submit();
  }

  /* ------------------------------------------------------------------ price */

  setupPrice() {
    const scope = this.querySelector('[data-price-filter]');
    if (!scope) return;

    const min = scope.querySelector('[data-price-min]');
    const max = scope.querySelector('[data-price-max]');
    if (!min || !max) return;

    const paint = () => {
      // Keep the handles from crossing over each other.
      if (Number(min.value) > Number(max.value)) {
        const held = min.value;
        min.value = max.value;
        max.value = held;
      }
      const ceiling = Number(scope.dataset.rangeMax) || 1;
      const fill = scope.querySelector('[data-price-fill]');
      if (fill) {
        fill.style.left = `${(Number(min.value) / ceiling) * 100}%`;
        fill.style.right = `${100 - (Number(max.value) / ceiling) * 100}%`;
      }
      const readout = scope.querySelector('[data-price-readout]');
      if (readout) {
        const symbol = scope.dataset.symbol || '';
        readout.textContent = `${symbol}${this.group(min.value)} - ${symbol}${this.group(max.value)}`;
      }
    };

    const commit = () => {
      this.writePrice(scope, min.value, max.value);
      if (this.isStaging()) return this.syncPrice();
      this.submit();
    };

    [min, max].forEach((input) => {
      input.addEventListener('input', paint);
      input.addEventListener('change', commit);
    });
    this.paintPrice = paint;
    paint();
  }

  /* The submitted bounds. The full range means no price filter at all, so it
     posts nothing rather than a filter that matches everything. */
  writePrice(scope, low, high) {
    const full = Number(low) <= 0 && Number(high) >= Number(scope.dataset.rangeMax);
    scope.querySelector('[data-price-min-input]').value = full ? '' : low;
    scope.querySelector('[data-price-max-input]').value = full ? '' : high;
  }

  /* Redraws the slider and marks the preset matching the current bounds. */
  syncPrice() {
    const scope = this.querySelector('[data-price-filter]');
    if (!scope) return;
    this.paintPrice?.();
    const low = scope.querySelector('[data-price-min]').value;
    const high = scope.querySelector('[data-price-max]').value;
    const set = scope.querySelector('[data-price-min-input]').value || scope.querySelector('[data-price-max-input]').value;
    scope.querySelectorAll('[data-price-preset]').forEach((preset) => {
      preset.classList.toggle('is-active', Boolean(set) && preset.dataset.min === low && preset.dataset.max === high);
    });
    this.syncTabCounts();
  }

  applyPreset(preset) {
    const scope = preset.closest('[data-price-filter]');
    if (!scope) return;
    const min = scope.querySelector('[data-price-min]');
    const max = scope.querySelector('[data-price-max]');
    min.value = preset.dataset.min;
    max.value = preset.dataset.max;
    this.writePrice(scope, preset.dataset.min, preset.dataset.max);
    if (this.isStaging()) return this.syncPrice();
    this.submit();
  }

  /* Indian digit grouping, to match the money filter the template renders with. */
  group(value) {
    return Number(value).toLocaleString('en-IN');
  }

  /* -------------------------------------------------------------- rendering */

  submit() {
    const params = new URLSearchParams(new FormData(this.form));
    // Empty inputs would otherwise post bare keys and break the filter URL.
    Array.from(params.entries()).forEach(([key, value]) => {
      if (value === '') params.delete(key);
    });
    const url = `${this.dataset.collectionUrl}?${params.toString()}`;
    this.render(url, true);
  }

  async render(url, push) {
    this.setBusy(true);
    const before = window.location.href;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fresh = doc.querySelector('collection-page');
      if (!fresh) throw new Error('no collection-page in response');

      ['[data-grid]', '[data-filters]', '[data-more]', '[data-mobile-bar]'].forEach((selector) => {
        const next = fresh.querySelector(selector);
        const current = this.querySelector(selector);
        if (next && current) current.replaceWith(next);
        else if (!next && current) current.remove();
      });
      if (this.hasAttribute('data-filters-open')) this.revealFilters();
      // The fresh rail opens on its first tab; stay on the one in use.
      this.selectTab(this.currentTab || 0);

      const count = fresh.querySelector('.collection_wrapper_main_toolbar_count');
      const currentCount = this.querySelector('.collection_wrapper_main_toolbar_count');
      if (count && currentCount) currentCount.textContent = count.textContent;

      if (push) window.history.pushState({}, '', url);
      this.setupPrice();
      if (push) this.trackChange(before, url);
    } catch (error) {
      // A failed swap should not strand the shopper on a stale grid.
      console.error('[collection] could not apply filters', error);
      window.location.href = url;
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    if (this.grid) this.grid.setAttribute('aria-busy', String(busy));
    // Phones dim the page under a spinner while results load (collection.css).
    this.toggleAttribute('data-busy', busy);
    this.querySelector('[data-more]')?.classList.toggle('is-loading', busy);
  }

  /* ------------------------------------------------------------- load more */

  /* Appends the next page's cards to this grid. The page and its address stay
     as they are - a refresh starts over from the first page, never on a lone
     page 2 - and a failed request leaves the button there to try again. */
  async loadMore(link) {
    const wrap = link.closest('[data-more]');
    if (!wrap || wrap.classList.contains('is-loading')) return;
    const url = link.dataset.moreUrl || link.getAttribute('href');
    wrap.classList.add('is-loading');
    link.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const cards = doc.querySelectorAll('[data-grid] > *');
      cards.forEach((card) => this.grid.appendChild(card));
      window.zinaraTrack?.('plp_load_more', {
        collection_name: this.dataset.analyticsCollection,
        page_number: Number(new URL(url, window.location.href).searchParams.get('page')) || undefined,
        items_loaded: cards.length,
      });

      const nextMore = doc.querySelector('[data-more]');
      if (nextMore) wrap.replaceWith(nextMore);
      else wrap.remove();
    } catch (error) {
      console.error('[collection] could not load more', error);
    } finally {
      wrap.classList.remove('is-loading');
      link.removeAttribute('aria-busy');
    }
  }

  /* ------------------------------------------------------------ analytics */

  /* The active filters in a URL, in the plan's format:
     'price:0-10000|colour:gold|diamond_shape:oval'. Filter params look like
     filter.p.m.custom.colour / filter.v.option.size / filter.v.price.gte. */
  filterState(href) {
    const params = new URL(href, window.location.href).searchParams;
    const groups = new Map();
    let price = null;
    params.forEach((value, key) => {
      if (!key.startsWith('filter.') || value === '') return;
      if (key === 'filter.v.price.gte' || key === 'filter.v.price.lte') {
        price = price || { gte: '0', lte: '' };
        price[key.endsWith('gte') ? 'gte' : 'lte'] = value;
        return;
      }
      const name = key.split('.').pop();
      groups.set(name, [...(groups.get(name) || []), value]);
    });
    const parts = [];
    if (price) parts.push(`price:${price.gte}-${price.lte}`);
    groups.forEach((values, name) => parts.push(`${name}:${values.join(',')}`));
    let count = groups.size ? [...groups.values()].reduce((sum, values) => sum + values.length, 0) : 0;
    if (price) count += 1;
    return { text: parts.join('|'), count };
  }

  /* After a filter or sort request lands: filter_apply when the filters
     changed, sort_apply when the order did. */
  trackChange(before, after) {
    const collection = this.dataset.analyticsCollection;
    const was = this.filterState(before);
    const now = this.filterState(after);
    if (was.text !== now.text) {
      const countText = this.querySelector('.collection_wrapper_main_toolbar_count')?.textContent || '';
      window.zinaraTrack?.('filter_apply', {
        filters_applied: now.text || 'none',
        filter_count: now.count,
        collection_name: collection,
        results_count: parseInt(countText.replace(/[^0-9]/g, ''), 10) || 0,
      });
    }
    const sortBefore = new URL(before, window.location.href).searchParams.get('sort_by') || '';
    const sortAfter = new URL(after, window.location.href).searchParams.get('sort_by') || '';
    if (sortBefore !== sortAfter) {
      window.zinaraTrack?.('sort_apply', {
        sort_option: sortAfter || 'default',
        previous_sort: sortBefore || 'default',
        collection_name: collection,
      });
    }
  }
}

customElements.define('collection-page', CollectionPage);
