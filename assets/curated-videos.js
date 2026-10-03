/**
 * Shows the home page's "Curated trends" videos (the video-showcase section in
 * templates/index.json) somewhere else - the product page - with the same
 * videos, products and settings, so they are edited in one place.
 *
 * Another template's section settings are out of reach in Liquid, so the home
 * page is fetched and its rendered <video-showcase> is lifted out and dropped
 * in here; video-showcase.js then runs it exactly as it runs on the home page.
 * The fetch waits until the section is close to the viewport, and the markup
 * is kept for a few minutes per tab so moving between products doesn't refetch
 * the home page every time. If the home page has no such section, this stays
 * hidden.
 */
(() => {
  const CACHE_KEY = 'curated-videos:v1';
  const CACHE_MS = 10 * 60 * 1000;

  const readCache = () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.html;
    } catch (error) {
      /* storage blocked or corrupt - fetch instead */
    }
    return null;
  };

  const writeCache = (html) => {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ html, at: Date.now() }));
    } catch (error) {
      /* storage blocked or full - it is only a cache */
    }
  };

  class CuratedVideos extends HTMLElement {
    connectedCallback() {
      if (this.loaded) return;
      const cached = readCache();
      if (cached) {
        this.render(cached);
        return;
      }

      if (!('IntersectionObserver' in window)) {
        this.load();
        return;
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          this.observer.disconnect();
          this.load();
        },
        { rootMargin: '600px 0px' },
      );
      this.observer.observe(this);
    }

    disconnectedCallback() {
      this.observer?.disconnect();
    }

    async load() {
      try {
        const response = await fetch(this.dataset.src || '/', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const showcase = doc.querySelector('video-showcase');
        if (!showcase) return;
        writeCache(showcase.outerHTML);
        this.render(showcase.outerHTML);
      } catch (error) {
        /* no home section to borrow - the slot stays hidden */
      }
    }

    render(html) {
      this.loaded = true;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const showcase = doc.querySelector('video-showcase');
      if (!showcase) return;

      // Arrives after the page's reveal pass has run, so show it outright
      // rather than leaving it at the hidden starting state.
      showcase.querySelectorAll('[data-animate]').forEach((node) => node.classList.add('is-visible'));
      // Editor hooks belong to the home page's blocks, not to this page.
      showcase.querySelectorAll('[data-shopify-editor-block]').forEach((node) => {
        node.removeAttribute('data-shopify-editor-block');
      });

      this.replaceChildren(document.importNode(showcase, true));
      this.hidden = false;
    }
  }

  if (!customElements.get('curated-videos')) customElements.define('curated-videos', CuratedVideos);
})();
