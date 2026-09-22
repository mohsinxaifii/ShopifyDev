class FlipCard extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', () => {
      // A swipe that ends on this card must not also flip it.
      if (this.closest('card-stack')?.isSuppressingClicks()) return;
      this.flip();
    });
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.flip();
      }
    });
  }

  /* Figma note 7930:109385: the deck rotates on its own 7s after a flip is
     completed, so the shopper who reads a fact is moved on to the next card. */
  flip() {
    const nowFlipped = !this.classList.contains('is-flipped');
    this.classList.toggle('is-flipped', nowFlipped);
    const stack = this.closest('card-stack');
    if (!stack) return;
    if (nowFlipped) stack.scheduleAutoAdvance();
    else stack.cancelAutoAdvance();
  }
}

customElements.define('flip-card', FlipCard);

/* The deck advances with a flip: the front card tips away on its vertical axis
   and the next one rises into its place. The same motion is driven by the
   arrows, the dots and by dragging a card sideways. */
class CardStack extends HTMLElement {
  static EXIT_MS = 320;
  static SWIPE_THRESHOLD = 56;
  /* Figma note 7930:109385: "after 7s of completing card flip". */
  static AUTO_ADVANCE_MS = 7000;

  connectedCallback() {
    this.items = Array.from(this.querySelectorAll('[data-stack-item]'));
    this.stack = this.querySelector('.know-your-jewellery_wrapper_grid_diamonds_stack');
    this.dotsContainer = this.querySelector('[data-dots]');
    this.activeIndex = this.items.findIndex((item) => item.classList.contains('is-active'));
    if (this.activeIndex < 0) this.activeIndex = 0;

    this.isAnimating = false;
    this.suppressClicksUntil = 0;

    this.items.forEach((item, index) => {
      item.addEventListener('click', () => {
        if (this.isSuppressingClicks() || index === this.activeIndex) return;
        this.advance(index > this.activeIndex ? 'next' : 'prev', index);
      });
    });

    this.querySelectorAll('[data-prev]').forEach((button) =>
      button.addEventListener('click', () => this.advance('prev')),
    );
    this.querySelectorAll('[data-next]').forEach((button) =>
      button.addEventListener('click', () => this.advance('next')),
    );

    // Capture phase, so a drag that ends on a flip-card is swallowed before the
    // card's own click handler sees it.
    this.addEventListener(
      'click',
      (event) => {
        if (!this.isSuppressingClicks()) return;
        event.stopPropagation();
        event.preventDefault();
      },
      true,
    );

    this.setupDrag();
    this.buildDots();
    this.updateDepths();
  }

  isSuppressingClicks() {
    return Date.now() < this.suppressClicksUntil;
  }

  get frontCard() {
    return this.items[this.activeIndex];
  }

  /* ------------------------------------------------------------- dragging */

  setupDrag() {
    if (!this.stack) return;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.deltaX = 0;
    this.isDragging = false;

    this.stack.addEventListener('pointerdown', this.onPointerDown);
    this.stack.addEventListener('pointermove', this.onPointerMove);
    this.stack.addEventListener('pointerup', this.onPointerUp);
    this.stack.addEventListener('pointercancel', this.onPointerUp);
  }

  onPointerDown = (event) => {
    if (this.isAnimating || this.items.length < 2) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const card = event.target.closest('[data-stack-item]');
    if (card !== this.frontCard) return;

    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.deltaX = 0;
    this.isDragging = false;
  };

  onPointerMove = (event) => {
    if (this.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    // Let the page scroll until the gesture is clearly horizontal.
    if (!this.isDragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      this.isDragging = true;
      this.frontCard?.classList.add('is-dragging');
      this.stack.setPointerCapture?.(event.pointerId);
    }

    this.deltaX = dx;
    const card = this.frontCard;
    if (!card) return;
    const width = this.stack.offsetWidth || 1;
    const ratio = Math.max(-1, Math.min(1, dx / width));
    card.style.setProperty('--stack-drag-x', `${dx}px`);
    card.style.setProperty('--stack-drag-rotate', `${ratio * -18}deg`);
  };

  onPointerUp = (event) => {
    if (this.pointerId !== event.pointerId) return;
    this.stack.releasePointerCapture?.(event.pointerId);
    this.pointerId = null;

    const card = this.frontCard;
    const dragged = this.isDragging;
    this.isDragging = false;

    if (card) {
      card.classList.remove('is-dragging');
      card.style.removeProperty('--stack-drag-x');
      card.style.removeProperty('--stack-drag-rotate');
    }
    if (!dragged) return;

    // Any real drag eats the click that follows it.
    this.suppressClicksUntil = Date.now() + 400;

    if (Math.abs(this.deltaX) >= CardStack.SWIPE_THRESHOLD) {
      this.advance(this.deltaX < 0 ? 'next' : 'prev');
    }
    this.deltaX = 0;
  };

  /* ------------------------------------------------------------ advancing */

  scheduleAutoAdvance() {
    this.cancelAutoAdvance();
    if (this.items.length < 2 || this.prefersReducedMotion()) return;
    this.autoTimer = window.setTimeout(() => this.advance('next'), CardStack.AUTO_ADVANCE_MS);
  }

  cancelAutoAdvance() {
    if (this.autoTimer) window.clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  disconnectedCallback() {
    this.cancelAutoAdvance();
  }

  advance(direction, targetIndex) {
    // Any move, by hand or by timer, retires the pending one.
    this.cancelAutoAdvance();
    if (this.isAnimating || this.items.length < 2) return;
    const total = this.items.length;
    const next =
      typeof targetIndex === 'number'
        ? (targetIndex + total) % total
        : (this.activeIndex + (direction === 'prev' ? -1 : 1) + total) % total;
    if (next === this.activeIndex) return;

    const leaving = this.frontCard;
    if (!leaving || this.prefersReducedMotion()) return this.commit(next);

    this.isAnimating = true;
    leaving.classList.add('is-leaving', `is-leaving--${direction}`);

    const finish = () => {
      leaving.classList.remove('is-leaving', `is-leaving--${direction}`);
      this.isAnimating = false;
      this.commit(next);
    };

    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      finish();
    };
    leaving.addEventListener('transitionend', once, { once: true });
    // transitionend never fires if the card is off-screen, so cap the wait.
    setTimeout(once, CardStack.EXIT_MS + 60);
  }

  commit(index) {
    this.items.forEach((item) => item.classList.remove('is-flipped'));
    this.activeIndex = index;
    this.updateDepths();

    if (this.dotsContainer) {
      Array.from(this.dotsContainer.children).forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    }
  }

  /* Kept so existing callers and the dots keep working. */
  goTo(index) {
    const total = this.items.length;
    const next = (index + total) % total;
    this.advance(next > this.activeIndex ? 'next' : 'prev', next);
  }

  prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /* Depth 0 is the front card; 1 and 2 peek out below it, anything deeper hides. */
  updateDepths() {
    const total = this.items.length;
    this.items.forEach((item, i) => {
      const depth = (i - this.activeIndex + total) % total;
      item.dataset.depth = String(Math.min(depth, 3));
      item.classList.toggle('is-active', depth === 0);
    });
  }

  buildDots() {
    if (!this.dotsContainer || this.items.length < 2) return;
    this.dotsContainer.innerHTML = '';
    this.items.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'scroll-carousel_dot';
      if (index === this.activeIndex) dot.classList.add('is-active');
      dot.setAttribute('aria-label', `Show card ${index + 1}`);
      dot.addEventListener('click', () => this.goTo(index));
      this.dotsContainer.appendChild(dot);
    });
  }
}

customElements.define('card-stack', CardStack);
