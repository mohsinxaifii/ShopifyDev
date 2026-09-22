/**
 * The PLP variant drawer. A card's add-to-cart opens this instead of adding
 * straight away, so the shopper picks metal and size first.
 *
 * Contents are fetched per product through the Section Rendering API rather
 * than built here, because swatches, money formatting and image sizing all
 * live in Liquid and are absent from the /products/x.js payload.
 */
(() => {
  class VariantDrawer extends HTMLElement {
    connectedCallback() {
      this.panel = this.querySelector('.variant-drawer_panel');
      this.content = this.querySelector('[data-drawer-content]');
      this.done = this.querySelector('[data-drawer-done]');

      this.addEventListener('click', (event) => {
        if (event.target.closest('[data-drawer-close]')) return this.close();
        if (event.target.closest('[data-drawer-done]')) return this.confirm();
      });

      this.addEventListener('change', (event) => {
        if (event.target.closest('[data-option-input]')) this.syncSelection();
      });

      this.onKeydown = (event) => {
        if (event.key === 'Escape' && !this.hidden) this.close();
      };
      document.addEventListener('keydown', this.onKeydown);
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this.onKeydown);
    }

    /* -------------------------------------------------------------- open */

    async open(productUrl, trigger) {
      this.trigger = trigger;
      this.opener = document.activeElement;
      this.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      // Let the element paint hidden-to-shown before the transition starts.
      requestAnimationFrame(() => this.classList.add('is-open'));

      this.content.setAttribute('aria-busy', 'true');
      try {
        const url = `${productUrl}${productUrl.includes('?') ? '&' : '?'}section_id=variant-drawer`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const body = doc.querySelector('[data-drawer-body]');
        if (!body) throw new Error('no drawer body in response');

        this.content.replaceChildren(body);
        this.readVariantData();
        this.syncSelection();
        this.panel.querySelector('[data-option-input]')?.focus();
      } catch (error) {
        console.error('[variant-drawer] could not load product', error);
        this.close();
        window.location.href = productUrl;
      } finally {
        this.content.removeAttribute('aria-busy');
      }
    }

    close() {
      this.classList.remove('is-open');
      document.documentElement.style.overflow = '';
      const finish = () => {
        this.hidden = true;
        this.content.replaceChildren();
      };
      // Wait for the slide-out unless motion is switched off.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else setTimeout(finish, 280);
      this.opener?.focus?.();
    }

    /* --------------------------------------------------------- selection */

    readVariantData() {
      const node = this.querySelector('[data-variant-data]');
      try {
        this.data = JSON.parse(node?.textContent || '{}');
      } catch {
        this.data = { variants: [] };
      }
    }

    selectedOptions() {
      return Array.from(this.querySelectorAll('[data-option-group]')).map((group) => {
        const checked = group.querySelector('[data-option-input]:checked');
        return checked ? checked.value : null;
      });
    }

    matchingVariant() {
      const chosen = this.selectedOptions();
      if (chosen.some((value) => value === null)) return null;
      return (this.data?.variants || []).find((variant) =>
        variant.options.every((option, index) => option === chosen[index]),
      );
    }

    syncSelection() {
      // Keep the "Color: Gold" readout in step with the chosen swatch.
      this.querySelectorAll('[data-option-group]').forEach((group) => {
        const readout = group.querySelector('[data-option-readout]');
        const checked = group.querySelector('[data-option-input]:checked');
        if (readout && checked) readout.textContent = checked.value;
      });

      const variant = this.matchingVariant();
      this.variant = variant;
      if (this.done) this.done.disabled = !variant || !variant.available;
    }

    /* ----------------------------------------------------------- confirm */

    async confirm() {
      if (!this.variant) return;
      this.done.disabled = true;

      // The shared cart owns the request, the button's pending/added states, the
      // header count and opening the drawer; this only has to close itself once
      // the line is actually in.
      const added = await window.zinaraCart?.add(
        [{ id: this.variant.id, quantity: 1 }],
        this.trigger,
      );

      if (added) this.close();
      else this.done.disabled = false;
    }
  }

  if (!customElements.get('variant-drawer')) customElements.define('variant-drawer', VariantDrawer);
})();
