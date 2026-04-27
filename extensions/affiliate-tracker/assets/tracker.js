(function () {
    try {
        var params = new URLSearchParams(window.location.search);
        var ref = params.get('ref');
        if (!ref) return;
        var clean = ref.toUpperCase().trim();

        // localStorage para lectura en storefront
        localStorage.setItem('affiliate_ref', clean);

        // Cookie para sobrevivir al cross-subdomain del checkout (30 días)
        document.cookie =
            'affiliate_ref=' + encodeURIComponent(clean) +
            '; path=/; max-age=2592000; SameSite=Lax';

        console.log('[Affiliate Engine] Ref code saved:', clean);
    } catch (e) {
        console.error('[Affiliate Tracker] Failed to persist ref:', e);
    }
})();