/**
 * Turns the search results' "Load more" link into infinite scroll. Figma
 * 7930:105498 shows only a spinner at the foot of the grid, so the link is
 * activated as it comes into view rather than waiting for a click.
 *
 * It clicks the existing link instead of fetching: collection.js already owns
 * the paging, the grid append and the history entry, and duplicating that here
 * would mean two implementations drifting apart.
 */
(() => {
  const page = document.querySelector('collection-page.search');
  if (!page || !('IntersectionObserver' in window)) return;

  let pending = false;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || pending) return;
        const link = entry.target.querySelector('[data-more-link]');
        if (!link) return;

        // collection.js replaces the whole [data-more] wrapper when the next
        // page lands, so the guard only has to survive until that swap.
        pending = true;
        link.click();
        setTimeout(() => {
          pending = false;
          watch();
        }, 600);
      });
    },
    { rootMargin: '400px 0px' },
  );

  function watch() {
    const more = page.querySelector('[data-more]');
    if (more) observer.observe(more);
  }

  watch();
})();
