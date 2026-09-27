/**
 * PLP behaviour: the filter rail, the sort menu, the price range and load-more.
 *
 * Filtering and sorting both go through the same path - rewrite the query string
 * from the form, fetch that URL, and swap in the grid, the rail and the count
 * from the response. That keeps Shopify's storefront filtering as the source of
 * truth (counts, disabled values, the sort list) instead of reimplementing it,
 * and it keeps the URL shareable.
 */
class CollectionPage extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('[data-filter-form]');
    if (!this.form) return;

    this.grid = this.querySelector('[data-grid]');
    this.sortInput = this.querySelector('[data-sort-input]');
    this.phone = window.matchMedia('(max-width: 749px)');
    this.filterTab = 0;

    // Capture phase, so on phones a group title switches tabs before the
    // accordion handler on the <summary> itself can collapse it.
    this.addEventListener('click', this.onFilterTab, true);
    this.syncFilterTabs();

    this.form.addEventListener('change', (event) => {
      if (event.target.closest('[data-price-filter]')) return; // price commits on release
      this.submit();
    });

    this.addEventListener('click', (event) => {
      // Phones: the Sort | Filters bar and the two sheets it opens.
      if (event.target.closest('[data-mobile-sort]')) return this.toggleSort();
      if (event.target.closest('[data-mobile-filters]')) return this.setFiltersOpen(true);
      if (event.target.closest('[data-filters-close]')) return this.setFiltersOpen(false);
      if (event.target.closest('[data-sort-close]')) return this.closeSort();
      if (event.target.closest('[data-sheet-scrim]')) {
        this.setFiltersOpen(false);
        return this.closeSort();
      }

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

      const addButton = event.target.closest('[data-add-to-cart]');
      if (addButton) {
        // The button sits inside the card's <a>, so stop the navigation.
        event.preventDefault();
        return this.openVariantDrawer(addButton);
      }
    });

    document.addEventListener('click', this.closeSortOnOutsideClick);
    this.setupPrice();

    // Restore the grid when the shopper walks back through filter states.
    window.addEventListener('popstate', () => this.render(window.location.href, false));
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.closeSortOnOutsideClick);
  }

  /* ---------------------------------------------------------------- sorting */

  toggleSort() {
    const trigger = this.querySelector('[data-sort-trigger]');
    const menu = this.querySelector('[data-sort-menu]');
    if (!trigger || !menu) return;
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!open));
    menu.hidden = open;
  }

  closeSort() {
    this.querySelector('[data-sort-trigger]')?.setAttribute('aria-expanded', 'false');
    const menu = this.querySelector('[data-sort-menu]');
    if (menu) menu.hidden = true;
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
    if (open) this.revealFilters();
    this.toggleAttribute('data-filters-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  /* Phones show the filter groups as tabs (Figma 7930:118227): the titles stack
     in a column and only the current group's values show beside them. */
  onFilterTab = (event) => {
    if (!this.phone.matches) return;
    const summary = event.target.closest('[data-filter-group] > summary');
    if (!summary) return;
    event.preventDefault();
    event.stopPropagation();
    this.filterTab = Array.from(this.querySelectorAll('[data-filter-group]')).indexOf(summary.parentElement);
    this.syncFilterTabs();
  };

  syncFilterTabs() {
    const groups = Array.from(this.querySelectorAll('[data-filter-group]'));
    if (this.filterTab >= groups.length) this.filterTab = 0;
    groups.forEach((group, index) => {
      group.classList.toggle('is-current', index === this.filterTab);
      // A group collapsed on a wider screen would otherwise hide its values.
      if (this.phone.matches) group.open = true;
    });
  }

  revealFilters() {
    const rail = this.querySelector('[data-filters]');
    if (!rail) return;
    this.syncFilterTabs();
    // The scroll-reveal owns the rail's inline transform and writes an inline
    // `translate: none`, which would cancel the sheet's slide. Drop it for good.
    window.ScrollTrigger?.getAll().forEach((trigger) => {
      if (trigger.trigger === rail) trigger.kill();
    });
    window.gsap?.killTweensOf(rail);
    rail.classList.add('is-visible');
    // Clearing those would itself start a transition, so the rail is snapped
    // to its parked position with transitions off, then the sheet slides from there.
    rail.style.transition = 'none';
    ['opacity', 'transform', 'translate', 'rotate', 'scale'].forEach((prop) => rail.style.removeProperty(prop));
    rail.getBoundingClientRect();
    rail.style.removeProperty('transition');
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
      scope.querySelector('[data-price-min-input]').value = min.value;
      scope.querySelector('[data-price-max-input]').value = max.value;
      this.submit();
    };

    [min, max].forEach((input) => {
      input.addEventListener('input', paint);
      input.addEventListener('change', commit);
    });
    paint();

    // Liquid's money filter groups thousands the Western way; match the readout.
    const symbol = scope.dataset.symbol || '';
    scope.querySelectorAll('[data-price-preset]').forEach((preset) => {
      const low = `${symbol}${this.group(preset.dataset.min)}`;
      preset.textContent = preset.hasAttribute('data-open-ended')
        ? `${low}+`
        : `${low} - ${symbol}${this.group(preset.dataset.max)}`;
    });
  }

  applyPreset(preset) {
    const scope = preset.closest('[data-price-filter]');
    if (!scope) return;
    const min = scope.querySelector('[data-price-min]');
    const max = scope.querySelector('[data-price-max]');
    min.value = preset.dataset.min;
    max.value = preset.dataset.max;
    scope.querySelector('[data-price-min-input]').value = preset.dataset.min;
    scope.querySelector('[data-price-max-input]').value = preset.dataset.max;
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

      const count = fresh.querySelector('.collection_wrapper_main_toolbar_count');
      const currentCount = this.querySelector('.collection_wrapper_main_toolbar_count');
      if (count && currentCount) currentCount.textContent = count.textContent;

      if (push) window.history.pushState({}, '', url);
      this.setupPrice();
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
    this.querySelector('[data-more]')?.classList.toggle('is-loading', busy);
  }

  /* ------------------------------------------------------------- load more */

  async loadMore(link) {
    const wrap = link.closest('[data-more]');
    wrap?.classList.add('is-loading');
    try {
      const response = await fetch(link.href);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      doc.querySelectorAll('[data-grid] > *').forEach((card) => this.grid.appendChild(card));

      const nextMore = doc.querySelector('[data-more]');
      if (nextMore) wrap.replaceWith(nextMore);
      else wrap.remove();

      window.history.replaceState({}, '', link.href);
    } catch (error) {
      console.error('[collection] could not load more', error);
      window.location.href = link.href;
    } finally {
      wrap?.classList.remove('is-loading');
    }
  }

  /* ----------------------------------------------------------- add to cart */

  /* Adding is the drawer's job - metal and size have to be chosen first. */
  openVariantDrawer(button) {
    const drawer = document.querySelector('variant-drawer');
    const productUrl = button.closest('.product-card')?.getAttribute('href');
    if (!drawer || !productUrl) return this.addToCart(button);
    drawer.open(productUrl, button);
  }

  /* Single-variant cards add straight from the grid; anything with options goes
     through the variant drawer first. Either way the shared cart runs the
     request and the feedback. */
  async addToCart(button) {
    await window.zinaraCart?.add([{ id: Number(button.dataset.variantId), quantity: 1 }], button);
  }
}

customElements.define('collection-page', CollectionPage);
