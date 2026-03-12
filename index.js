(function () {
    'use strict';

    const MODULE_NAME = 'st-breathing-idle';
    const GLOBAL_KEY = '__stBreathingIdleInstance';
    const FORCE_MOTION_KEY = 'stbreathe_force_motion';

    if (window[GLOBAL_KEY]) {
        console.debug(`[${MODULE_NAME}] Already initialized, skipping duplicate load.`);
        return;
    }

    const SETTINGS = {
        enabled: true,
        intensity: 'medium', // low | medium | high
        speed: 'medium', // slow | medium | fast
        respectReducedMotion: true,
        mobileIntensityMultiplier: 0.65,
        cePreferred: true,
        fallbackWithoutCE: true,
        safeRescanMs: 4000,
        minSizePx: 72,
        allowDirectFallback: false,
        debug: false,
    };

    const SPEED_PRESETS = {
        slow: 5.2,
        medium: 4.2,
        fast: 3.4,
    };

    const INTENSITY_PRESETS = {
        // Keep peak motion inside overflow-hidden containers used by expression holders.
        // Positive translate compensates vertical expansion to avoid top-edge clipping.
        low: { translateYPercent: 0.35, scaleY: 1.003, scaleX: 0.9994 },
        medium: { translateYPercent: 0.45, scaleY: 1.004, scaleX: 0.9992 },
        high: { translateYPercent: 0.55, scaleY: 1.005, scaleX: 0.999 },
    };

    const SELECTORS = {
        preferred: [
            '#expression-wrapper #expression-holder img.expression',
            '#visual-novel-wrapper .expression-holder img',
        ],
        fallback: [
            '#expression-wrapper img.expression',
            '#visual-novel-wrapper img.expression',
            '.expression-holder img.expression[data-expression]',
            'img.expression[data-sprite-folder-name]',
            'img.expression[data-expression]',
        ],
        excludedAncestor: [
            '#image_list',
            '#expressions_container',
            '.expression_list_item',
            '.expression_list_image_container',
        ],
        rootCandidates: [
            '#expression-wrapper',
            '#visual-novel-wrapper',
        ],
    };
    const REFRESH_MIN_INTERVAL_MS = 250;

    function logDebug(...args) {
        if (SETTINGS.debug) {
            console.debug(`[${MODULE_NAME}]`, ...args);
        }
    }

    function logInfo(...args) {
        console.info(`[${MODULE_NAME}]`, ...args);
    }

    function hasReducedMotionPreference() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    }

    function isForceMotionEnabled() {
        try {
            return window.localStorage.getItem(FORCE_MOTION_KEY) === '1';
        } catch {
            return false;
        }
    }

    function isMobileLikeViewport() {
        try {
            return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
        } catch {
            return window.innerWidth <= 900;
        }
    }

    function applyAnimationVariables() {
        const root = document.documentElement;
        const speedPreset = SPEED_PRESETS[SETTINGS.speed] ?? SPEED_PRESETS.medium;
        const intensityPreset = INTENSITY_PRESETS[SETTINGS.intensity] ?? INTENSITY_PRESETS.medium;

        let duration = speedPreset;
        let translate = intensityPreset.translateYPercent;
        let scaleY = intensityPreset.scaleY;
        let scaleX = intensityPreset.scaleX;

        if (isMobileLikeViewport()) {
            const mult = Number(SETTINGS.mobileIntensityMultiplier) || 0.65;
            duration = Math.max(3.0, speedPreset + 0.8);
            translate *= mult;
            scaleY = 1 + ((scaleY - 1) * mult);
            scaleX = 1 + ((scaleX - 1) * mult);
        }

        root.style.setProperty('--stbreathe-duration', `${duration.toFixed(2)}s`);
        root.style.setProperty('--stbreathe-translate-y', `${translate.toFixed(4)}%`);
        root.style.setProperty('--stbreathe-scale-y', `${scaleY.toFixed(5)}`);
        root.style.setProperty('--stbreathe-scale-x', `${scaleX.toFixed(5)}`);
    }

    function debounce(fn, waitMs) {
        let timer = null;
        return function debounced(...args) {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => fn.apply(this, args), waitMs);
        };
    }

    function isElementVisible(node) {
        if (!(node instanceof Element) || !node.isConnected) {
            return false;
        }

        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        return true;
    }

    function getImageSize(node) {
        const rect = node.getBoundingClientRect();
        return {
            width: rect.width || node.naturalWidth || 0,
            height: rect.height || node.naturalHeight || 0,
        };
    }

    function isInsideKnownSpriteRoot(node) {
        return Boolean(node.closest('#expression-wrapper') || node.closest('#visual-novel-wrapper') || node.closest('.expression-holder'));
    }

    function isExcludedByAncestor(node) {
        return SELECTORS.excludedAncestor.some((selector) => Boolean(node.closest(selector)));
    }

    function hasExpressionSignals(node) {
        return node.classList.contains('expression')
            || node.hasAttribute('data-expression')
            || node.hasAttribute('data-sprite-folder-name')
            || Boolean(node.closest('.expression-holder'));
    }

    function hasUsableSource(node) {
        const src = node.getAttribute('src');
        return typeof src === 'string' && src.trim().length > 0;
    }

    function isValidSpriteImage(node) {
        if (!(node instanceof HTMLImageElement)) {
            return false;
        }

        if (!node.isConnected) {
            return false;
        }

        if (isExcludedByAncestor(node)) {
            return false;
        }

        const inKnownRoot = isInsideKnownSpriteRoot(node);
        const expressionSignals = hasExpressionSignals(node);

        if (SETTINGS.cePreferred && !inKnownRoot && !expressionSignals) {
            return false;
        }

        if (!SETTINGS.fallbackWithoutCE && !inKnownRoot) {
            return false;
        }

        if (!isElementVisible(node)) {
            return false;
        }

        const { width, height } = getImageSize(node);
        if (width < SETTINGS.minSizePx || height < SETTINGS.minSizePx) {
            return false;
        }

        if (!hasUsableSource(node)) {
            return false;
        }

        return true;
    }

    function detectCharacterExpressionsPresence() {
        return Boolean(
            document.querySelector('#expression-wrapper')
            || document.querySelector('#visual-novel-wrapper')
            || document.querySelector('img.expression[data-expression]')
            || document.querySelector('img.expression[data-sprite-folder-name]')
        );
    }

    function collectCandidateImages() {
        const candidates = new Set();

        for (const selector of SELECTORS.preferred) {
            document.querySelectorAll(selector).forEach((node) => candidates.add(node));
        }

        if (candidates.size === 0 || SETTINGS.fallbackWithoutCE) {
            for (const selector of SELECTORS.fallback) {
                document.querySelectorAll(selector).forEach((node) => candidates.add(node));
            }
        }

        return Array.from(candidates).filter(isValidSpriteImage);
    }

    function unwrapImage(image, wrapper) {
        if (!(wrapper instanceof Element) || !wrapper.isConnected || !(image instanceof Element)) {
            return;
        }

        const parent = wrapper.parentNode;
        if (!parent) {
            return;
        }

        try {
            parent.insertBefore(image, wrapper);
            wrapper.remove();
            image.removeAttribute('data-stbreathe-bound');
        } catch {
            // Conservative no-op.
        }
    }

    class BreathingIdleController {
        constructor() {
            this.imageState = new WeakMap();
            this.rootObservers = new Map();
            this.bodyObserver = null;
            this.safeRescanTimer = null;
            this.rafHandle = null;
            this.refreshTimer = null;
            this.lastRefreshAt = 0;
            this.started = false;

            this.onViewportChange = debounce(() => {
                applyAnimationVariables();
                this.scheduleRefresh('viewport-change');
            }, 200);

            this.onVisibilityChange = () => {
                if (!document.hidden) {
                    this.scheduleRefresh('visibility-change');
                }
            };
        }

        start() {
            if (this.started) {
                return;
            }

            this.started = true;
            applyAnimationVariables();

            this.attachGlobalListeners();
            this.attachBodyObserver();
            this.attachRootObservers();
            this.scheduleRefresh('startup');

            this.safeRescanTimer = window.setInterval(() => {
                this.attachRootObservers();
                this.scheduleRefresh('safe-rescan');
            }, SETTINGS.safeRescanMs);

            logInfo('Initialized. CE detected:', detectCharacterExpressionsPresence());
        }

        stop() {
            if (!this.started) {
                return;
            }

            this.started = false;

            if (this.rafHandle !== null) {
                window.cancelAnimationFrame(this.rafHandle);
                this.rafHandle = null;
            }

            if (this.refreshTimer !== null) {
                window.clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }

            if (this.safeRescanTimer !== null) {
                window.clearInterval(this.safeRescanTimer);
                this.safeRescanTimer = null;
            }

            if (this.bodyObserver) {
                this.bodyObserver.disconnect();
                this.bodyObserver = null;
            }

            for (const observer of this.rootObservers.values()) {
                observer.disconnect();
            }
            this.rootObservers.clear();

            window.removeEventListener('resize', this.onViewportChange);
            window.removeEventListener('orientationchange', this.onViewportChange);
            window.removeEventListener('pageshow', this.onViewportChange);
            window.removeEventListener('focus', this.onViewportChange);
            document.removeEventListener('visibilitychange', this.onVisibilityChange);

            document.querySelectorAll('.stbreathe-wrap').forEach((wrapper) => {
                const image = wrapper.querySelector('img');
                if (image instanceof HTMLImageElement) {
                    unwrapImage(image, wrapper);
                } else {
                    wrapper.remove();
                }
            });
        }

        attachGlobalListeners() {
            window.addEventListener('resize', this.onViewportChange, { passive: true });
            window.addEventListener('orientationchange', this.onViewportChange, { passive: true });
            window.addEventListener('pageshow', this.onViewportChange, { passive: true });
            window.addEventListener('focus', this.onViewportChange, { passive: true });
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }

        attachBodyObserver() {
            if (this.bodyObserver || !(document.body instanceof HTMLBodyElement)) {
                return;
            }

            this.bodyObserver = new MutationObserver(() => {
                const before = this.rootObservers.size;
                this.attachRootObservers();
                const after = this.rootObservers.size;
                if (after > before) {
                    this.scheduleRefresh('roots-discovered');
                }
            });

            this.bodyObserver.observe(document.body, {
                childList: true,
                subtree: false,
            });
        }

        attachRootObservers() {
            const roots = this.resolveRoots();

            for (const root of roots) {
                if (this.rootObservers.has(root)) {
                    continue;
                }

                const observer = new MutationObserver((mutations) => {
                    if (mutations.length > 0) {
                        this.scheduleRefresh('root-mutation');
                    }
                });

                observer.observe(root, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: [
                        'src',
                        'class',
                        'style',
                        'hidden',
                        'data-expression',
                        'data-sprite-folder-name',
                    ],
                });

                this.rootObservers.set(root, observer);
            }

            for (const [root, observer] of this.rootObservers.entries()) {
                if (!root.isConnected) {
                    observer.disconnect();
                    this.rootObservers.delete(root);
                }
            }
        }

        resolveRoots() {
            const roots = [];

            for (const selector of SELECTORS.rootCandidates) {
                document.querySelectorAll(selector).forEach((node) => {
                    if (node instanceof HTMLElement) {
                        roots.push(node);
                    }
                });
            }

            return roots;
        }

        scheduleRefresh(reason) {
            logDebug('scheduleRefresh', reason);

            if (!SETTINGS.enabled) {
                return;
            }

            const shouldDisableForReducedMotion =
                SETTINGS.respectReducedMotion
                && hasReducedMotionPreference()
                && !isForceMotionEnabled();

            if (shouldDisableForReducedMotion) {
                this.disableAllBreathing();
                return;
            }

            const now = performance.now();
            const elapsed = now - this.lastRefreshAt;
            if (elapsed < REFRESH_MIN_INTERVAL_MS) {
                if (this.refreshTimer === null) {
                    const delay = Math.max(0, REFRESH_MIN_INTERVAL_MS - elapsed);
                    this.refreshTimer = window.setTimeout(() => {
                        this.refreshTimer = null;
                        this.scheduleRefresh('throttled');
                    }, delay);
                }
                return;
            }

            if (this.rafHandle !== null) {
                return;
            }

            this.rafHandle = window.requestAnimationFrame(() => {
                this.rafHandle = null;
                this.lastRefreshAt = performance.now();
                this.refreshSprites();
            });
        }

        disableAllBreathing() {
            document.querySelectorAll('.stbreathe-wrap').forEach((wrapper) => {
                wrapper.classList.remove('stbreathe-active');
            });

            document.querySelectorAll('img.stbreathe-direct').forEach((image) => {
                image.classList.remove('stbreathe-active');
            });
        }

        refreshSprites() {
            const candidates = collectCandidateImages();
            const activeSet = new Set(candidates);

            for (const image of candidates) {
                this.bindImage(image);
            }

            this.cleanupOrphanWrappers();
            this.cleanupStaleBindings(activeSet);
        }

        bindImage(image) {
            if (!(image instanceof HTMLImageElement)) {
                return;
            }

            const existing = this.imageState.get(image);
            if (existing && existing.wrapper && existing.wrapper.isConnected) {
                existing.wrapper.classList.add('stbreathe-active');
                image.setAttribute('data-stbreathe-bound', '1');
                return;
            }

            const wrapper = this.ensureWrapper(image);
            if (!wrapper) {
                if (SETTINGS.allowDirectFallback) {
                    image.classList.add('stbreathe-direct', 'stbreathe-active');
                    image.setAttribute('data-stbreathe-bound', '1');
                }
                return;
            }

            wrapper.classList.add('stbreathe-active');
            image.classList.remove('stbreathe-direct');
            image.setAttribute('data-stbreathe-bound', '1');
            this.imageState.set(image, { wrapper });
        }

        ensureWrapper(image) {
            const parent = image.parentElement;
            if (!parent) {
                return null;
            }

            if (parent.classList.contains('stbreathe-wrap')) {
                return parent;
            }

            try {
                const wrapper = document.createElement('span');
                wrapper.className = 'stbreathe-wrap';

                parent.insertBefore(wrapper, image);
                wrapper.appendChild(image);

                return wrapper;
            } catch (error) {
                logDebug('Failed to wrap image', error);
                return null;
            }
        }

        cleanupOrphanWrappers() {
            document.querySelectorAll('.stbreathe-wrap').forEach((wrapper) => {
                const image = wrapper.querySelector('img');

                if (!(image instanceof HTMLImageElement)) {
                    wrapper.remove();
                    return;
                }

                if (!image.isConnected) {
                    wrapper.remove();
                    return;
                }

                if (!isValidSpriteImage(image)) {
                    wrapper.classList.remove('stbreathe-active');
                }
            });
        }

        cleanupStaleBindings(activeSet) {
            document.querySelectorAll('img[data-stbreathe-bound="1"]').forEach((image) => {
                if (!(image instanceof HTMLImageElement)) {
                    return;
                }

                if (!image.isConnected) {
                    image.removeAttribute('data-stbreathe-bound');
                    image.classList.remove('stbreathe-direct', 'stbreathe-active');
                    return;
                }

                if (!activeSet.has(image)) {
                    image.classList.remove('stbreathe-active');
                }
            });
        }
    }

    function init() {
        const instance = new BreathingIdleController();
        window[GLOBAL_KEY] = instance;

        if (!SETTINGS.enabled) {
            logInfo('Disabled via default settings.');
            return;
        }

        if (SETTINGS.respectReducedMotion && hasReducedMotionPreference() && !isForceMotionEnabled()) {
            logInfo(`Reduced motion is enabled. To force breathing for tests only, run localStorage.setItem('${FORCE_MOTION_KEY}', '1') and reload.`);
        }

        instance.start();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
