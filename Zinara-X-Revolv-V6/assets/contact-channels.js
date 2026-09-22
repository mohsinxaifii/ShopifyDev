/*
 * Copy-on-click for a contact card.
 *
 * The Figma note on the contact frame (7930:94595) asks for the phone number to
 * be copied rather than dialled, while email and WhatsApp stay ordinary links -
 * so only a card marked `data-copy` is intercepted and everything else is left
 * to the browser.
 *
 * If the clipboard is unavailable - an insecure origin, or a browser that
 * refuses - the click is allowed through to the `tel:` link it was already
 * pointing at, which is the better of the two outcomes anyway.
 */
(() => {
  const FEEDBACK_MS = 1600;

  async function copy(card, text) {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      return false;
    }
  }

  function flash(card) {
    const el = card.querySelector('[data-copied]');
    if (!el) return;

    el.textContent = window.themeStrings?.contactCopied || 'Copied';
    card.classList.add('is-copied');

    window.clearTimeout(card.copiedTimer);
    card.copiedTimer = window.setTimeout(() => {
      el.textContent = '';
      card.classList.remove('is-copied');
    }, FEEDBACK_MS);
  }

  document.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-copy]');
    if (!card) return;

    const text = card.dataset.copy;
    if (!text) return;

    /* Held until the write resolves so a refusal can still fall through to the
       link, which means preventDefault has to come first. */
    event.preventDefault();

    if (await copy(card, text)) flash(card);
    else window.location.href = card.getAttribute('href');
  });
})();
