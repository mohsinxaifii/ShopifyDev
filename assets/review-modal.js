/* Opens the full review in a native <dialog>, so Esc, focus trapping and the
   theme's scroll-lock rule all come for free.

   On phones the dialog is styled as a bottom sheet (Figma 7930:107981), so it
   also has to close like one: the panel slides back down before the dialog is
   actually closed, and dragging the header down dismisses it. */
class ReviewModal extends HTMLElement {
  static CLOSE_MS = 220;
  static DISMISS_PX = 96;

  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.opener = this.querySelector('[data-review-open]');
    if (!this.dialog || !this.opener) return;

    this.head = this.dialog.querySelector('.review-dialog_panel_head');

    this.opener.addEventListener('click', (event) => {
      event.preventDefault();
      this.dialog.showModal();
    });

    this.querySelector('[data-review-close]')?.addEventListener('click', () => this.close());

    // A click that lands on the dialog box itself is a click on the backdrop,
    // because the panel fills it.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });

    // Esc closes the dialog directly, so tidy up the sheet state after it.
    this.dialog.addEventListener('close', () => this.reset());

    this.setupDrag();
  }

  get isSheet() {
    return window.matchMedia('(max-width: 749px)').matches;
  }

  reset() {
    this.dialog.classList.remove('is-closing', 'is-dragging');
    this.dialog.style.removeProperty('--sheet-drag-y');
  }

  close() {
    if (!this.isSheet || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.dialog.close();
      return;
    }
    if (this.dialog.classList.contains('is-closing')) return;
    this.dialog.classList.remove('is-dragging');
    this.dialog.classList.add('is-closing');
    window.setTimeout(() => this.dialog.close(), ReviewModal.CLOSE_MS);
  }

  /* ------------------------------------------- drag the header to dismiss */

  setupDrag() {
    if (!this.head) return;
    this.pointerId = null;
    this.startY = 0;
    this.deltaY = 0;

    this.head.addEventListener('pointerdown', this.onPointerDown);
    this.head.addEventListener('pointermove', this.onPointerMove);
    this.head.addEventListener('pointerup', this.onPointerUp);
    this.head.addEventListener('pointercancel', this.onPointerUp);
  }

  onPointerDown = (event) => {
    if (!this.isSheet) return;
    // Let the close button behave like a button.
    if (event.target.closest('[data-review-close]')) return;
    this.pointerId = event.pointerId;
    this.startY = event.clientY;
    this.deltaY = 0;
    this.head.setPointerCapture?.(event.pointerId);
    this.dialog.classList.add('is-dragging');
  };

  onPointerMove = (event) => {
    if (this.pointerId !== event.pointerId) return;
    // Only downward travel moves the sheet; upward is ignored.
    this.deltaY = Math.max(0, event.clientY - this.startY);
    this.dialog.style.setProperty('--sheet-drag-y', `${this.deltaY}px`);
  };

  onPointerUp = (event) => {
    if (this.pointerId !== event.pointerId) return;
    this.head.releasePointerCapture?.(event.pointerId);
    this.pointerId = null;

    if (this.deltaY >= ReviewModal.DISMISS_PX) {
      this.close();
      return;
    }
    // Under the threshold the sheet springs back to its resting position.
    this.dialog.classList.remove('is-dragging');
    this.dialog.style.removeProperty('--sheet-drag-y');
    this.deltaY = 0;
  };
}

customElements.define('review-modal', ReviewModal);
