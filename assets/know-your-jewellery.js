class FlipCard extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', () => this.classList.toggle('is-flipped'));
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.classList.toggle('is-flipped');
      }
    });
  }
}

customElements.define('flip-card', FlipCard);

class CardStack extends HTMLElement {
  connectedCallback() {
    this.items = Array.from(this.querySelectorAll('[data-stack-item]'));
    this.dotsContainer = this.querySelector('[data-dots]');
    this.activeIndex = this.items.findIndex((item) => item.classList.contains('is-active'));
    if (this.activeIndex < 0) this.activeIndex = 0;

    this.items.forEach((item, index) => {
      item.addEventListener('click', () => {
        if (index !== this.activeIndex) this.goTo(index);
      });
    });

    this.querySelectorAll('[data-prev]').forEach((button) =>
      button.addEventListener('click', () => this.goTo(this.activeIndex - 1, -1)),
    );
    this.querySelectorAll('[data-next]').forEach((button) =>
      button.addEventListener('click', () => this.goTo(this.activeIndex + 1, 1)),
    );

    this.bindSwipe(this.querySelector('.know-your-jewellery_wrapper_grid_diamonds_stack'));
    this.buildDots();
    this.updateDepths();
  }

  /* A horizontal drag (touch or mouse) steps the deck: left for next, right for
     previous. The click that follows a swipe is swallowed so it doesn't also
     flip the card or jump to a card behind it. */
  bindSwipe(surface) {
    if (!surface) return;

    const threshold = 40;
    let start = null;
    let swiped = false;

    surface.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      swiped = false;
    });

    // Capture only once the pointer is clearly dragging, so a plain tap still
    // lands on the card under it and flips it.
    surface.addEventListener('pointermove', (event) => {
      if (!start || event.pointerId !== start.id) return;
      if (Math.abs(event.clientX - start.x) > 10 && !surface.hasPointerCapture(event.pointerId)) {
        surface.setPointerCapture(event.pointerId);
      }
    });

    surface.addEventListener('pointerup', (event) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;
      swiped = true;
      // The card swings out on the side the finger is moving towards.
      this.goTo(this.activeIndex + (dx < 0 ? 1 : -1), dx < 0 ? -1 : 1);
    });

    surface.addEventListener('pointercancel', () => {
      start = null;
    });

    surface.addEventListener(
      'click',
      (event) => {
        if (!swiped) return;
        swiped = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  /* Stepping forward sends the front card out to the side, behind the deck and
     down to the back; stepping back plays that in reverse on the back card.
     `swing` is the side the card swings out on: 1 right, -1 left. */
  goTo(index, swing) {
    const total = this.items.length;
    const next = (index + total) % total;
    if (next === this.activeIndex || this.animating) return;

    const step = (next - this.activeIndex + total) % total;
    let moving = null;
    let animation = '';
    if (step === 1) {
      moving = this.items[this.activeIndex];
      animation = 'is-sending-back';
    } else if (step === total - 1) {
      moving = this.items[next];
      animation = 'is-bringing-front';
    }

    if (moving) {
      this.animating = true;
      moving.style.setProperty('--card-stack-swing', String(swing || (animation === 'is-sending-back' ? 1 : -1)));
      moving.classList.add(animation);
      window.setTimeout(() => {
        moving.classList.remove(animation);
        this.animating = false;
      }, CardStack.duration);
    }

    this.items.forEach((item) => item.classList.remove('is-flipped'));
    this.activeIndex = next;
    this.updateDepths();

    if (this.dotsContainer) {
      Array.from(this.dotsContainer.children).forEach((dot, i) => dot.classList.toggle('is-active', i === next));
    }
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

/* Matches the length of the kyj-card-send-back / kyj-card-bring-front keyframes. */
CardStack.duration = 600;

customElements.define('card-stack', CardStack);
