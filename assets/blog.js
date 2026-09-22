/*
 * Blog listing behaviour: load-more.
 *
 * The same approach collection.js takes - fetch the next paginated page, lift
 * the cards out of its grid, and swap the button for whatever that page's own
 * button says. The label carries the remaining count, so letting the fetched
 * markup replace the button keeps the count right without recalculating it
 * here. A failed fetch falls through to a normal navigation, which is the one
 * outcome that always works.
 */
class BlogList extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (event) => {
      const moreLink = event.target.closest('[data-more-link]');
      if (!moreLink) return;
      event.preventDefault();
      this.loadMore(moreLink);
    });
  }

  get grid() {
    return this.querySelector('[data-grid]');
  }

  async loadMore(link) {
    const wrap = link.closest('[data-more]');
    if (wrap?.classList.contains('is-loading')) return;
    wrap?.classList.add('is-loading');

    try {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      doc.querySelectorAll('[data-grid] > *').forEach((card) => this.grid.appendChild(card));

      const nextMore = doc.querySelector('[data-more]');
      if (nextMore) wrap.replaceWith(nextMore);
      else wrap.remove();

      window.history.replaceState({}, '', link.href);
    } catch (error) {
      console.error('[blog] could not load more', error);
      window.location.href = link.href;
    } finally {
      wrap?.classList.remove('is-loading');
    }
  }
}

customElements.define('blog-list', BlogList);
