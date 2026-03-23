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
        intensity: 'medium',
        speed: 'medium',
        respectReducedMotion: true,
        forceMotionForTesting: false,
        mobileIntensityMultiplier: 0.65,
        fallbackWithoutCE: true,
        safeRescanMs: 4000,
        minSizePx: 72,
        debug: false,
    });

    const SETTINGS = { ...DEFAULT_SETTINGS };

    const SPEED_PRESETS = {
        slow: 5.2,
        medium: 4.2,
        fast: 3.4,
    };

    const INTENSITY_PRESETS = {
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

        if (!Object.hasOwn(SPEED_PRESETS, normalized.speed)) normalized.speed = DEFAULT_SETTINGS.speed;
        if (!Object.hasOwn(INTENSITY_PRESETS, normalized.intensity)) normalized.intensity = DEFAULT_SETTINGS.intensity;

        normalized.mobileIntensityMultiplier = clamp(parseNumber(normalized.mobileIntensityMultiplier, DEFAULT_SETTINGS.mobileIntensityMultiplier), 0.2, 1.2);
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

    function createSettingsDrawerElement() {
        const container = document.createElement('div');
        container.id = SETTINGS_UI_ID;
        container.className = 'stbreathe-settings';
        container.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header" title="Breathing idle settings for sprites">
                    <b>ST Breathing Idle</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="stbreathe-row stbreathe-row-check">
                        <input id="stbreathe_enabled" type="checkbox" />
                        <label for="stbreathe_enabled">Enabled</label>
                    </div>
                    <div class="stbreathe-row stbreathe-row-field">
                        <label for="stbreathe_intensity">Intensity</label>
                        <select id="stbreathe_intensity" class="text_pole">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    <div class="stbreathe-row stbreathe-row-field">
                        <label for="stbreathe_speed">Speed</label>
                        <select id="stbreathe_speed" class="text_pole">
                            <option value="slow">Slow</option>
                            <option value="medium">Medium</option>
                            <option value="fast">Fast</option>
                        </select>
                    </div>
                    <div class="stbreathe-row stbreathe-row-field">
                        <label for="stbreathe_mobile_multiplier">Mobile Intensity Multiplier</label>
                        <input id="stbreathe_mobile_multiplier" class="text_pole widthUnset" type="number" min="0.2" max="1.2" step="0.05" />
                    </div>
                    <div class="stbreathe-row stbreathe-row-check">
                        <input id="stbreathe_respect_rm" type="checkbox" />
                        <label for="stbreathe_respect_rm">Respect Reduced Motion</label>
                    </div>
                    <div class="stbreathe-row stbreathe-row-check">
                        <input id="stbreathe_force_motion" type="checkbox" />
                        <label for="stbreathe_force_motion">Force Motion (Testing)</label>
                    </div>
                    <div class="stbreathe-row stbreathe-row-check">
                        <input id="stbreathe_fallback_without_ce" type="checkbox" />
                        <label for="stbreathe_fallback_without_ce">Fallback Without Character Expressions</label>
                    </div>
                    <div class="stbreathe-row stbreathe-row-field">
                        <label for="stbreathe_safe_rescan_ms">Safety Rescan (ms)</label>
                        <input id="stbreathe_safe_rescan_ms" class="text_pole widthUnset" type="number" min="1000" max="30000" step="100" />
                    </div>
                    <div class="stbreathe-row stbreathe-row-field">
                        <label for="stbreathe_min_size_px">Min Sprite Size (px)</label>
                        <input id="stbreathe_min_size_px" class="text_pole widthUnset" type="number" min="32" max="1024" step="1" />
                    </div>
                    <div class="stbreathe-row stbreathe-row-check">
                        <input id="stbreathe_debug" type="checkbox" />
                        <label for="stbreathe_debug">Debug Logs</label>
                    </div>
                    <small class="stbreathe-note">Changes apply live and persist in extension settings.</small>
                </div>
            </div>
        `;
        return container;
    }

    function updateSettingsUiValues(root) {
        const get = (id) => root.querySelector(`#${id}`);

        const enabled = get('stbreathe_enabled');
        const intensity = get('stbreathe_intensity');
        const speed = get('stbreathe_speed');
        const mobileMultiplier = get('stbreathe_mobile_multiplier');
        const respectRm = get('stbreathe_respect_rm');
        const forceMotion = get('stbreathe_force_motion');
        const fallback = get('stbreathe_fallback_without_ce');
        const safeRescan = get('stbreathe_safe_rescan_ms');
        const minSize = get('stbreathe_min_size_px');
        const debug = get('stbreathe_debug');

        if (enabled instanceof HTMLInputElement) enabled.checked = SETTINGS.enabled;
        if (intensity instanceof HTMLSelectElement) intensity.value = SETTINGS.intensity;
        if (speed instanceof HTMLSelectElement) speed.value = SETTINGS.speed;
        if (mobileMultiplier instanceof HTMLInputElement) mobileMultiplier.value = SETTINGS.mobileIntensityMultiplier.toFixed(2);
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

    function bindSettingsUiEvents(root) {
        const get = (id) => root.querySelector(`#${id}`);

        const enabled = get('stbreathe_enabled');
        const intensity = get('stbreathe_intensity');
        const speed = get('stbreathe_speed');
        const mobileMultiplier = get('stbreathe_mobile_multiplier');
        const respectRm = get('stbreathe_respect_rm');
        const forceMotion = get('stbreathe_force_motion');
        const fallback = get('stbreathe_fallback_without_ce');
        const safeRescan = get('stbreathe_safe_rescan_ms');
        const minSize = get('stbreathe_min_size_px');
        const debug = get('stbreathe_debug');

        if (enabled instanceof HTMLInputElement) {
            enabled.addEventListener('input', () => {
                SETTINGS.enabled = enabled.checked;
                applyRuntimeSettings('enabled');
            });
        }

        if (intensity instanceof HTMLSelectElement) {
            intensity.addEventListener('change', () => {
                SETTINGS.intensity = intensity.value;
                applyRuntimeSettings('intensity');
            });
        }

        if (speed instanceof HTMLSelectElement) {
            speed.addEventListener('change', () => {
                SETTINGS.speed = speed.value;
                applyRuntimeSettings('speed');
            });
        }

        if (mobileMultiplier instanceof HTMLInputElement) {
            mobileMultiplier.addEventListener('input', () => {
                SETTINGS.mobileIntensityMultiplier = parseNumber(mobileMultiplier.value, SETTINGS.mobileIntensityMultiplier);
                applyRuntimeSettings('mobile-multiplier');
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
