/**
 * Ratings and reviews, read live from Judge.me - the theme's only source for
 * them. Nothing comes from metafields: layout/theme.liquid hands over the shop
 * domain and Judge.me's *public* widget token, and this file asks Judge.me's
 * widget API for each product.
 *
 *   <judgeme-rating data-handle="...">   star + average (cards, drawer, PDP)
 *   <judgeme-reviews data-handle="...">  PDP summary, review list, "Show more"
 *
 * Judge.me answers with its own widget HTML. It is parsed in an inert document
 * (DOMParser runs no scripts and loads no images) and only plain values are
 * read out of it, then written into the theme's markup as text - so the design
 * stays the theme's and none of Judge.me's markup reaches the page.
 */
(() => {
  const config = window.zinaraJudgeme;
  if (!config?.shopDomain || !config?.token) return;

  const API = 'https://judge.me/api/v1/widgets';
  const CACHE_PREFIX = 'zinara:jdgm:';
  const CACHE_MS = 10 * 60 * 1000;
  const pending = new Map();

  /* -------------------------------------------------------------- api */

  function readCache(key) {
    try {
      const entry = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key));
      if (entry && Date.now() - entry.at < CACHE_MS) return entry.value;
    } catch (error) {
      // Storage blocked or the entry is malformed - just ask Judge.me again.
    }
    return null;
  }

  function writeCache(key, value) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value }));
    } catch (error) {
      // Full or blocked storage only costs a repeat request.
    }
  }

  /** One request per URL, however many elements ask for it at once. */
  function request(endpoint, params) {
    const query = new URLSearchParams({
      shop_domain: config.shopDomain,
      api_token: config.token,
      ...params,
    });
    const url = `${API}/${endpoint}?${query}`;
    if (!pending.has(url)) {
      pending.set(
        url,
        fetch(url, { headers: { Accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`Judge.me ${endpoint} answered ${response.status}`);
            return response.json();
          })
          .catch((error) => {
            pending.delete(url);
            throw error;
          }),
      );
    }
    return pending.get(url);
  }

  function parse(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  const number = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();

  /** Average rating and review count for a product: { rating, count }. */
  async function summary(handle) {
    const key = `summary:${handle}`;
    const cached = readCache(key);
    if (cached) return cached;

    const data = await request('preview_badge', { handle });
    const badge = parse(data.badge).querySelector('[data-average-rating]');
    const result = {
      rating: number(badge?.dataset.averageRating),
      count: Math.round(number(badge?.dataset.numberOfReviews)),
    };
    writeCache(key, result);
    return result;
  }

  /** "2024-03-02 10:20:24 UTC" -> Date (that format is not one Date parses). */
  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value.trim().replace(' UTC', 'Z').replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** One page of published reviews, newest first as Judge.me sorts them. */
  async function reviews(handle, page, perPage) {
    const data = await request('product_review', {
      handle,
      page: String(page),
      per_page: String(perPage),
    });
    return Array.from(parse(data.widget).querySelectorAll('.jdgm-rev')).map((node) => {
      const stamp = node.querySelector('.jdgm-rev__timestamp');
      return {
        rating: Math.round(number(node.querySelector('.jdgm-rev__rating')?.dataset.score)),
        author: text(node.querySelector('.jdgm-rev__author')),
        verified: node.dataset.verifiedBuyer === 'true',
        body: text(node.querySelector('.jdgm-rev__body')),
        date: parseDate(stamp?.dataset.content || text(stamp)),
        images: Array.from(node.querySelectorAll('.jdgm-rev__pics img'))
          .map((img) => img.dataset.src || img.getAttribute('src') || '')
          .filter((src) => src && !src.startsWith('data:')),
      };
    });
  }

  window.zinaraJudgemeApi = { summary, reviews };

  /* ---------------------------------------------------------- helpers */

  /** Sets a testimonial-stars row (snippets/testimonial-stars.liquid) to a score. */
  function setStars(row, rating) {
    if (!row) return;
    const rounded = Math.round(rating);
    row.querySelectorAll('.testimonial-stars_star').forEach((star, index) => {
      star.classList.toggle('is-empty', index + 1 > rounded);
    });
    row.setAttribute('aria-label', `${rounded} out of 5 stars`);
  }

  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Cards far down a collection only ask Judge.me once they near the screen.
  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              observer.unobserve(entry.target);
              entry.target.load();
            });
          },
          { rootMargin: '300px' },
        )
      : null;

  /* ---------------------------------------------------- <judgeme-rating> */

  /**
   * Hidden until Judge.me reports at least one review, then fills every
   * [data-judgeme-value] inside with the average (one decimal).
   */
  class JudgemeRating extends HTMLElement {
    connectedCallback() {
      if (this.loaded || !this.dataset.handle) return;
      if (observer) observer.observe(this);
      else this.load();
    }

    disconnectedCallback() {
      observer?.unobserve(this);
    }

    async load() {
      if (this.loaded) return;
      this.loaded = true;
      try {
        const { rating, count } = await summary(this.dataset.handle);
        if (!count || !rating) return;
        this.querySelectorAll('[data-judgeme-value]').forEach((node) => {
          node.textContent = rating.toFixed(1);
        });
        this.hidden = false;
      } catch (error) {
        console.error('[judgeme] rating', error);
      }
    }
  }

  /* --------------------------------------------------- <judgeme-reviews> */

  /**
   * The PDP "Customer reviews" block. Shows the summary and the first page of
   * reviews; "Show more reviews" fetches the next page from Judge.me.
   */
  class JudgemeReviews extends HTMLElement {
    connectedCallback() {
      if (this.started || !this.dataset.handle) return;
      this.started = true;

      this.handle = this.dataset.handle;
      this.perPage = Math.min(20, Math.max(1, parseInt(this.dataset.perPage, 10) || 3));
      this.page = 0;
      this.shown = 0;
      this.total = 0;

      this.summaryNode = this.querySelector('[data-reviews-summary]');
      this.list = this.querySelector('[data-reviews-list]');
      this.template = this.querySelector('[data-review-template]');
      this.more = this.querySelector('[data-reviews-more]');
      this.moreButton = this.more?.querySelector('button');

      this.moreButton?.addEventListener('click', () => this.loadPage());
      this.init();
    }

    async init() {
      try {
        const { rating, count } = await summary(this.handle);
        this.total = count;
        if (!count) return;

        this.querySelectorAll('[data-reviews-score]').forEach((node) => {
          node.textContent = rating.toFixed(2);
        });
        this.querySelectorAll('[data-reviews-count]').forEach((node) => {
          node.textContent = `${count} review${count === 1 ? '' : 's'}`;
        });
        setStars(this.summaryNode?.querySelector('.testimonial-stars'), rating);
        if (this.summaryNode) this.summaryNode.hidden = false;

        await this.loadPage();
      } catch (error) {
        console.error('[judgeme] reviews', error);
      }
    }

    async loadPage() {
      if (this.loading || !this.list || !this.template) return;
      this.loading = true;
      if (this.moreButton) this.moreButton.disabled = true;

      try {
        const items = await reviews(this.handle, this.page + 1, this.perPage);
        this.page += 1;
        items.forEach((review) => this.list.appendChild(this.renderReview(review)));
        this.shown += items.length;
        this.list.hidden = this.shown === 0;
        const hasMore = items.length === this.perPage && this.shown < this.total;
        if (this.more) this.more.hidden = !hasMore;
      } catch (error) {
        console.error('[judgeme] reviews page', error);
      } finally {
        this.loading = false;
        if (this.moreButton) this.moreButton.disabled = false;
      }
    }

    renderReview(review) {
      const item = this.template.content.firstElementChild.cloneNode(true);
      setStars(item.querySelector('.testimonial-stars'), review.rating);

      item.querySelector('[data-review-author]').textContent = review.author || 'Anonymous';
      item.querySelectorAll('[data-review-verified]').forEach((node) => {
        node.hidden = !review.verified;
      });

      const media = item.querySelector('[data-review-media]');
      if (media) {
        review.images.forEach((src) => {
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          img.width = 144;
          img.height = 144;
          media.appendChild(img);
        });
        media.hidden = review.images.length === 0;
      }

      item.querySelector('[data-review-body]').textContent = `“${review.body}”`;
      const date = item.querySelector('[data-review-date]');
      if (review.date) {
        date.textContent = dateFormat.format(review.date);
        date.hidden = false;
      }
      return item;
    }
  }

  if (!customElements.get('judgeme-rating')) customElements.define('judgeme-rating', JudgemeRating);
  if (!customElements.get('judgeme-reviews')) customElements.define('judgeme-reviews', JudgemeReviews);
})();
