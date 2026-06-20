(function () {
    'use strict';

    const MODULE_NAME = 'st-breathing-idle';
    const GLOBAL_KEY = '__stBreathingIdleInstance';
    const FORCE_MOTION_KEY = 'stbreathe_force_motion';
    const SETTINGS_STORAGE_KEY = `${MODULE_NAME}_settings`;
    const SETTINGS_UI_ID = 'stbreathe_settings_container';
    const REFRESH_MIN_INTERVAL_MS = 250;
    const SETTINGS_MOUNT_CHECK_MS = 1500;

    if (window[GLOBAL_KEY]) {
        console.debug(`[${MODULE_NAME}] Already initialized, skipping duplicate load.`);
        return;
    }

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        animationMode: 'stretch',
        intensity: 1.0,
        speedSeconds: 4.2,
        offsetX: 0,
        offsetY: 0,
        respectReducedMotion: true,
        forceMotionForTesting: false,
        mobileIntensityMultiplier: 0.65,
        fallbackWithoutCE: true,
        safeRescanMs: 4000,
        minSizePx: 72,
        debug: false,
    });

    const SETTINGS = { ...DEFAULT_SETTINGS };

    const ANIMATION_MODE_PRESETS = {
        stretch: { useTranslate: false, useScale: true },
        move: { useTranslate: true, useScale: false },
        stretch_move: { useTranslate: true, useScale: true },
    };

    // Numeric "intensity" multiplies these base deltas (intensity 1.0 == previous "medium").
    const INTENSITY_BASE = Object.freeze({ translateYPercent: 0.45, scaleYDelta: 0.004, scaleXDelta: 0.0008 });

    // Slider bounds for the numeric controls (the number inputs clamp to these too,
    // except the offsets, which are intentionally limitless).
    const INTENSITY_RANGE = Object.freeze({ min: 0, max: 5, step: 0.01 });
    const SPEED_RANGE = Object.freeze({ min: 0.5, max: 15, step: 0.1 });
    const OFFSET_SLIDER = Object.freeze({ min: -400, max: 400, step: 1 });
    const MOBILE_MULT_RANGE = Object.freeze({ min: 0.2, max: 1.2, step: 0.05 });

    // Legacy preset names -> numeric values, for migrating settings saved by older versions.
    const LEGACY_INTENSITY = Object.freeze({ low: 0.78, medium: 1.0, high: 1.22 });
    const LEGACY_SPEED = Object.freeze({ slow: 5.2, medium: 4.2, fast: 3.4 });

    const SELECTORS = {
        preferred: [
            '#expression-wrapper #expression-holder img.expression',
            '#visual-novel-wrapper .expression-holder img',
            // ST_MultiCharacter_Expression_From_A_Card (MCEFAC): one img per character holder.
            '#mcefac-stage .mcefac-holder img.mcefac-img',
        ],
        fallback: [
            '#expression-wrapper img.expression',
            '#visual-novel-wrapper img.expression',
            '.expression-holder img.expression[data-expression]',
            'img.expression[data-sprite-folder-name]',
            'img.expression[data-expression]',
            // MCEFAC fallback if its stage structure changes.
            '#mcefac-stage img.expression',
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
            // MCEFAC appends its stage directly to <body>; observe it for sprite swaps.
            '#mcefac-stage',
        ],
    };

    let extensionSettingsRef = null;
    let saveSettingsFn = null;
    let settingsMountTimer = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function parseNumber(value, fallback) {
        const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const normalized = { ...DEFAULT_SETTINGS, ...source };

        normalized.enabled = Boolean(normalized.enabled);
        normalized.respectReducedMotion = Boolean(normalized.respectReducedMotion);
        normalized.forceMotionForTesting = Boolean(normalized.forceMotionForTesting);
        normalized.fallbackWithoutCE = Boolean(normalized.fallbackWithoutCE);
        normalized.debug = Boolean(normalized.debug);

        if (!Object.hasOwn(ANIMATION_MODE_PRESETS, normalized.animationMode)) {
            normalized.animationMode = DEFAULT_SETTINGS.animationMode;
        }

        // Migrate legacy preset strings ("low"/"medium"/"high", "slow"/"medium"/"fast") to numbers.
        if (typeof normalized.intensity === 'string') {
            normalized.intensity = LEGACY_INTENSITY[normalized.intensity] ?? DEFAULT_SETTINGS.intensity;
        }
        if (normalized.speedSeconds === undefined && typeof normalized.speed === 'string') {
            normalized.speedSeconds = LEGACY_SPEED[normalized.speed] ?? DEFAULT_SETTINGS.speedSeconds;
        }
        delete normalized.speed;

        normalized.intensity = clamp(parseNumber(normalized.intensity, DEFAULT_SETTINGS.intensity), INTENSITY_RANGE.min, INTENSITY_RANGE.max);
        normalized.speedSeconds = clamp(parseNumber(normalized.speedSeconds, DEFAULT_SETTINGS.speedSeconds), SPEED_RANGE.min, SPEED_RANGE.max);
        // Offsets are intentionally limitless (fully user-customizable).
        normalized.offsetX = parseNumber(normalized.offsetX, DEFAULT_SETTINGS.offsetX);
        normalized.offsetY = parseNumber(normalized.offsetY, DEFAULT_SETTINGS.offsetY);

        normalized.mobileIntensityMultiplier = clamp(parseNumber(normalized.mobileIntensityMultiplier, DEFAULT_SETTINGS.mobileIntensityMultiplier), MOBILE_MULT_RANGE.min, MOBILE_MULT_RANGE.max);
        normalized.safeRescanMs = clamp(Math.round(parseNumber(normalized.safeRescanMs, DEFAULT_SETTINGS.safeRescanMs)), 1000, 30000);
        normalized.minSizePx = clamp(Math.round(parseNumber(normalized.minSizePx, DEFAULT_SETTINGS.minSizePx)), 32, 1024);
        return normalized;
    }

    function getContextSafe() {
        try {
            return window.SillyTavern?.getContext?.() ?? null;
        } catch {
            return null;
        }
    }

    function readLocalSettings() {
        try {
            const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    function writeLocalSettings() {
        try {
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(SETTINGS));
        } catch {
            // no-op
        }
    }

    function syncForceMotionStorage() {
        try {
            if (SETTINGS.forceMotionForTesting) {
                window.localStorage.setItem(FORCE_MOTION_KEY, '1');
            } else {
                window.localStorage.removeItem(FORCE_MOTION_KEY);
            }
        } catch {
            // no-op
        }
    }

    function loadPersistedSettings() {
        const context = getContextSafe();
        if (context?.extensionSettings && typeof context.extensionSettings === 'object') {
            if (!context.extensionSettings[MODULE_NAME] || typeof context.extensionSettings[MODULE_NAME] !== 'object') {
                context.extensionSettings[MODULE_NAME] = {};
            }
            extensionSettingsRef = context.extensionSettings[MODULE_NAME];
            saveSettingsFn = typeof context.saveSettingsDebounced === 'function' ? context.saveSettingsDebounced.bind(context) : null;
            const normalized = normalizeSettings(extensionSettingsRef);
            Object.assign(extensionSettingsRef, normalized);
            Object.assign(SETTINGS, normalized);
            if (saveSettingsFn) saveSettingsFn();
            syncForceMotionStorage();
            return;
        }

        const fallback = normalizeSettings(readLocalSettings());
        Object.assign(SETTINGS, fallback);
        writeLocalSettings();
        syncForceMotionStorage();
    }

    function persistSettings() {
        const normalized = normalizeSettings(SETTINGS);
        Object.assign(SETTINGS, normalized);
        syncForceMotionStorage();

        if (extensionSettingsRef) {
            Object.assign(extensionSettingsRef, normalized);
            if (saveSettingsFn) saveSettingsFn();
        } else {
            writeLocalSettings();
        }
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
        const intensity = clamp(parseNumber(SETTINGS.intensity, DEFAULT_SETTINGS.intensity), INTENSITY_RANGE.min, INTENSITY_RANGE.max);
        const animationMode = ANIMATION_MODE_PRESETS[SETTINGS.animationMode] ?? ANIMATION_MODE_PRESETS.stretch;

        let duration = clamp(parseNumber(SETTINGS.speedSeconds, DEFAULT_SETTINGS.speedSeconds), SPEED_RANGE.min, SPEED_RANGE.max);
        let translate = INTENSITY_BASE.translateYPercent * intensity;
        let scaleY = 1 + (INTENSITY_BASE.scaleYDelta * intensity);
        let scaleX = 1 - (INTENSITY_BASE.scaleXDelta * intensity);

        if (isMobileLikeViewport()) {
            const mult = Number(SETTINGS.mobileIntensityMultiplier) || 0.65;
            duration = Math.max(SPEED_RANGE.min, duration + 0.8);
            translate *= mult;
            scaleY = 1 + ((scaleY - 1) * mult);
            scaleX = 1 + ((scaleX - 1) * mult);
        }

        const effectiveTranslate = animationMode.useTranslate ? translate : 0;
        const effectiveScaleY = animationMode.useScale ? scaleY : 1;
        const effectiveScaleX = animationMode.useScale ? scaleX : 1;

        // Offsets are a constant reposition baked into every keyframe (independent of mode).
        const offsetX = parseNumber(SETTINGS.offsetX, 0);
        const offsetY = parseNumber(SETTINGS.offsetY, 0);

        root.style.setProperty('--stbreathe-duration', `${duration.toFixed(2)}s`);
        root.style.setProperty('--stbreathe-translate-y', `${effectiveTranslate.toFixed(4)}%`);
        root.style.setProperty('--stbreathe-scale-y', `${effectiveScaleY.toFixed(5)}`);
        root.style.setProperty('--stbreathe-scale-x', `${effectiveScaleX.toFixed(5)}`);
        root.style.setProperty('--stbreathe-offset-x', `${offsetX}px`);
        root.style.setProperty('--stbreathe-offset-y', `${offsetY}px`);
    }

    function logDebug(...args) {
        if (SETTINGS.debug) {
            console.debug(`[${MODULE_NAME}]`, ...args);
        }
    }

    function logInfo(...args) {
        console.info(`[${MODULE_NAME}]`, ...args);
    }

    function debounce(fn, waitMs) {
        let timer = null;
        return function debounced(...args) {
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => fn.apply(this, args), waitMs);
        };
    }

    function isElementVisible(node) {
        if (!(node instanceof Element) || !node.isConnected) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getImageSize(node) {
        const rect = node.getBoundingClientRect();
        return {
            width: rect.width || node.naturalWidth || 0,
            height: rect.height || node.naturalHeight || 0,
        };
    }

    function isInsideKnownSpriteRoot(node) {
        return Boolean(
            node.closest('#expression-wrapper')
            || node.closest('#visual-novel-wrapper')
            || node.closest('.expression-holder')
            // MCEFAC stage/holder are first-class sprite roots too.
            || node.closest('#mcefac-stage')
            || node.closest('.mcefac-holder')
        );
    }

    function isExcludedByAncestor(node) {
        return SELECTORS.excludedAncestor.some((selector) => Boolean(node.closest(selector)));
    }

    function hasExpressionSignals(node) {
        return node.classList.contains('expression')
            || node.hasAttribute('data-expression')
            || node.hasAttribute('data-sprite-folder-name')
            || Boolean(node.closest('.expression-holder'))
            // MCEFAC sprites: keep detecting them even if they drop the 'expression' class.
            || node.classList.contains('mcefac-img')
            || Boolean(node.closest('.mcefac-holder'));
    }

    function hasUsableSource(node) {
        const src = node.getAttribute('src');
        return typeof src === 'string' && src.trim().length > 0;
    }

    function isValidSpriteImage(node) {
        if (!(node instanceof HTMLImageElement)) return false;
        if (!node.isConnected) return false;
        if (isExcludedByAncestor(node)) return false;

        const inKnownRoot = isInsideKnownSpriteRoot(node);
        const expressionSignals = hasExpressionSignals(node);
        if (!inKnownRoot && !expressionSignals && !SETTINGS.fallbackWithoutCE) return false;

        if (!isElementVisible(node)) return false;
        const { width, height } = getImageSize(node);
        if (width < SETTINGS.minSizePx || height < SETTINGS.minSizePx) return false;
        if (!hasUsableSource(node)) return false;
        return true;
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
        if (!(wrapper instanceof Element) || !wrapper.isConnected || !(image instanceof Element)) return;
        const parent = wrapper.parentNode;
        if (!parent) return;
        try {
            parent.insertBefore(image, wrapper);
            wrapper.remove();
            image.removeAttribute('data-stbreathe-bound');
        } catch {
            // no-op
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
                if (!document.hidden) this.scheduleRefresh('visibility-change');
            };
        }

        start() {
            if (this.started) return;
            this.started = true;
            applyAnimationVariables();
            this.attachGlobalListeners();
            this.attachBodyObserver();
            this.attachRootObservers();
            this.restartSafeRescanTimer();
            this.scheduleRefresh('startup');
            logInfo('Initialized.');
        }

        restartSafeRescanTimer() {
            if (this.safeRescanTimer !== null) {
                window.clearInterval(this.safeRescanTimer);
                this.safeRescanTimer = null;
            }
            this.safeRescanTimer = window.setInterval(() => {
                this.attachRootObservers();
                this.scheduleRefresh('safe-rescan');
            }, SETTINGS.safeRescanMs);
        }

        reconfigure() {
            if (!this.started) return;
            applyAnimationVariables();
            this.restartSafeRescanTimer();
            this.attachRootObservers();
            if (!SETTINGS.enabled) {
                this.disableAllBreathing();
                return;
            }
            this.scheduleRefresh('reconfigure');
        }

        stop() {
            if (!this.started) return;
            this.started = false;

            if (this.rafHandle !== null) window.cancelAnimationFrame(this.rafHandle);
            if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
            if (this.safeRescanTimer !== null) window.clearInterval(this.safeRescanTimer);
            this.rafHandle = null;
            this.refreshTimer = null;
            this.safeRescanTimer = null;

            if (this.bodyObserver) this.bodyObserver.disconnect();
            this.bodyObserver = null;

            for (const observer of this.rootObservers.values()) observer.disconnect();
            this.rootObservers.clear();

            window.removeEventListener('resize', this.onViewportChange);
            window.removeEventListener('orientationchange', this.onViewportChange);
            window.removeEventListener('pageshow', this.onViewportChange);
            window.removeEventListener('focus', this.onViewportChange);
            document.removeEventListener('visibilitychange', this.onVisibilityChange);
        }

        attachGlobalListeners() {
            window.addEventListener('resize', this.onViewportChange, { passive: true });
            window.addEventListener('orientationchange', this.onViewportChange, { passive: true });
            window.addEventListener('pageshow', this.onViewportChange, { passive: true });
            window.addEventListener('focus', this.onViewportChange, { passive: true });
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }

        attachBodyObserver() {
            if (this.bodyObserver || !(document.body instanceof HTMLBodyElement)) return;
            this.bodyObserver = new MutationObserver(() => {
                const before = this.rootObservers.size;
                this.attachRootObservers();
                const after = this.rootObservers.size;
                if (after > before) this.scheduleRefresh('roots-discovered');
            });
            this.bodyObserver.observe(document.body, { childList: true, subtree: false });
        }

        resolveRoots() {
            const roots = [];
            for (const selector of SELECTORS.rootCandidates) {
                document.querySelectorAll(selector).forEach((node) => {
                    if (node instanceof HTMLElement) roots.push(node);
                });
            }
            return roots;
        }

        attachRootObservers() {
            const roots = this.resolveRoots();
            for (const root of roots) {
                if (this.rootObservers.has(root)) continue;
                const observer = new MutationObserver((mutations) => {
                    if (mutations.length > 0) this.scheduleRefresh('root-mutation');
                });
                observer.observe(root, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['src', 'class', 'style', 'hidden', 'data-expression', 'data-sprite-folder-name'],
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

        scheduleRefresh(reason) {
            logDebug('scheduleRefresh', reason);
            if (!SETTINGS.enabled) return;

            const shouldDisableForReducedMotion =
                SETTINGS.respectReducedMotion && hasReducedMotionPreference() && !isForceMotionEnabled();
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

            if (this.rafHandle !== null) return;
            this.rafHandle = window.requestAnimationFrame(() => {
                this.rafHandle = null;
                this.lastRefreshAt = performance.now();
                this.refreshSprites();
            });
        }

        disableAllBreathing() {
            document.querySelectorAll('.stbreathe-wrap').forEach((wrapper) => wrapper.classList.remove('stbreathe-active'));
            document.querySelectorAll('img.stbreathe-direct').forEach((image) => image.classList.remove('stbreathe-active'));
        }

        refreshSprites() {
            const candidates = collectCandidateImages();
            const activeSet = new Set(candidates);
            for (const image of candidates) this.bindImage(image);
            this.cleanupOrphanWrappers();
            this.cleanupStaleBindings(activeSet);
        }

        bindImage(image) {
            if (!(image instanceof HTMLImageElement)) return;
            const existing = this.imageState.get(image);
            if (existing && existing.wrapper && existing.wrapper.isConnected) {
                existing.wrapper.classList.add('stbreathe-active');
                image.setAttribute('data-stbreathe-bound', '1');
                return;
            }

            const wrapper = this.ensureWrapper(image);
            if (!wrapper) return;
            wrapper.classList.add('stbreathe-active');
            image.classList.remove('stbreathe-direct');
            image.setAttribute('data-stbreathe-bound', '1');
            this.imageState.set(image, { wrapper });
        }

        ensureWrapper(image) {
            const parent = image.parentElement;
            if (!parent) return null;
            if (parent.classList.contains('stbreathe-wrap')) return parent;
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
                if (!isValidSpriteImage(image)) wrapper.classList.remove('stbreathe-active');
            });
        }

        cleanupStaleBindings(activeSet) {
            document.querySelectorAll('img[data-stbreathe-bound="1"]').forEach((image) => {
                if (!(image instanceof HTMLImageElement)) return;
                if (!image.isConnected) {
                    image.removeAttribute('data-stbreathe-bound');
                    image.classList.remove('stbreathe-direct', 'stbreathe-active');
                    return;
                }
                if (!activeSet.has(image)) image.classList.remove('stbreathe-active');
            });
        }
    }

    // Numeric controls handled as synced slider + number pairs. `decimals === null` => integers.
    // `unbounded` keeps the number input free of min/max (offsets). `read` pulls the live value.
    const RANGE_CONTROLS = [
        {
            key: 'intensity', label: 'Intensity', decimals: 2,
            min: INTENSITY_RANGE.min, max: INTENSITY_RANGE.max, step: INTENSITY_RANGE.step,
            help: 'How pronounced the breathing is. 1.00 is the default amount; higher exaggerates it.',
        },
        {
            key: 'speedSeconds', label: 'Speed (s/cycle)', decimals: 2,
            min: SPEED_RANGE.min, max: SPEED_RANGE.max, step: SPEED_RANGE.step,
            help: 'Seconds per breath cycle. Lower is faster, higher is slower.',
        },
        {
            key: 'offsetX', label: 'Offset X (px)', decimals: null, unbounded: true,
            min: OFFSET_SLIDER.min, max: OFFSET_SLIDER.max, step: OFFSET_SLIDER.step,
            help: 'Horizontal shift of the sprite in pixels. Negative moves left. No limits.',
        },
        {
            key: 'offsetY', label: 'Offset Y (px)', decimals: null, unbounded: true,
            min: OFFSET_SLIDER.min, max: OFFSET_SLIDER.max, step: OFFSET_SLIDER.step,
            help: 'Vertical shift of the sprite in pixels. Negative moves up. No limits.',
        },
        {
            key: 'mobileIntensityMultiplier', label: 'Mobile Intensity', decimals: 2,
            min: MOBILE_MULT_RANGE.min, max: MOBILE_MULT_RANGE.max, step: MOBILE_MULT_RANGE.step,
            help: 'Scales intensity down on phones/tablets. 1.00 = same as desktop.',
        },
    ];

    function formatRangeValue(control, value) {
        return control.decimals === null ? String(Math.round(value)) : value.toFixed(control.decimals);
    }

    function helpIcon(text) {
        return `<i class="fa-solid fa-circle-info stbreathe-help" title="${text}"></i>`;
    }

    function rangeRowHtml(control) {
        const numAttrs = control.unbounded
            ? `step="${control.step}"`
            : `min="${control.min}" max="${control.max}" step="${control.step}"`;
        return `
            <div class="stbreathe-row stbreathe-row-range">
                <div class="stbreathe-row-label">
                    <label for="stbreathe_${control.key}_num">${control.label}</label>
                    ${helpIcon(control.help)}
                </div>
                <div class="stbreathe-range-control">
                    <input id="stbreathe_${control.key}_range" class="stbreathe-slider" type="range"
                        min="${control.min}" max="${control.max}" step="${control.step}" />
                    <input id="stbreathe_${control.key}_num" class="text_pole stbreathe-num" type="number" ${numAttrs} />
                </div>
            </div>`;
    }

    function createSettingsDrawerElement() {
        const container = document.createElement('div');
        container.id = SETTINGS_UI_ID;
        container.className = 'stbreathe-settings';

        const rangeRows = Object.fromEntries(RANGE_CONTROLS.map((c) => [c.key, rangeRowHtml(c)]));

        container.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header" title="Breathing idle settings for sprites">
                    <b>ST Breathing Idle</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">

                    <div class="stbreathe-section">
                        <div class="stbreathe-row stbreathe-row-check">
                            <input id="stbreathe_enabled" type="checkbox" />
                            <label for="stbreathe_enabled">Enabled</label>
                            ${helpIcon('Master switch for the breathing animation on all sprites.')}
                        </div>
                    </div>

                    <div class="stbreathe-section">
                        <div class="stbreathe-section-title">Animation</div>
                        <div class="stbreathe-row stbreathe-row-field">
                            <div class="stbreathe-row-label">
                                <label for="stbreathe_animation_mode">Animation Mode</label>
                                ${helpIcon('Stretch scales the sprite, Move shifts it vertically, Stretch + Move does both.')}
                            </div>
                            <select id="stbreathe_animation_mode" class="text_pole">
                                <option value="stretch">Stretch</option>
                                <option value="move">Move</option>
                                <option value="stretch_move">Stretch + Move</option>
                            </select>
                        </div>
                        ${rangeRows.intensity}
                        ${rangeRows.speedSeconds}
                        ${rangeRows.offsetX}
                        ${rangeRows.offsetY}
                    </div>

                    <div class="stbreathe-section">
                        <div class="stbreathe-section-title">Behavior</div>
                        ${rangeRows.mobileIntensityMultiplier}
                        <div class="stbreathe-row stbreathe-row-check">
                            <input id="stbreathe_respect_rm" type="checkbox" />
                            <label for="stbreathe_respect_rm">Respect Reduced Motion</label>
                            ${helpIcon('When your OS requests reduced motion, breathing is disabled automatically.')}
                        </div>
                        <div class="stbreathe-row stbreathe-row-check">
                            <input id="stbreathe_force_motion" type="checkbox" />
                            <label for="stbreathe_force_motion">Force Motion (Testing)</label>
                            ${helpIcon('Override reduced-motion and always animate. Intended for testing only.')}
                        </div>
                        <div class="stbreathe-row stbreathe-row-check">
                            <input id="stbreathe_fallback_without_ce" type="checkbox" />
                            <label for="stbreathe_fallback_without_ce">Fallback Without Character Expressions</label>
                            ${helpIcon('Animate compatible sprites even when official Character Expressions is not detected.')}
                        </div>
                    </div>

                    <div class="stbreathe-section">
                        <div class="stbreathe-section-title">Advanced</div>
                        <div class="stbreathe-row stbreathe-row-field">
                            <div class="stbreathe-row-label">
                                <label for="stbreathe_safe_rescan_ms">Safety Rescan (ms)</label>
                                ${helpIcon('How often to re-scan the DOM as a safety net, in milliseconds.')}
                            </div>
                            <input id="stbreathe_safe_rescan_ms" class="text_pole widthUnset" type="number" min="1000" max="30000" step="100" />
                        </div>
                        <div class="stbreathe-row stbreathe-row-field">
                            <div class="stbreathe-row-label">
                                <label for="stbreathe_min_size_px">Min Sprite Size (px)</label>
                                ${helpIcon('Ignore images smaller than this (avoids animating icons/thumbnails).')}
                            </div>
                            <input id="stbreathe_min_size_px" class="text_pole widthUnset" type="number" min="32" max="1024" step="1" />
                        </div>
                        <div class="stbreathe-row stbreathe-row-check">
                            <input id="stbreathe_debug" type="checkbox" />
                            <label for="stbreathe_debug">Debug Logs</label>
                            ${helpIcon('Print verbose diagnostic messages to the browser console.')}
                        </div>
                    </div>

                    <div class="stbreathe-row stbreathe-reset-row">
                        <div id="stbreathe_reset" class="menu_button stbreathe-reset" title="Restore every setting to its default value">
                            <i class="fa-solid fa-rotate-left"></i> Reset to defaults
                        </div>
                    </div>
                    <small class="stbreathe-note">Changes apply live and persist in extension settings.</small>
                </div>
            </div>
        `;
        return container;
    }

    function updateSettingsUiValues(root) {
        const get = (id) => root.querySelector(`#${id}`);

        for (const control of RANGE_CONTROLS) {
            const value = parseNumber(SETTINGS[control.key], DEFAULT_SETTINGS[control.key]);
            const range = get(`stbreathe_${control.key}_range`);
            const num = get(`stbreathe_${control.key}_num`);
            if (range instanceof HTMLInputElement) range.value = String(clamp(value, control.min, control.max));
            if (num instanceof HTMLInputElement) num.value = formatRangeValue(control, value);
        }

        const enabled = get('stbreathe_enabled');
        const animationMode = get('stbreathe_animation_mode');
        const respectRm = get('stbreathe_respect_rm');
        const forceMotion = get('stbreathe_force_motion');
        const fallback = get('stbreathe_fallback_without_ce');
        const safeRescan = get('stbreathe_safe_rescan_ms');
        const minSize = get('stbreathe_min_size_px');
        const debug = get('stbreathe_debug');

        if (enabled instanceof HTMLInputElement) enabled.checked = SETTINGS.enabled;
        if (animationMode instanceof HTMLSelectElement) animationMode.value = SETTINGS.animationMode;
        if (respectRm instanceof HTMLInputElement) respectRm.checked = SETTINGS.respectReducedMotion;
        if (forceMotion instanceof HTMLInputElement) forceMotion.checked = SETTINGS.forceMotionForTesting;
        if (fallback instanceof HTMLInputElement) fallback.checked = SETTINGS.fallbackWithoutCE;
        if (safeRescan instanceof HTMLInputElement) safeRescan.value = String(SETTINGS.safeRescanMs);
        if (minSize instanceof HTMLInputElement) minSize.value = String(SETTINGS.minSizePx);
        if (debug instanceof HTMLInputElement) debug.checked = SETTINGS.debug;
    }

    function applyRuntimeSettings(reason) {
        persistSettings();
        applyAnimationVariables();

        const instance = window[GLOBAL_KEY];
        if (!(instance instanceof BreathingIdleController)) return;

        instance.reconfigure();
        if (SETTINGS.enabled) {
            instance.scheduleRefresh(`settings-${reason}`);
        } else {
            instance.disableAllBreathing();
        }
    }

    function wireRangePair(root, control) {
        const range = root.querySelector(`#stbreathe_${control.key}_range`);
        const num = root.querySelector(`#stbreathe_${control.key}_num`);

        if (range instanceof HTMLInputElement) {
            range.addEventListener('input', () => {
                const value = parseNumber(range.value, SETTINGS[control.key]);
                SETTINGS[control.key] = value;
                if (num instanceof HTMLInputElement) num.value = formatRangeValue(control, value);
                applyRuntimeSettings(control.key);
            });
        }

        if (num instanceof HTMLInputElement) {
            num.addEventListener('input', () => {
                const value = parseNumber(num.value, SETTINGS[control.key]);
                SETTINGS[control.key] = value;
                // Slider tracks the value but stays within its own bounds (offsets may exceed it).
                if (range instanceof HTMLInputElement) range.value = String(clamp(value, control.min, control.max));
                applyRuntimeSettings(control.key);
            });
        }
    }

    function bindSettingsUiEvents(root) {
        const get = (id) => root.querySelector(`#${id}`);

        for (const control of RANGE_CONTROLS) wireRangePair(root, control);

        const enabled = get('stbreathe_enabled');
        const animationMode = get('stbreathe_animation_mode');
        const respectRm = get('stbreathe_respect_rm');
        const forceMotion = get('stbreathe_force_motion');
        const fallback = get('stbreathe_fallback_without_ce');
        const safeRescan = get('stbreathe_safe_rescan_ms');
        const minSize = get('stbreathe_min_size_px');
        const debug = get('stbreathe_debug');
        const reset = get('stbreathe_reset');

        if (enabled instanceof HTMLInputElement) {
            enabled.addEventListener('input', () => {
                SETTINGS.enabled = enabled.checked;
                applyRuntimeSettings('enabled');
            });
        }

        if (animationMode instanceof HTMLSelectElement) {
            animationMode.addEventListener('change', () => {
                SETTINGS.animationMode = animationMode.value;
                applyRuntimeSettings('animation-mode');
            });
        }

        if (respectRm instanceof HTMLInputElement) {
            respectRm.addEventListener('input', () => {
                SETTINGS.respectReducedMotion = respectRm.checked;
                applyRuntimeSettings('respect-rm');
            });
        }

        if (forceMotion instanceof HTMLInputElement) {
            forceMotion.addEventListener('input', () => {
                SETTINGS.forceMotionForTesting = forceMotion.checked;
                applyRuntimeSettings('force-motion');
            });
        }

        if (fallback instanceof HTMLInputElement) {
            fallback.addEventListener('input', () => {
                SETTINGS.fallbackWithoutCE = fallback.checked;
                applyRuntimeSettings('fallback');
            });
        }

        if (safeRescan instanceof HTMLInputElement) {
            safeRescan.addEventListener('input', () => {
                SETTINGS.safeRescanMs = parseNumber(safeRescan.value, SETTINGS.safeRescanMs);
                applyRuntimeSettings('safe-rescan');
            });
        }

        if (minSize instanceof HTMLInputElement) {
            minSize.addEventListener('input', () => {
                SETTINGS.minSizePx = parseNumber(minSize.value, SETTINGS.minSizePx);
                applyRuntimeSettings('min-size');
            });
        }

        if (debug instanceof HTMLInputElement) {
            debug.addEventListener('input', () => {
                SETTINGS.debug = debug.checked;
                applyRuntimeSettings('debug');
            });
        }

        if (reset instanceof HTMLElement) {
            reset.addEventListener('click', () => {
                Object.assign(SETTINGS, DEFAULT_SETTINGS);
                updateSettingsUiValues(root);
                applyRuntimeSettings('reset');
            });
        }
    }

    function getSettingsMountPoint() {
        const candidates = [
            document.getElementById('stbreathe_container'),
            document.getElementById('extensions_settings2'),
            document.getElementById('extensions_settings'),
            document.querySelector('#extensionsBlock #extensions_settings2'),
            document.querySelector('#extensionsBlock #extensions_settings'),
        ];

        for (const node of candidates) {
            if (node instanceof HTMLElement) return node;
        }
        return null;
    }

    function ensureSettingsUiMounted() {
        if (document.getElementById(SETTINGS_UI_ID)) return true;
        const mountPoint = getSettingsMountPoint();
        if (!(mountPoint instanceof HTMLElement)) return false;

        const drawer = createSettingsDrawerElement();
        mountPoint.appendChild(drawer);
        updateSettingsUiValues(drawer);
        bindSettingsUiEvents(drawer);
        return true;
    }

    function mountSettingsUiWithRetry() {
        if (ensureSettingsUiMounted()) return;
        if (settingsMountTimer !== null) return;

        settingsMountTimer = window.setInterval(() => {
            ensureSettingsUiMounted();
        }, SETTINGS_MOUNT_CHECK_MS);
    }

    function init() {
        loadPersistedSettings();
        mountSettingsUiWithRetry();

        const instance = new BreathingIdleController();
        window[GLOBAL_KEY] = instance;

        if (SETTINGS.respectReducedMotion && hasReducedMotionPreference() && !isForceMotionEnabled()) {
            logInfo(`Reduced motion is enabled. Disable "Respect Reduced Motion" in extension settings or run localStorage.setItem('${FORCE_MOTION_KEY}', '1') for tests.`);
        }

        instance.start();
        if (!SETTINGS.enabled) instance.disableAllBreathing();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
