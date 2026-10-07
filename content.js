// MarketLens - Content Script
// Filtra, analiza precios y bloquea vendedores en los resultados de Wallapop

// Funciones que cada usuario puede activar o desactivar en la configuración
const ML_FEATURES = [
  { key: 'filter', title: 'Filtro de reservas', description: 'Muestra solo disponibles o reservados' },
  { key: 'prices', title: 'Análisis de precios', description: 'Media, rango y diferencia en cada anuncio' },
  { key: 'sellers', title: 'Vendedor de cada anuncio', description: 'Muestra su ID y permite copiarlo' },
  { key: 'blocking', title: 'Bloquear vendedores', description: 'Oculta todos los anuncios de un vendedor' },
  { key: 'hide', title: 'Ocultar anuncios', description: 'La × oculta y el ojo lo recupera' },
  { key: 'keywords', title: 'Palabras excluidas', description: 'Oculta los anuncios que las contienen' },
  { key: 'titles', title: 'Buscar en el título', description: 'Compara las palabras con el título' },
  { key: 'descriptions', title: 'Buscar en la descripción', description: 'La toma de la respuesta de la búsqueda' }
];

// Tarjeta de un anuncio: la del perfil de un vendedor es un <a>, la de la búsqueda un <article>
const ML_CARD_SELECTOR = 'a.item-card_ItemCard--vertical__CNrfk, article[class*="ItemCard"]';

// Precio dentro de una tarjeta, del selector más específico al más genérico
const ML_PRICE_SELECTORS = [
  'strong[class*="ItemCard__price"]',
  '[class*="ItemCard__currentPrice"]',
  '[aria-label="Current price"]',
  'strong[aria-label="Item price"]',
  '[class*="__price"]'
];

// Iconos de línea (SVG inline, heredan el color del texto)
const ML_SVG = (size, body, extra = '') =>
  `<svg class="ml-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const ML_ICONS = {
  logo: (size = 22) => ML_SVG(size, '<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path><path d="M7.5 12.5l2-2 1.8 1.5 2.4-3"></path>'),
  close: ML_SVG(12, '<path d="M5 5l14 14M19 5L5 19"></path>', ' stroke-width="2.6"'),
  eye: ML_SVG(14, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>', ' stroke-width="2.2"'),
  ban: ML_SVG(14, '<circle cx="12" cy="12" r="9"></circle><path d="M5.6 5.6l12.8 12.8"></path>', ' stroke-width="2.2"'),
  trend: ML_SVG(16, '<path d="M3 17l6-6 4 4 8-8"></path><path d="M15 7h6v6"></path>'),
  book: ML_SVG(18, '<path d="M3 4.5h6a3 3 0 013 3V20a2 2 0 00-2-2H3z"></path><path d="M21 4.5h-6a3 3 0 00-3 3V20a2 2 0 012-2h7z"></path>', ' stroke-width="1.7"'),
  coffee: ML_SVG(18, '<path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"></path><path d="M16 10h1.5a2.5 2.5 0 010 5H16"></path><path d="M8 3.5v2M12 3.5v2"></path>', ' stroke-width="1.7"'),
  user: ML_SVG(11, '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"></path>', ' stroke-width="2.4"'),
  check: ML_SVG(14, '<path d="M5 12.5l4.5 4.5L19 7"></path>', ' stroke-width="2.6"'),
  alert: ML_SVG(14, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5M12 16.5v.5"></path>', ' stroke-width="2.4"')
};

class WallapopFilter {
  filterMode = 'all'; // 'all', 'reserved', 'available'
  extensionEnabled = true;
  isInitialized = false;
  observer = null;
  filterIndicator = null;

  // Constante para límite de precio máximo
  PRICE_MAX = 100000;

  // Funciones activables (el filtro se guarda aparte, en extensionEnabled)
  features = { prices: true, sellers: true, blocking: true, hide: true, keywords: true, titles: true, descriptions: true };

  // Anuncios ocultados (ruta /item/...) y máximo que se recuerda
  hiddenItems = new Set();
  HIDDEN_MAX = 5000;

  // Palabras o frases excluidas, sus comparadores y los anuncios que se muestran un momento
  blockedWords = [];
  wordMatchers = [];
  WORDS_MAX = 200;
  WORD_MAX_LENGTH = 60;
  PEEK_MS = 5000;
  peekTimers = new Map();

  // Descripciones que llegan con la respuesta de la API, por ruta del anuncio (/item/...)
  itemDescriptions = new Map();
  DESCRIPTIONS_MAX = 3000;
  DESCRIPTION_MAX_LENGTH = 5000;

  // Flag para detectar si el contexto está invalidado
  contextInvalidated = false;

  // Nuevas funcionalidades del injector
  priceAnalysis = {
    allPrices: [],
    averagePrice: 0,
    isComplete: false,
    attempts: 0,
    maxAttempts: 5
  };

  userBlocking = {
    blockedUsers: new Set(),
    blockedAdsCount: 0,
    uniqueAuthors: new Set()
  };

  kpiStats = {
    totalItems: 0,
    matchedItems: 0,
    apiItems: []
  };

  constructor() {
    // Verificar contexto inmediatamente en el constructor
    this.checkContextValidity();
    
    // Marcar contexto inválido al navegar
    window.addEventListener('beforeunload', () => { 
      this.contextInvalidated = true; 
    });
    
    this.init();
    this.addCustomStyles();
  }

  // Agregar estilos CSS personalizados
  addCustomStyles() {
    if (document.getElementById('wallapop-filter-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'wallapop-filter-styles';
    style.textContent = `
      .rs-hidden { display: none !important; }
      .rs-visible { display: block !important; }
    `;
    document.head.appendChild(style);
  }

  // Helper para enviar mensajes de forma segura
  // Enviar mensaje de forma segura con timeout e ignorar errores benignos
  safeSendMessage(message, callback) {
    try {
      // Verificar si es seguro enviar
      if (!this.shouldSend()) {
        if (callback) callback(null);
        return;
      }

      // Fire-and-forget si no esperas respuesta
      if (!callback) { 
        if (this.canUseChromeAPIs()) {
          chrome.runtime.sendMessage(message); 
        }
        return; 
      }

      // Verificar si podemos enviar
      if (!this.canUseChromeAPIs()) {
        console.warn('⚠️ Chrome APIs no disponibles, saltando sendMessage');
        callback(null);
        return;
      }

      let done = false;
      const to = setTimeout(() => { 
        if (!done) { 
          done = true; 
          callback(null); 
        } 
      }, 1200);

      chrome.runtime.sendMessage(message, (response) => {
        if (done) return;
        done = true; 
        clearTimeout(to);

        const err = chrome.runtime.lastError?.message || '';
        if (err) {
          // Ignora casos típicos de navegación / SW descargado (benignos)
          const benign = /Extension context invalidated|message port closed|before a response/i.test(err);
          if (!benign) console.warn('⚠️ sendMessage error:', err);
          
          // Marcar contexto como invalidado solo para errores críticos
          if (err.includes('Extension context invalidated')) {
            this.contextInvalidated = true;
          }
          
          return callback(null);
        }
        callback(response);
      });
    } catch (e) {
      console.warn('⚠️ Error enviando mensaje:', e);
      callback?.(null);
    }
  }

  // Detectar si el contexto está invalidado
  checkContextValidity() {
    if (this.contextInvalidated) return false;
    
    // Verificar si chrome está disponible
    if (!chrome?.runtime) {
      console.warn('⚠️ Chrome runtime no disponible, activando modo fallback');
      this.contextInvalidated = true;
      return false;
    }
    
    // Verificar si las funciones específicas están disponibles
    if (!chrome.runtime.getURL || !chrome.runtime.sendMessage) {
      console.warn('⚠️ Chrome runtime functions no disponibles, activando modo fallback');
      this.contextInvalidated = true;
      return false;
    }
    
    try {
      // Intentar una operación simple de Chrome API
      chrome.runtime.getURL('icons/icon16.png');
      return true;
    } catch (error) {
      console.warn('⚠️ Contexto invalidado detectado, activando modo fallback:', error.message);
      this.contextInvalidated = true;
      return false;
    }
  }

  // Verificar si podemos usar Chrome APIs de forma segura
  canUseChromeAPIs() {
    // Verificaciones básicas
    if (!chrome?.runtime) return false;
    if (this.contextInvalidated) return false;
    
    // Verificar si las funciones específicas están disponibles
    if (!chrome.runtime.getURL || !chrome.runtime.sendMessage) return false;
    
    // Verificación adicional: intentar una operación simple
    try {
      // Hacer una llamada de prueba muy simple
      chrome.runtime.getURL('test');
      return true;
    } catch (error) {
      // Si falla, marcar como invalidado
      if (error.message?.includes('Extension context invalidated')) {
        console.warn('⚠️ Contexto invalidado detectado en verificación, activando modo fallback');
        this.contextInvalidated = true;
      }
      return false;
    }
  }

  // Verificar si es seguro enviar mensajes
  shouldSend() {
    return !this.contextInvalidated && document.readyState !== 'unloading';
  }

  // Limpiar recursos y listeners
  destroy() {
    console.log('🧹 Limpiando recursos de WallapopFilter...');
    
    // Marcar como invalidado
    this.contextInvalidated = true;
    
    // Desconectar observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Limpiar intervalos
    if (this.sidebarInterval) {
      clearInterval(this.sidebarInterval);
      this.sidebarInterval = null;
    }
    
    // Quitar listeners de ventana y de runtime
    if (this.onScroll) window.removeEventListener('scroll', this.onScroll);
    if (this.onWindowMessage) window.removeEventListener('message', this.onWindowMessage);
    if (this.onRuntimeMessage) {
      try { chrome.runtime.onMessage.removeListener(this.onRuntimeMessage); } catch (e) {}
    }
    
    // Quitar las clases de funciones desactivadas
    this.clearFeatureClasses();
    
    // Quitar botones de ocultar y su estado: la instancia nueva los vuelve a crear
    document.querySelectorAll('.wallapop-delete-ad-btn').forEach((element) => element.remove());
    document.querySelectorAll('.ml-ad-hidden, .ml-ad-filtered, .ml-ad-peek').forEach((element) => {
      element.classList.remove('ml-ad-hidden', 'ml-ad-filtered', 'ml-ad-peek');
    });
    this.peekTimers.forEach((timer) => clearTimeout(timer));
    this.peekTimers.clear();
    
    // Remover sidebar del DOM
    if (this.filterIndicator) {
      this.filterIndicator.remove();
      this.filterIndicator = null;
    }
    
    // Remover tab del DOM
    if (this.sidebarTab) {
      this.sidebarTab.remove();
      this.sidebarTab = null;
    }
    
    // Remover estilos
    const styles = document.getElementById('wallapop-filter-styles');
    if (styles) {
      styles.remove();
    }
    
    console.log('✅ Recursos limpiados');
  }

  init() {
    console.log('🚀 MarketLens iniciado');
    
    // Verificar validez del contexto al inicializar
    this.checkContextValidity();
    
    // Verificación adicional: si el contexto está invalidado, activar modo fallback inmediatamente
    if (this.contextInvalidated) {
      console.warn('⚠️ Contexto invalidado detectado al inicializar, activando modo fallback completo');
    }
    
    // Cargar configuración guardada
    this.loadSettings().catch((error) => console.warn('⚠️ Error cargando configuración:', error.message));
    
    // Esperar a que la página cargue completamente
    this.waitForResults();
    
    // Escuchar mensajes del popup
    this.setupMessageListener();
    
    // Agregar indicador visual
    this.addFilterIndicator();
    
    // Inicializar nuevas funcionalidades
    this.setupApiInterception();
    this.setupPriceAnalysis();
    this.setupUserBlocking();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['filterMode', 'extensionEnabled', 'features', 'hiddenItems', 'blockedWords', 'seenItems']);
      this.filterMode = result.filterMode || 'all';
      this.extensionEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : true;
      for (const key of Object.keys(this.features)) {
        if (typeof result.features?.[key] === 'boolean') this.features[key] = result.features[key];
      }
      if (Array.isArray(result.hiddenItems)) {
        this.hiddenItems = new Set(result.hiddenItems.filter((key) => typeof key === 'string'));
        this.refreshHiddenAds();
      }
      if (Array.isArray(result.blockedWords)) {
        this.setBlockedWords(result.blockedWords);
        this.renderWordList();
      }
      // La antigua función "visto" ya no existe: se borran sus marcas
      if (result.seenItems !== undefined) {
        chrome.storage.local.remove('seenItems').catch(() => {});
      }
      console.log(`📋 Configuración cargada - Filtro: ${this.filterMode}, Activa: ${this.extensionEnabled}`);
      
      // Reflejar la configuración en la página y en el panel
      this.applyFeatureClasses();
      this.syncSettingsUi();
      this.updateStatusIndicators();
    } catch (error) {
      console.warn('⚠️ No se pudo cargar configuración, usando valores por defecto:', error.message);
      this.extensionEnabled = true;
    }
  }

  waitForResults() {
    const checkResults = () => {
      const results = this.getSearchResults();
      
      if (results.length > 0) {
        console.log(`🔍 Encontrados ${results.length} resultados de búsqueda`);
        this.applyFilter();
        this.setupObserver();
        this.isInitialized = true;
      } else {
        // Reintentar cada 500ms
        setTimeout(checkResults, 500);
      }
    };
    
    // Esperar un poco antes de empezar a buscar
    setTimeout(checkResults, 1000);
  }

  // Tarjetas de anuncio de la página (las más externas, por si hubiera anidadas)
  getSearchResults() {
    const cards = Array.from(document.querySelectorAll(ML_CARD_SELECTOR))
      .filter((card) => !card.parentElement?.closest(ML_CARD_SELECTOR));
    if (cards.length > 0) return cards;

    // Fallback: enlaces a anuncios, si Wallapop cambia las clases
    return Array.from(document.querySelectorAll('a[href*="/item/"]'));
  }

  // Tarjeta que contiene un elemento
  getCard(element) {
    let card = element.closest(ML_CARD_SELECTOR);
    while (card?.parentElement?.closest(ML_CARD_SELECTOR)) {
      card = card.parentElement.closest(ML_CARD_SELECTOR);
    }
    return card;
  }

  // Productos que aporta un nodo añadido al DOM: él mismo o sus descendientes
  findProductsIn(node) {
    if (node.matches?.(ML_CARD_SELECTOR)) return [node];
    return node.querySelectorAll?.(ML_CARD_SELECTOR) ?? [];
  }

  setupObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const newProducts = this.findProductsIn(node);
              
              if (newProducts.length > 0) {
                console.log(`🔄 Detectados ${newProducts.length} nuevos productos`);
                shouldUpdate = true;
                break;
              }
            }
          }
        }
      });
      
      if (shouldUpdate) {
        console.log('🔄 Aplicando filtro a nuevos productos...');
        setTimeout(() => this.applyFilter(), 100);
      }
    });

    const targetContainer = document.querySelector('main') || document.body;
    
    if (targetContainer) {
      console.log(`👁️ Observando cambios en:`, targetContainer.tagName, targetContainer.className);
      this.observer.observe(targetContainer, {
        childList: true,
        subtree: true
      });
    }
  }

  applyFilter() {
    const results = this.getSearchResults();
    if (results.length === 0) return;

    // Verificar si la extensión está activa
    if (!this.extensionEnabled) {
      // Si está desactivada, mostrar todos los productos
      results.forEach(productLink => {
        const card = productLink.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || productLink;
        card.classList.remove('rs-hidden');
      });
      this.updateFilterIndicator(results.length, results.length);
      return;
    }

    let visibleCount = 0;
    let hiddenCount = 0;

    results.forEach((productLink) => {
      const shouldShow = this.matchesFilter(this.isItemReserved(productLink));
      
      // ✅ USAR TU MÉTODO QUE FUNCIONA
      const card = productLink.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || productLink;
      
      if (shouldShow) {
        card.classList.remove('rs-hidden');
        visibleCount++;
      } else {
        card.classList.add('rs-hidden');
        hiddenCount++;
      }
    });

    console.log(`📊 Filtro aplicado (${this.filterMode}): ${visibleCount} visibles, ${hiddenCount} ocultos`);
    this.updateFilterIndicator(visibleCount, results.length);
  }

  // ¿Debe mostrarse un anuncio con este estado de reserva con el filtro actual?
  matchesFilter(isReserved) {
    switch (this.filterMode) {
      case 'reserved':
        return isReserved;
      case 'available':
        return !isReserved;
      default: // 'all'
        return true;
    }
  }

  isItemReserved(productLink) {
    // ✅ DETECCIÓN ESPECÍFICA para wallapop-badge
    const reservedBadges = productLink.querySelectorAll('wallapop-badge[badge-type="reserved"]');
    if (reservedBadges.length > 0) {
        return true;
    }

    // Fallback: buscar por atributo text
    const allBadges = productLink.querySelectorAll('wallapop-badge');
    for (const badge of allBadges) {
      const textAttr = badge.getAttribute('text') || '';
      if (textAttr === 'Reservado' || textAttr === 'Reserved') {
        return true;
      }
    }

    return false;
  }

  // ===== NUEVAS FUNCIONALIDADES DEL INJECTOR =====

  // Elemento con el precio de una tarjeta
  findCardPrice(card) {
    for (const selector of ML_PRICE_SELECTORS) {
      const element = card.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  // Precios de los anuncios de la página, sin contar los ocultados ni los filtrados por palabras
  findPriceElements() {
    return this.getSearchResults()
      .filter((card) => this.getAdHold(card) === null)
      .map((card) => this.findCardPrice(card))
      .filter(Boolean);
  }

  // Extraer precio de un elemento
  extractPrice(priceElement) {
    if (!priceElement) return null;
    
    // Normalizar texto del precio para formato europeo
    const text = priceElement.textContent
      .replaceAll(/\s|&nbsp;/g, '')  // Eliminar espacios y &nbsp;
      .replaceAll('.', '')            // Eliminar puntos (separadores de miles)
      .replace(',', '.');         // Convertir coma a punto decimal
    
    // Buscar patrón de número con decimales opcionales
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const price = Number.parseFloat(match[1]);
      // Aumentar límite para vehículos y productos caros
      if (price && !Number.isNaN(price) && price <= 100000) {
        return price;
      }
    }
    
    return null;
  }

  // Helper para crear botón de ocultar anuncio
  // Evita el recorte de los botones y asegura el apilado de la tarjeta
  prepareCardContainer(card) {
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.style.overflow = 'visible';
    card.style.zIndex = '2';
  }

  // Botón de la tarjeta: × para ocultar; en un anuncio oculto o filtrado cubre toda la tarjeta
  ensureHideButton(card) {
    this.prepareCardContainer(card);
    if (card.querySelector(':scope > .wallapop-delete-ad-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wallapop-delete-ad-btn';
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (btn.dataset.mode === 'filtered') {
        this.peekAd(card);
      } else {
        this.toggleAdHidden(card);
      }
    });

    card.appendChild(btn);
    this.syncHiddenCard(card);
  }

  // Helper para insertar indicador de precio
  insertPriceIndicator(priceElement, price) {
    const indicator = document.createElement('span');
    indicator.className = 'wallapop-price-indicator';
    indicator.dataset.price = price;
    this.renderPriceIndicator(indicator, price);

    priceElement.parentNode.insertBefore(indicator, priceElement.nextSibling);
    console.log(`✅ Indicador agregado: ${price}€ - ${indicator.textContent}`);
  }

  // ===== CONFIGURACIÓN: activar y desactivar funciones =====

  isFeatureEnabled(key) {
    if (key === 'filter') return this.extensionEnabled;
    return this.features[key] !== false;
  }

  // Cada función desactivada añade ml-off-<clave> a <html>; el CSS oculta sus elementos
  applyFeatureClasses() {
    for (const key of Object.keys(this.features)) {
      document.documentElement.classList.toggle(`ml-off-${key}`, !this.features[key]);
    }
  }

  clearFeatureClasses() {
    for (const key of Object.keys(this.features)) {
      document.documentElement.classList.remove(`ml-off-${key}`);
    }
  }

  // Interruptores del panel: estado actual; bloquear depende de ver al vendedor
  syncSettingsUi() {
    this.filterIndicator?.querySelectorAll('input[data-feature]').forEach((input) => {
      input.checked = this.isFeatureEnabled(input.dataset.feature);
      if (input.dataset.feature === 'blocking') input.disabled = !this.features.sellers;
      if (['titles', 'descriptions'].includes(input.dataset.feature)) input.disabled = !this.features.keywords;
    });
  }

  saveSettings(values) {
    const warn = (error) => console.warn('⚠️ No se pudo guardar la configuración:', error.message);
    try {
      chrome.storage.local.set(values).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  setFeatureEnabled(key, enabled) {
    if (key === 'filter') {
      this.setFilterEnabled(enabled);
      return;
    }
    if (!(key in this.features)) return;

    this.features[key] = enabled;
    this.applyFeatureClasses();
    this.syncSettingsUi();
    if (['hide', 'keywords', 'titles', 'descriptions'].includes(key)) {
      this.refreshHiddenAds();
      this.recalculatePrices();
    }
    this.saveSettings({ features: { ...this.features } });
    console.log(`⚙️ Función ${key}: ${enabled ? 'activada' : 'desactivada'}`);
  }

  // El filtro de reservas: al pausarlo se muestran todos los anuncios
  setFilterEnabled(enabled) {
    this.extensionEnabled = enabled;

    if (enabled) {
      this.applyFilter();
    } else {
      this.getSearchResults().forEach((product) => {
        const card = product.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || product;
        card.classList.remove('rs-hidden');
      });
    }

    this.saveSettings({ extensionEnabled: enabled });
    this.syncSettingsUi();
    this.updateStatusIndicators();
    setTimeout(() => this.updateFilterIndicator(), 100);
  }

  // ===== OCULTAR ANUNCIOS =====

  // Clave estable de un anuncio: la ruta de su enlace (/item/...)
  getItemKey(element) {
    let link = element.closest('a[href*="/item/"]');
    link ??= element.querySelector('a[href*="/item/"]');
    if (!link) return null;
    try {
      return new URL(link.href, globalThis.location.origin).pathname;
    } catch {
      return null;
    }
  }

  isAdHidden(card) {
    if (!this.features.hide) return false;
    const key = this.getItemKey(card);
    return key !== null && this.hiddenItems.has(key);
  }

  // Por qué una tarjeta no cuenta ni se muestra: { kind: 'manual' }, { kind: 'word', word } o null
  getAdHold(card) {
    if (this.isAdHidden(card)) return { kind: 'manual' };
    const match = this.findBlockedWord(card);
    return match === null ? null : { kind: 'word', ...match };
  }

  // Refleja en una tarjeta su estado: visible, oculta, filtrada por una palabra o mostrada un momento
  syncHiddenCard(card) {
    const hold = this.getAdHold(card);
    let mode = 'visible';
    if (hold?.kind === 'manual') mode = 'hidden';
    else if (hold) mode = this.peekTimers.has(card) ? 'peek' : 'filtered';

    card.classList.toggle('ml-ad-hidden', mode === 'hidden');
    card.classList.toggle('ml-ad-filtered', mode === 'filtered');
    card.classList.toggle('ml-ad-peek', mode === 'peek');

    const btn = card.querySelector(':scope > .wallapop-delete-ad-btn');
    const state = `${mode}:${hold?.word ?? ''}:${hold?.where ?? ''}`;
    if (btn && btn.dataset.state !== state) {
      btn.dataset.state = state;
      btn.dataset.mode = mode;
      this.renderHideButton(btn, card, mode, hold);
    }
    return hold !== null;
  }

  renderHideButton(btn, card, mode, hold) {
    const word = hold?.word;
    const inDescription = hold?.where === 'description';
    let label;
    let html;
    if (mode === 'hidden') {
      label = 'Mostrar anuncio';
      html = `<span class="ml-hide-circle">${ML_ICONS.eye}</span><span class="ml-hide-label"></span>`;
    } else if (mode === 'filtered') {
      label = `${inDescription ? 'La descripción contiene' : 'Contiene'} «${word}»: mostrar unos segundos`;
      html = `<span class="ml-hide-circle">${ML_ICONS.ban}</span><span class="ml-hide-label"></span>`;
    } else {
      const price = this.extractPrice(this.findCardPrice(card));
      label = `Ocultar este anuncio${price ? ` (${this.formatPrice(price)})` : ''}`;
      html = `<span class="ml-hide-circle">${ML_ICONS.close}</span>`;
    }

    btn.innerHTML = html;
    const text = btn.querySelector('.ml-hide-label');
    if (text) {
      text.textContent = mode === 'hidden'
        ? 'Anuncio oculto'
        : `${inDescription ? 'Descripción con' : 'Contiene'} «${word}»`;
    }
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(mode === 'hidden'));
  }

  // Muestra unos segundos un anuncio filtrado por palabras y lo vuelve a ocultar
  peekAd(card) {
    clearTimeout(this.peekTimers.get(card));
    this.peekTimers.set(card, setTimeout(() => {
      this.peekTimers.delete(card);
      if (card.isConnected) this.syncHiddenCard(card);
    }, this.PEEK_MS));
    this.syncHiddenCard(card);
  }

  // Botón en todas las tarjetas, estado de cada una y contador del panel
  refreshHiddenAds() {
    let hiddenOnPage = 0;
    let filteredOnPage = 0;
    this.getSearchResults().forEach((card) => {
      this.ensureHideButton(card);
      this.syncHiddenCard(card);
      const hold = this.getAdHold(card);
      if (hold?.kind === 'manual') hiddenOnPage++;
      else if (hold) filteredOnPage++;
    });

    const count = this.filterIndicator?.querySelector('#ml-hidden-count');
    if (count) count.textContent = `${hiddenOnPage} en esta página`;
    const filtered = this.filterIndicator?.querySelector('#ml-words-count');
    if (filtered) {
      filtered.textContent = this.blockedWords.length === 0
        ? 'Sin palabras'
        : `${filteredOnPage} ${filteredOnPage === 1 ? 'oculto' : 'ocultos'} en esta página`;
    }
    const showAll = this.filterIndicator?.querySelector('#ml-show-hidden');
    if (showAll) showAll.disabled = this.hiddenItems.size === 0;
  }

  // Oculta o vuelve a mostrar un anuncio al momento, sin diálogo
  toggleAdHidden(card) {
    const key = this.getItemKey(card);
    if (key === null) return;

    if (this.hiddenItems.has(key)) {
      this.hiddenItems.delete(key);
    } else {
      this.hiddenItems.add(key);
      // Al llegar al máximo se olvidan los más antiguos
      while (this.hiddenItems.size > this.HIDDEN_MAX) {
        this.hiddenItems.delete(this.hiddenItems.values().next().value);
      }
    }

    this.refreshHiddenAds();
    this.saveHiddenItems();
    this.recalculatePrices();
  }

  saveHiddenItems() {
    const warn = (error) => console.warn('⚠️ No se pudieron guardar los ocultos:', error.message);
    try {
      chrome.storage.local.set({ hiddenItems: [...this.hiddenItems] }).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  // Vuelve a mostrar todos los anuncios ocultados, también los de otras búsquedas
  async showAllHiddenAds() {
    const total = this.hiddenItems.size;
    if (total === 0) return;

    const confirmed = await this.confirmDialog({
      title: '¿Mostrar todos los ocultos?',
      message: total === 1
        ? 'Volverá a verse 1 anuncio.'
        : `Volverán a verse ${total} anuncios, también los de otras búsquedas.`,
      confirmLabel: 'Mostrar'
    });
    if (!confirmed) return;

    this.hiddenItems.clear();
    this.refreshHiddenAds();
    this.saveHiddenItems();
    this.recalculatePrices();
  }

  // ===== PALABRAS EXCLUIDAS =====

  // Sin mayúsculas ni acentos, para que "Eléctrica" y "electrica" coincidan
  normalizeText(text) {
    return String(text).normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim().replaceAll(/\s+/g, ' ');
  }

  // Fija la lista y prepara un comparador por palabra: coincide al principio de una palabra
  // ("funda" encuentra "fundas", pero "tv" no encuentra "estuviera")
  setBlockedWords(words) {
    const seen = new Set();
    this.blockedWords = [];
    for (const word of words) {
      if (typeof word !== 'string') continue;
      const clean = word.trim().replaceAll(/\s+/g, ' ').slice(0, this.WORD_MAX_LENGTH);
      const key = this.normalizeText(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      this.blockedWords.push(clean);
      if (this.blockedWords.length >= this.WORDS_MAX) break;
    }

    this.wordMatchers = this.blockedWords.map((word) => {
      const pattern = this.normalizeText(word).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll(' ', String.raw`\s+`);
      return { word, regex: new RegExp(String.raw`(?<![\p{L}\p{N}])${pattern}`, 'u') };
    });
  }

  // Título del anuncio
  getCardTitle(card) {
    const title = card.querySelector('[class*="ItemCard__title"], h3');
    if (title?.textContent) return title.textContent;
    return card.querySelector('img')?.alt ?? card.querySelector('a[aria-label]')?.getAttribute('aria-label') ?? '';
  }

  // Guarda las descripciones de la respuesta de la API (ya normalizadas) y revisa las tarjetas
  storeDescriptions(items) {
    if (!Array.isArray(items)) return;

    let added = 0;
    for (const item of items) {
      if (typeof item?.web_slug !== 'string' || typeof item.description !== 'string' || !item.description) continue;
      const key = `/item/${item.web_slug}`;
      this.itemDescriptions.delete(key);
      this.itemDescriptions.set(key, this.normalizeText(item.description.slice(0, this.DESCRIPTION_MAX_LENGTH)));
      added++;
      // Al llegar al máximo se olvidan las más antiguas
      if (this.itemDescriptions.size > this.DESCRIPTIONS_MAX) {
        this.itemDescriptions.delete(this.itemDescriptions.keys().next().value);
      }
    }

    if (added > 0 && this.features.descriptions && this.wordMatchers.length > 0) {
      this.refreshHiddenAds();
      this.recalculatePrices();
    }
  }

  // Primera palabra excluida que contiene la tarjeta: { word, where: 'title' | 'description' } o null
  findBlockedWord(card) {
    if (!this.features.keywords || this.wordMatchers.length === 0) return null;

    if (this.features.titles) {
      const title = this.normalizeText(this.getCardTitle(card));
      const inTitle = title && this.wordMatchers.find(({ regex }) => regex.test(title));
      if (inTitle) return { word: inTitle.word, where: 'title' };
    }

    if (!this.features.descriptions) return null;
    const key = this.getItemKey(card);
    const description = key === null ? undefined : this.itemDescriptions.get(key);
    const inDescription = description && this.wordMatchers.find(({ regex }) => regex.test(description));
    return inDescription ? { word: inDescription.word, where: 'description' } : null;
  }

  addBlockedWord(text) {
    const before = this.blockedWords.length;
    this.setBlockedWords([...this.blockedWords, text]);
    const added = this.blockedWords.length > before;
    if (added) this.afterWordsChange();
    return added;
  }

  removeBlockedWord(word) {
    this.setBlockedWords(this.blockedWords.filter((item) => item !== word));
    this.afterWordsChange();
  }

  afterWordsChange() {
    this.peekTimers.forEach((timer) => clearTimeout(timer));
    this.peekTimers.clear();
    this.renderWordList();
    this.refreshHiddenAds();
    this.recalculatePrices();
    this.saveSettings({ blockedWords: [...this.blockedWords] });
  }

  // Lista de palabras del panel, una etiqueta con su botón de quitar
  renderWordList() {
    const list = this.filterIndicator?.querySelector('#ml-words-list');
    if (!list) return;

    list.replaceChildren(...this.blockedWords.map((word) => {
      const item = document.createElement('li');
      item.className = 'ml-word';
      const text = document.createElement('span');
      text.textContent = word;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ml-word__remove';
      remove.setAttribute('aria-label', `Quitar «${word}»`);
      remove.innerHTML = ML_ICONS.close;
      remove.addEventListener('click', () => this.removeBlockedWord(word));
      item.append(text, remove);
      return item;
    }));
  }

  // Media y rango con los anuncios visibles (sin los ocultados ni los bloqueados)
  recalculatePrices() {
    if (!this.priceAnalysis.isComplete) return;

    const prices = this.findPriceElements()
      .map((element) => this.extractPrice(element))
      .filter((price) => price && price <= this.PRICE_MAX);
    this.priceAnalysis.allPrices = prices;

    if (prices.length > 0) {
      this.priceAnalysis.averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      this.showAveragePriceDisplay();
      this.updateAllPriceIndicators();
    } else {
      this.priceAnalysis.averagePrice = 0;
      document.getElementById('wallapop-average-price-display')?.remove();
      this.updatePriceSummary();
    }
  }

  // Pinta la diferencia de un precio respecto a la media
  renderPriceIndicator(indicator, price) {
    const average = this.priceAnalysis.averagePrice;
    const diff = Math.round(price - average);

    indicator.classList.toggle('ml-above', diff > 0);
    indicator.classList.toggle('ml-below', diff < 0);
    indicator.textContent = this.formatDiff(diff);
    indicator.title = `Comparado con la media de ${this.formatPrice(average)}`;
  }

  // Diferencia con la media: "+75 €", "−125 €" o "= media"
  formatDiff(diff) {
    if (diff === 0) return '= media';
    const sign = diff > 0 ? '+' : '−';
    return `${sign}${Math.abs(diff).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
  }

  formatPrice(value) {
    return `${Math.round(value).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
  }

  // Analizar precios de la página
  analyzePagePrices() {
    console.log('💰 === INICIANDO ANÁLISIS DE PRECIOS ===');
    
    // Permitir reanálisis si hay nuevos productos (no bloquear completamente)
    const currentPriceElements = this.findPriceElements();
    const currentPriceCount = currentPriceElements.length;
    
    // Si cambia el número de precios, re-analiza siempre
    if (this.priceAnalysis.isComplete && this.priceAnalysis.allPrices.length > 0 && 
        currentPriceCount === this.priceAnalysis.allPrices.length) {
      console.log('💰 Análisis de precios ya completado y mismo número de productos, saltando...');
      return;
    }
    
    this.priceAnalysis.attempts++;
    console.log(`💰 Iniciando análisis de precios (intento ${this.priceAnalysis.attempts}/${this.priceAnalysis.maxAttempts})...`);
    
    const priceElements = this.findPriceElements();
    console.log(`💰 Elementos de precio encontrados: ${priceElements.length}`);
    
    const prices = [];
    
    priceElements.forEach((element, index) => {
      const price = this.extractPrice(element);
      if (price) {
        prices.push(price);
        console.log(`Precio ${index + 1}: ${price}€`);
      }
    });
    
    if (prices.length > 0) {
      this.priceAnalysis.averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      this.priceAnalysis.allPrices = prices;
      this.priceAnalysis.isComplete = true;
      this.priceAnalysis.attempts = 0;
      
      console.log(`📊 Análisis completado: ${prices.length} precios, promedio: ${this.priceAnalysis.averagePrice.toFixed(2)}€`);
      
      this.showAveragePriceDisplay();
      this.updateAllPriceIndicators();
      this.addPriceButtons();
      this.updateKpiStats();
    } else {
      console.log('❌ No se encontraron precios válidos');
      if (this.priceAnalysis.attempts < this.priceAnalysis.maxAttempts) {
        setTimeout(() => this.analyzePagePrices(), 3000);
      }
    }
  }

  // Mostrar precio promedio
  showAveragePriceDisplay() {
    let display = document.getElementById('wallapop-average-price-display');
    if (!display) {
      display = document.createElement('div');
      display.id = 'wallapop-average-price-display';
      display.className = 'ml-root';
      display.setAttribute('role', 'status');
      document.body.appendChild(display);
    }

    const count = this.priceAnalysis.allPrices.length;
    display.innerHTML = `
      <span class="ml-logo">${ML_ICONS.trend}</span>
      <div class="ml-avg__text">
        <span class="ml-avg__label">Precio medio</span>
        <span class="ml-avg__value">${this.formatPrice(this.priceAnalysis.averagePrice)} <span class="ml-avg__count">· ${count} ${count === 1 ? 'anuncio' : 'anuncios'}</span></span>
      </div>
    `;

    this.updatePriceSummary();
    console.log('✅ Precio promedio actualizado');
  }

  // Actualizar precio medio y rango en el panel lateral
  updatePriceSummary() {
    const prices = this.priceAnalysis.allPrices;
    const avgElement = document.getElementById('ml-avg-price');
    const rangeElement = document.getElementById('ml-price-range');

    if (avgElement) {
      avgElement.textContent = prices.length ? this.formatPrice(this.priceAnalysis.averagePrice) : '–';
    }
    if (rangeElement) {
      rangeElement.textContent = prices.length
        ? `${this.formatPrice(Math.min(...prices))} – ${this.formatPrice(Math.max(...prices))}`
        : '–';
    }
  }

  // Agregar indicadores de comparación de precios y botones de ocultar
  addPriceButtons() {
    let indicatorsAdded = 0;

    this.getSearchResults().forEach((card) => {
      this.ensureHideButton(card);

      const priceElement = this.findCardPrice(card);
      const price = this.extractPrice(priceElement);
      if (!price || price > this.PRICE_MAX) return;

      // Indicador: solo si ya hay media calculada
      if (this.priceAnalysis.allPrices.length > 0 && !card.querySelector('.wallapop-price-indicator')) {
        this.insertPriceIndicator(priceElement, price);
        indicatorsAdded++;
      }
    });

    console.log(`✅ ${indicatorsAdded} indicadores de precio agregados`);
  }

  // NOTA: Los botones de bloquear vendedor solo se crean con IDs reales de la API
  // a través de la función matchItemsWithHTML() - NO se generan IDs simulados

  // Actualizar todos los indicadores de precio
  updateAllPriceIndicators() {
    const existingIndicators = document.querySelectorAll('.wallapop-price-indicator');

    existingIndicators.forEach((indicator) => {
      // El precio se guarda en el propio indicador al crearlo
      const price = Number.parseFloat(indicator.dataset.price);
      if (!price || price <= 0 || price > this.PRICE_MAX) return;
      this.renderPriceIndicator(indicator, price);
    });

    console.log(`✅ ${existingIndicators.length} indicadores de precio actualizados`);
  }

  // Mostrar aviso flotante
  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'ml-root ml-toast';
    toast.setAttribute('role', 'status');

    const isProblem = type === 'error' || type === 'warning';
    const icon = document.createElement('span');
    icon.style.color = isProblem ? '#ff9f0a' : '#30d158';
    icon.innerHTML = isProblem ? ML_ICONS.alert : ML_ICONS.check;

    const text = document.createElement('span');
    text.textContent = message;

    toast.append(icon, text);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ml-show'));

    setTimeout(() => {
      toast.classList.remove('ml-show');
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // Diálogo de confirmación propio (sustituye a confirm())
  confirmDialog({ title, message, confirmLabel = 'Aceptar' }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ml-root ml-dialog-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'ml-dialog';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');

      const body = document.createElement('div');
      body.className = 'ml-dialog__body';
      const titleElement = document.createElement('span');
      titleElement.className = 'ml-dialog__title';
      titleElement.textContent = title;
      const messageElement = document.createElement('span');
      messageElement.className = 'ml-dialog__message';
      messageElement.textContent = message;
      body.append(titleElement, messageElement);
      dialog.setAttribute('aria-label', title);

      const actions = document.createElement('div');
      actions.className = 'ml-dialog__actions';
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'Cancelar';
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'ml-destructive';
      confirmButton.textContent = confirmLabel;
      actions.append(cancelButton, confirmButton);

      dialog.append(body, actions);
      backdrop.appendChild(dialog);

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
      };
      const close = (result) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('ml-show');
        setTimeout(() => backdrop.remove(), 180);
        resolve(result);
      };

      cancelButton.addEventListener('click', () => close(false));
      confirmButton.addEventListener('click', () => close(true));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('ml-show'));
      confirmButton.focus();
    });
  }

  setFilterMode(mode) {
    console.log(`🔄 Cambiando filtro de '${this.filterMode}' a '${mode}'`);
    this.filterMode = mode;
    this.applyFilter();
    
    // Guardar preferencia
    chrome.storage.local.set({ filterMode: mode });
    
    // Actualizar indicador
    this.updateFilterIndicator();
  }

  // ===== FUNCIONES DE CONFIGURACIÓN =====

  // Configurar interceptación de API
  setupApiInterception() {
    this.injectApiLogger();
    this.setupApiListener();
  }

  // Inyectar script de interceptación
  injectApiLogger() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() {
      console.log('✅ Script de interceptación cargado');
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Configurar análisis de precios
  setupPriceAnalysis() {
    // Análisis automático al cargar
    setTimeout(() => {
      console.log('🔍 Iniciando análisis automático de precios...');
      const priceElements = this.findPriceElements();
      console.log(`💰 Precios encontrados: ${priceElements.length}`);
      
      if (priceElements.length > 0) {
        this.analyzePagePrices();
      }
    }, 3000);
    
    // Observer para detectar nuevos productos - DESHABILITADO TEMPORALMENTE
    // this.setupProductObserver();
    
    // Configurar detección de scroll para nuevos productos
    this.setupScrollDetection();
  }

  // Configurar bloqueo de usuarios
  setupUserBlocking() {
    // Esta funcionalidad se activará cuando se intercepten datos de la API
    console.log('👥 Sistema de bloqueo de usuarios configurado');
  }

  // Observer para detectar nuevos productos
  setupProductObserver() {
    const productObserver = new MutationObserver((mutations) => {
      const realItems = document.querySelectorAll('div[class*="ItemCard"]:not([class*="skeleton"])');
      const skeletonItems = document.querySelectorAll('div[class*="ItemCard"][class*="skeleton"]');
      
      if (realItems.length > 0 && skeletonItems.length === 0) {
        console.log('🎯 Productos detectados por observer');
        
        // Análisis de precios si no está completo
        if (!this.priceAnalysis.isComplete || this.priceAnalysis.allPrices.length === 0) {
          setTimeout(() => this.analyzePagePrices(), 2000);
        }
      }
    });
    
    productObserver.observe(document.body, { 
      childList: true, 
      subtree: true 
    });
  }

  // Configurar detección de scroll para nuevos productos
  setupScrollDetection() {
    let scrollTimeout = null;
    let lastPriceCount = 0;
    let lastProductCount = 0;

    this.onScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      
      scrollTimeout = setTimeout(() => {
        // Verificar si hay nuevos elementos de precio
        const priceElements = this.findPriceElements();
        const currentPriceCount = priceElements.length;
        
        // Verificar si hay nuevos productos
        const productElements = this.getSearchResults();
        const currentProductCount = productElements.length;
        
        console.log(`📊 Scroll: ${currentPriceCount} precios, ${currentProductCount} productos (anterior: ${lastPriceCount} precios, ${lastProductCount} productos)`);
        
        // Si hay más elementos que antes, reanalizar solo los nuevos
        if (currentPriceCount > lastPriceCount || currentProductCount > lastProductCount) {
          console.log('🔄 Nuevos productos detectados durante scroll, agregando elementos solo a productos nuevos...');
          
          // NO resetear el análisis completo - solo agregar a productos nuevos
          // NO limpiar elementos existentes - preservar matching anterior
          
          // Reanalizar precios (solo agregará a productos sin elementos)
          setTimeout(() => {
            this.analyzePagePrices();
          }, 1000);
        }
        // Si no hemos analizado y hay elementos
        else if (priceElements.length > 0 && !this.priceAnalysis.isComplete) {
          console.log('💰 Análisis automático de precios por scroll...');
          setTimeout(() => {
            this.analyzePagePrices();
          }, 1000);
        }
        
        lastPriceCount = currentPriceCount;
        lastProductCount = currentProductCount;
      }, 1000); // Esperar 1 segundo después de parar de hacer scroll
    };
    window.addEventListener('scroll', this.onScroll);
  }

  // Limpiar análisis anterior (solo elementos duplicados, no los macheados)
  clearPreviousAnalysis() {
    console.log('🧹 Limpiando análisis anterior (preservando elementos macheados)...');
    
    // NO remover el display de precio promedio - se actualizará
    // NO remover indicadores de precio - se actualizarán
    // NO remover botones de eliminar - se actualizarán
    // NO remover contenedores de usuario - se actualizarán
    
    // Solo limpiar elementos duplicados si los hay
    const allIndicators = document.querySelectorAll('.wallapop-price-indicator');
    const allDeleteButtons = document.querySelectorAll('.wallapop-delete-ad-btn');
    const allUserContainers = document.querySelectorAll('.wallapop-user-id-container');
    
    console.log(`📊 Elementos actuales: ${allIndicators.length} indicadores, ${allDeleteButtons.length} botones, ${allUserContainers.length} contenedores`);
    console.log('✅ Preservando elementos macheados existentes');
  }

  // Configurar listener de API
  setupApiListener() {
    this.onWindowMessage = (event) => {
      // Solo aceptar mensajes de la propia página (inject.js): misma ventana y mismo origen
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== 'object') return;
      console.log('📨 Mensaje recibido:', event.data.type, event.data);
      
      if (event.data.type === 'WALLAPOP_USER_IDS') {
        // Solo autores únicos: los items se cuentan en WALLAPOP_ITEMS_MATCHING
        event.data.userIds.forEach(userId => this.userBlocking.uniqueAuthors.add(userId));
        this.updateKpiStats();
      }
      if (event.data.type === 'WALLAPOP_ITEMS_MATCHING') {
        console.log('🎯 Mensaje WALLAPOP_ITEMS_MATCHING recibido correctamente');
        // Almacenar los items para uso posterior
        window.wallapopStoredItems = event.data.items;
        console.log('💾 Items almacenados para matching:', event.data.items);

        // Guardar las descripciones para las palabras excluidas
        this.storeDescriptions(event.data.items);

        // Actualizar contadores
        this.kpiStats.totalItems += event.data.items.length;
        event.data.items.forEach(item => this.userBlocking.uniqueAuthors.add(item.user_id));
        this.updateKpiStats();

        // Intentar matching inmediatamente con sistema de reintentos
        console.log('🚀 Iniciando matching inmediato...');
        try {
          this.matchItemsWithHTML(event.data.items, 1, 3);
        } catch (error) {
          console.error('❌ Error en matchItemsWithHTML:', error);
        }
        
        // Analizar precios cuando el sniffer está activo
        if (!this.priceAnalysis.isComplete) {
          setTimeout(() => {
            console.log('💰 Analizando precios después de recibir items del sniffer...');
            this.analyzePagePrices();
          }, 4000); // Esperar 4 segundos para que todo esté renderizado
        }
        
        // Trigger adicional más agresivo para análisis de precios
        setTimeout(() => {
          if (!this.priceAnalysis.isComplete) {
            console.log('💰 Trigger adicional para análisis de precios...');
            this.analyzePagePrices();
          }
        }, 8000); // Esperar 8 segundos adicionales
      }
    };
    window.addEventListener('message', this.onWindowMessage);
  }

  // Matching de items con HTML usando URLs de imagen
  matchItemsWithHTML(items, attempt = 1, maxAttempts = 3) {
    console.log(`🔍 Haciendo matching de items con HTML por URL de imagen (intento ${attempt}/${maxAttempts})...`);
    console.log('📦 Items recibidos:', items);
    console.log('🔧 Función matchItemsWithHTML ejecutándose...');
    
    // Debug: Verificar cuántas imágenes hay en el DOM
    const allImages = document.querySelectorAll('img');
    console.log(`🖼️ Total de imágenes en el DOM: ${allImages.length}`);
    
    // Debug: Mostrar las primeras 5 URLs de imagen del DOM
    const domImageUrls = Array.from(allImages).slice(0, 5).map(img => img.src);
    console.log('🖼️ Primeras 5 URLs de imagen en el DOM:', domImageUrls);
    
    // Debug: Mostrar las primeras 5 URLs de imagen de la API
    const apiImageUrls = items.slice(0, 5).map(item => item.image_url);
    console.log('🖼️ Primeras 5 URLs de imagen de la API:', apiImageUrls);
    
    // Debug adicional: Verificar si hay elementos ItemCard en el DOM
    console.log(`🎯 Total de tarjetas en el DOM: ${this.getSearchResults().length}`);
    
    // Declarar variables fuera del setTimeout para evitar scope issues
    let currentMatches = 0;
    let itemsWithoutImageUrl = 0;
    let imagesNotFound = 0;
    let containersNotFound = 0;
    let titleElementsNotFound = 0;
    
    // Esperar un poco para que los elementos se carguen
    setTimeout(() => {
      
      items.forEach((item, index) => {
        console.log(`\n--- Procesando item ${index + 1}/${items.length} ---`);
        console.log(`📝 Título: ${item.title}`);
        console.log(`🆔 User ID: ${item.user_id}`);
        console.log(`🖼️ Image URL: ${item.image_url}`);
        
        // Solo procesar items que tengan URL de imagen
        if (!item.image_url) {
          console.log(`⚠️ Item sin URL de imagen: ${item.title}`);
          itemsWithoutImageUrl++;
          return;
        }
        
        console.log(`🔍 Buscando imagen: "${item.image_url}"`);
        
        // Buscar la imagen en el DOM por su src
        let imageElement = document.querySelector(`img[src="${item.image_url}"]`);
        
        // Debug adicional: Verificar si la imagen existe con diferentes variaciones
        if (!imageElement) {
          // Intentar buscar con variaciones de la URL
          const baseUrl = item.image_url.split('?')[0]; // Sin parámetros
          const imageElementBase = document.querySelector(`img[src="${baseUrl}"]`);
          const imageElementContains = document.querySelector(`img[src*="${baseUrl}"]`);
          
          console.log(`❌ Imagen no encontrada exacta: ${item.image_url}`);
          console.log(`🔍 Buscando variación base: ${baseUrl}`);
          console.log(`🔍 Imagen base encontrada: ${imageElementBase ? 'SÍ' : 'NO'}`);
          console.log(`🔍 Imagen contiene base: ${imageElementContains ? 'SÍ' : 'NO'}`);
          
          if (imageElementContains) {
            console.log(`✅ Usando imagen con variación: ${imageElementContains.src}`);
            imageElement = imageElementContains;
          }
        }
        
        if (imageElement) {
          console.log(`✅ Imagen encontrada para: ${item.title}`);

          // Tarjeta del anuncio (en la búsqueda, la imagen va en su propio enlace)
          const itemContainer = this.getCard(imageElement) ||
                              imageElement.closest('a[href*="/item/"]');

          if (itemContainer) {
            console.log(`✅ Contenedor encontrado:`, itemContainer.tagName, itemContainer.className);
            
            // Debug: Mostrar todos los elementos h3 dentro del contenedor
            const allH3s = itemContainer.querySelectorAll('h3');
            console.log(`🔍 H3s encontrados en el contenedor:`, allH3s.length);
            allH3s.forEach((h3, index) => {
              console.log(`   H3 ${index + 1}:`, h3.className, h3.textContent);
            });

            // Verificar si el usuario está bloqueado
            if (this.userBlocking.blockedUsers.has(item.user_id)) {
              console.log(`🚫 Usuario ${item.user_id} está bloqueado, saltando...`);
              return;
            }
            
                // Verificar si ya hemos agregado el user_id a este elemento
                if (!itemContainer.querySelector('.wallapop-user-id-display') && 
                    !itemContainer.querySelector('.wallapop-user-id-container')) {
              // Buscar el elemento de título específico de Wallapop
              const titleElement = itemContainer.querySelector('h3[class*="ItemCard__title"]') ||
                                 itemContainer.querySelector('h3[class*="item-card__title"]') ||
                                 itemContainer.querySelector('h1, h2, h3, h4, h5, h6') ||
                                 itemContainer.querySelector('[class*="title"]') ||
                                 itemContainer.querySelector('p') ||
                                 itemContainer.querySelector('span');

              if (titleElement) {
                console.log(`✅ Elemento de título encontrado:`, titleElement.tagName, titleElement.textContent);
                
                // Crear contenedor para el vendedor y el botón de bloquear
                const userIdContainer = document.createElement('div');
                userIdContainer.className = 'wallapop-user-id-container';
                userIdContainer.dataset.userId = item.user_id;

                // Chip con el ID del vendedor (click para copiar)
                const userIdElement = document.createElement('button');
                userIdElement.type = 'button';
                userIdElement.className = 'wallapop-user-id-display';
                userIdElement.title = `Copiar ID del vendedor: ${item.user_id}`;
                const renderUserId = (label) => {
                  userIdElement.innerHTML = ML_ICONS.user;
                  userIdElement.append(label);
                };
                renderUserId(item.user_id);

                // Botón para bloquear al vendedor
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'wallapop-delete-user-btn';
                deleteButton.textContent = 'Bloquear';
                deleteButton.title = `Ocultar todos los anuncios de ${item.user_id}`;

                userIdElement.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigator.clipboard.writeText(item.user_id).then(() => {
                    renderUserId('Copiado');
                    userIdElement.classList.add('ml-copied');
                    setTimeout(() => {
                      renderUserId(item.user_id);
                      userIdElement.classList.remove('ml-copied');
                    }, 1000);
                  }).catch(() => this.showNotification('No se pudo copiar el ID', 'warning'));
                });

                deleteButton.addEventListener('click', async (e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  const adCount = document.querySelectorAll(
                    `.wallapop-user-id-container[data-user-id="${CSS.escape(String(item.user_id))}"]`
                  ).length;
                  const confirmed = await this.confirmDialog({
                    title: `¿Bloquear a ${item.user_id}?`,
                    message: adCount === 1
                      ? 'Se ocultará su anuncio en esta página.'
                      : `Se ocultarán sus ${adCount} anuncios en esta página.`,
                    confirmLabel: 'Bloquear'
                  });

                  if (confirmed) {
                    this.hideAllUserAds(item.user_id);
                  }
                });

                userIdContainer.appendChild(userIdElement);
                userIdContainer.appendChild(deleteButton);

                // Insertar tras el título; si el título es un enlace propio (búsqueda), tras el enlace
                const titleLink = titleElement.closest('a');
                const anchor = titleLink && titleLink !== itemContainer && itemContainer.contains(titleLink)
                  ? titleLink
                  : titleElement;
                anchor.after(userIdContainer);
                
                console.log(`✅ User ID ${item.user_id} agregado para: ${item.title}`);
                currentMatches++;
              } else {
                console.log(`❌ No se encontró elemento de texto en el contenedor para: ${item.title}`);
                titleElementsNotFound++;
              }
            } else {
              console.log(`⚠️ User ID ya existe para: ${item.title}`);
            }
          } else {
            console.log(`❌ No se encontró contenedor para la imagen: ${item.title}`);
            containersNotFound++;
          }
        } else {
          console.log(`❌ No se encontró imagen en el DOM: ${item.image_url}`);
          imagesNotFound++;
        }
      });
      
      // Actualizar contador de matches
      this.kpiStats.matchedItems += currentMatches;
      this.updateKpiStats();
      
      // Verificar si encontramos suficientes matches
      const totalMatches = document.querySelectorAll('.wallapop-user-id-display').length;
      const expectedMatches = items.length;
      
      console.log(`\n📊 RESUMEN DEL MATCHING:`);
      console.log(`   - Items procesados: ${items.length}`);
      console.log(`   - Items sin URL de imagen: ${itemsWithoutImageUrl}`);
      console.log(`   - Imágenes no encontradas en DOM: ${imagesNotFound}`);
      console.log(`   - Contenedores no encontrados: ${containersNotFound}`);
      console.log(`   - Elementos de título no encontrados: ${titleElementsNotFound}`);
      console.log(`   - Matches exitosos: ${currentMatches}`);
      console.log(`   - Total matches acumulados: ${totalMatches}/${expectedMatches}`);
      
      // Si no encontramos suficientes matches y aún tenemos intentos, reintentar
      if (totalMatches < expectedMatches * 0.5 && attempt < maxAttempts) {
        console.log(`⚠️ Pocos matches encontrados, reintentando en 2 segundos...`);
        setTimeout(() => {
          this.matchItemsWithHTML(items, attempt + 1, maxAttempts);
        }, 2000);
      } else if (totalMatches > 0) {
        console.log(`✅ Matching exitoso: ${totalMatches} user_ids mostrados`);
        
        // Pinta cruces YA (independiente de la media)
        setTimeout(() => this.addPriceButtons(), 300);
        
        // Trigger automático para análisis de precios después del matching exitoso
        if (!this.priceAnalysis.isComplete) {
          setTimeout(() => {
            console.log('💰 Análisis automático después de matching exitoso...');
            this.analyzePagePrices();
          }, 2000);
        }
      } else {
        console.log(`❌ No se encontraron matches después de ${attempt} intentos`);
      }
    }, 3000); // Esperar 3 segundos para que se carguen los elementos
    
    console.log(`✅ Matching completado: ${currentMatches}/${items.length} elementos encontrados`);
  }

  // Ocultar todos los anuncios de un usuario
  // Eliminar completamente todos los anuncios de un usuario específico
  hideAllUserAds(userId) {
    console.log(`🗑️ Eliminando todos los anuncios del usuario: ${userId}`);
    this.userBlocking.blockedUsers.add(userId);

    let removedCount = 0;
    document.querySelectorAll('.wallapop-user-id-container').forEach((container) => {
      if (container.dataset.userId !== String(userId)) return;
      const card = this.getCard(container) || container.closest('a[href*="/item/"], article');
      if (!card) return;
      card.remove();
      removedCount++;
    });

    this.userBlocking.blockedAdsCount += removedCount;
    this.recalculatePrices();

    // Actualizar contador en la barra lateral
    this.updateKpiStats();
    
    // Mostrar notificación
    if (removedCount > 0) {
      this.showNotification(removedCount === 1 ? `1 anuncio de ${userId} ocultado` : `${removedCount} anuncios de ${userId} ocultados`, 'success');
    } else {
      this.showNotification(`No se encontraron anuncios de ${userId}`, 'warning');
    }
    
    console.log(`📊 Total de anuncios eliminados: ${removedCount}`);
  }

  // Actualizar estadísticas KPI
  updateKpiStats() {
    if (this.filterIndicator) {
      // "Productos encontrados" lo gestiona updateFilterIndicator() con el recuento del DOM
      // Agregar nuevas estadísticas si no existen
      this.addKpiStatsToSidebar();
    }
  }

  // Agregar estadísticas KPI al sidebar
  addKpiStatsToSidebar() {
    if (!this.filterIndicator) return;  
   
    
    
    // Los botones de control han sido eliminados
    
    // Actualizar valores
    this.updateKpiDisplay();
  }

  // Actualizar display de KPIs
  updateKpiDisplay() {
    const blocked = document.getElementById('ml-blocked');
    if (blocked) {
      const ads = this.userBlocking.blockedAdsCount;
      blocked.textContent = `${this.userBlocking.blockedUsers.size} · ${ads} ${ads === 1 ? 'anuncio' : 'anuncios'}`;
    }
  }

  // Reiniciar contadores
  resetCounters() {
    console.log('🔄 Reiniciando contadores...');
    
    this.kpiStats.totalItems = 0;
    this.kpiStats.matchedItems = 0;
    this.kpiStats.apiItems = [];
    this.userBlocking.uniqueAuthors.clear();
    this.userBlocking.blockedUsers.clear();
    this.userBlocking.blockedAdsCount = 0;
    this.priceAnalysis.allPrices = [];
    this.priceAnalysis.averagePrice = 0;
    this.priceAnalysis.isComplete = false;
    this.priceAnalysis.attempts = 0;
    
    this.clearPreviousAnalysis();
    this.updateKpiStats();
    this.updateKpiDisplay();
    this.showNotification('Contadores reiniciados');
  }



  addFilterIndicator() {
    // Remover panel existente (incluidos restos de instancias anteriores)
    if (this.filterIndicator) this.filterIndicator.remove();
    if (this.sidebarTab) this.sidebarTab.remove();
    document.querySelectorAll('#ml-sidebar, #ml-tab').forEach(el => el.remove());

    let version = '1.0.0';
    try { version = chrome.runtime.getManifest().version; } catch (e) {}

    this.filterIndicator = document.createElement('aside');
    this.filterIndicator.id = 'ml-sidebar';
    this.filterIndicator.className = 'ml-root';
    this.filterIndicator.setAttribute('aria-label', 'MarketLens');
    this.filterIndicator.innerHTML = `
      <div class="ml-header">
        <span class="ml-logo">${ML_ICONS.logo(22)}</span>
        <div class="ml-header__text">
          <span class="ml-title">MarketLens</span>
          <span class="ml-subtitle" id="sidebar-status">Cargando…</span>
        </div>
        <button type="button" class="ml-icon-btn" id="toggle-sidebar" aria-label="Cerrar panel">
          <span class="ml-icon-btn__circle">${ML_ICONS.close}</span>
        </button>
      </div>

      <div>
        <span class="ml-section-label">Mostrar</span>
        <div class="ml-segmented" role="group" aria-label="Filtro de anuncios">
          <button type="button" class="sidebar-filter-btn" data-mode="all" aria-pressed="false">Todos</button>
          <button type="button" class="sidebar-filter-btn" data-mode="available" aria-pressed="false">Disponibles</button>
          <button type="button" class="sidebar-filter-btn" data-mode="reserved" aria-pressed="false">Reservados</button>
        </div>
      </div>

      <div class="ml-metrics">
        <div class="ml-card ml-metric">
          <span class="ml-metric__label">Encontrados</span>
          <span class="ml-metric__value" id="sidebar-results-count">–</span>
        </div>
        <div class="ml-card ml-metric">
          <span class="ml-metric__label">Visibles</span>
          <span class="ml-metric__value" id="ml-visible-count">–</span>
        </div>
        <div class="ml-card ml-metric">
          <span class="ml-metric__label">Reservados</span>
          <span class="ml-metric__value" id="ml-reserved-count">–</span>
        </div>
      </div>

      <div class="ml-card ml-list">
        <div class="ml-list__row ml-row-prices">
          <span>Precio medio</span>
          <span class="ml-list__value ml-list__value--strong" id="ml-avg-price">–</span>
        </div>
        <div class="ml-list__row ml-row-prices">
          <span>Rango</span>
          <span class="ml-list__value" id="ml-price-range">–</span>
        </div>
        <div class="ml-list__row ml-row-blocking">
          <span>Vendedores bloqueados</span>
          <span class="ml-list__value" id="ml-blocked">0 · 0 anuncios</span>
        </div>
        <div class="ml-list__row ml-row-hide">
          <span>Ocultos</span>
          <span class="ml-list__value ml-list__actions">
            <span id="ml-hidden-count">0 en esta página</span>
            <button type="button" class="ml-text-btn" id="ml-show-hidden" disabled>Mostrar todos</button>
          </span>
        </div>
      </div>

      <section class="ml-card ml-words ml-section-keywords" aria-labelledby="ml-words-title">
        <div class="ml-words__header">
          <span class="ml-words__title" id="ml-words-title">Palabras excluidas</span>
          <span class="ml-words__count" id="ml-words-count">Sin palabras</span>
        </div>
        <form class="ml-words__form" id="ml-words-form">
          <input type="text" id="ml-words-input" class="ml-words__input" maxlength="${this.WORD_MAX_LENGTH}"
                 placeholder="Palabra o frase" aria-label="Palabra o frase excluida" autocomplete="off">
          <button type="submit" class="ml-words__add">Añadir</button>
        </form>
        <ul class="ml-words__list" id="ml-words-list" aria-label="Palabras excluidas"></ul>
      </section>

      <details class="ml-card ml-settings" id="ml-settings">
        <summary class="ml-settings__summary">Configuración</summary>
        <div class="ml-settings__body">
          ${ML_FEATURES.map((feature) => `
          <div class="ml-toggle-row">
            <div class="ml-toggle-row__text">
              <span class="ml-toggle-row__title">${feature.title}</span>
              <span class="ml-subtitle">${feature.description}</span>
            </div>
            <label class="ml-switch">
              <input type="checkbox" data-feature="${feature.key}"${feature.key === 'filter' ? ' id="extension-toggle"' : ''} aria-label="${feature.title}">
              <span class="ml-switch__track"></span>
            </label>
          </div>`).join('')}
        </div>
      </details>

      <div class="ml-spacer"></div>

      <div class="ml-footer">
        <a class="ml-link" id="github-guide-link" href="https://github.com/dierodfer/MarketLens#readme" target="_blank" rel="noopener">
          ${ML_ICONS.book}<span>Guía de uso</span>
        </a>
        <a class="ml-link" href="https://buymeacoffee.com/martingodeg" target="_blank" rel="noopener">
          ${ML_ICONS.coffee}<span>Invítame a un café</span>
        </a>
        <span class="ml-version">Versión ${version}</span>
      </div>
    `;
    document.body.appendChild(this.filterIndicator);

    // Pestaña para abrir el panel
    this.sidebarTab = document.createElement('button');
    this.sidebarTab.type = 'button';
    this.sidebarTab.id = 'ml-tab';
    this.sidebarTab.className = 'ml-root';
    this.sidebarTab.setAttribute('aria-label', 'Abrir MarketLens');
    this.sidebarTab.innerHTML = `
      <span class="ml-logo">${ML_ICONS.logo(18)}</span>
      <span class="ml-status-dot" id="ml-tab-dot"></span>
    `;
    document.body.appendChild(this.sidebarTab);

    this.setupSidebarEvents();
    this.syncSettingsUi();
    this.updatePriceSummary();
    this.updateKpiDisplay();

    // Actualizar estado cada 2 segundos
    this.sidebarInterval = setInterval(() => {
      if (this.isInitialized) {
        // Verificar validez del contexto periódicamente
        this.checkContextValidity();
        this.updateFilterIndicator();
      }
    }, 2000);
  }

  getModeText(mode) {
    const modeTexts = {
      'all': 'Todos',
      'available': 'Disponibles',
      'reserved': 'Reservados'
    };
    return modeTexts[mode] || mode;
  }

  updateFilterIndicator(visibleCount = null, totalCount = null) {
    if (!this.filterIndicator) return;

    const currentResults = this.getSearchResults();
    let reservedCount = 0;
    let visibleNow = 0;

    currentResults.forEach(product => {
      if (this.isItemReserved(product)) reservedCount++;
      const card = product.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || product;
      if (!card.classList.contains('rs-hidden')) visibleNow++;
    });

    if (totalCount === null) totalCount = currentResults.length;
    if (visibleCount === null) visibleCount = visibleNow;

    const setText = (id, value) => {
      const element = this.filterIndicator.querySelector(id);
      if (element) element.textContent = `${value}`;
    };
    setText('#sidebar-results-count', totalCount);
    setText('#ml-visible-count', visibleCount);
    setText('#ml-reserved-count', reservedCount);

    if (!this.extensionEnabled) {
      setText('#sidebar-status', 'Wallapop · En pausa');
    } else if (this.isInitialized) {
      setText('#sidebar-status', `Wallapop · ${visibleCount} de ${totalCount} visibles`);
    } else {
      setText('#sidebar-status', 'Cargando…');
    }

    // Marcar el segmento activo
    this.filterIndicator.querySelectorAll('.sidebar-filter-btn').forEach(button => {
      const isActive = button.dataset.mode === this.filterMode;
      button.classList.toggle('ml-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    this.updateStatusIndicators();
    this.refreshHiddenAds();
  }

  // Punto de estado de la pestaña: verde activo, gris en pausa
  updateStatusIndicators() {
    const dot = this.sidebarTab?.querySelector('#ml-tab-dot');
    if (dot) dot.classList.toggle('ml-on', this.extensionEnabled !== false);
  }

  setupSidebarEvents() {
    if (!this.filterIndicator) return;

    const toggleBtn = this.filterIndicator.querySelector('#toggle-sidebar');

    const setOpen = (open, moveFocus = false) => {
      this.filterIndicator.classList.toggle('ml-open', open);
      this.filterIndicator.inert = !open;
      if (this.sidebarTab) this.sidebarTab.classList.toggle('ml-hidden', open);
      if (moveFocus) (open ? toggleBtn : this.sidebarTab)?.focus();
      console.log(open ? '📂 Panel abierto' : '📁 Panel cerrado');
    };
    setOpen(false);

    if (toggleBtn) toggleBtn.addEventListener('click', () => setOpen(false, true));
    if (this.sidebarTab) this.sidebarTab.addEventListener('click', () => setOpen(true, true));

    // Añadir palabras excluidas
    const wordsForm = this.filterIndicator.querySelector('#ml-words-form');
    wordsForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = wordsForm.querySelector('#ml-words-input');
      const text = input.value.trim();
      if (!text) return;
      if (this.addBlockedWord(text)) {
        input.value = '';
      } else {
        this.showNotification('Esa palabra ya está en la lista', 'warning');
      }
    });
    this.renderWordList();

    // Volver a mostrar todos los anuncios ocultados
    this.filterIndicator.querySelector('#ml-show-hidden')?.addEventListener('click', () => {
      this.showAllHiddenAds().catch((error) => console.warn('⚠️ Error mostrando ocultos:', error.message));
    });

    // Interruptores de la configuración (uno por función)
    const extensionToggle = this.filterIndicator.querySelector('#extension-toggle');
    this.filterIndicator.querySelectorAll('input[data-feature]').forEach((input) => {
      input.addEventListener('change', () => this.setFeatureEnabled(input.dataset.feature, input.checked));
    });

    // Control segmentado de filtro
    this.filterIndicator.querySelectorAll('.sidebar-filter-btn').forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;

        // Elegir un filtro reactiva el filtrado si estaba en pausa
        if (extensionToggle && !extensionToggle.checked) {
          extensionToggle.checked = true;
          extensionToggle.dispatchEvent(new Event('change'));
        }

        this.setFilterMode(mode);
        console.log(`🎯 Filtro cambiado a: ${mode}`);
      });
    });

    console.log('🎛️ Eventos del panel configurados');
  }

  setupMessageListener() {
    try {
      // Escuchar mensajes del popup y responder siempre
      this.onRuntimeMessage = (request, sender, sendResponse) => {
        console.log('📨 Mensaje recibido en content script:', request);
        console.log('📨 Sender:', sender);
        
        try {
          if (request.action === 'setFilter') {
            console.log(`🔄 Aplicando filtro: ${request.mode}`);
            this.setFilterMode(request.mode);
            sendResponse({ success: true, mode: this.filterMode });
          } else if (request.action === 'getStatus') {
            const results = this.getSearchResults();
            const status = { 
              success: true, 
              filterMode: this.filterMode,
              totalResults: results.length,
              isInitialized: this.isInitialized
            };
            console.log('📤 Enviando estado:', status);
            sendResponse(status);
          } else {
            console.log('⚠️ Acción no reconocida:', request.action);
            sendResponse({ success: false, error: 'Acción no reconocida' });
          }
        } catch (error) {
          console.error('❌ Error procesando mensaje:', error);
          sendResponse({ success: false, error: error.message });
        }
        
        // IMPORTANTE: Siempre devolver true para mantener el canal abierto
        return true;
      };
      chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
      
      console.log('📡 Message listener configurado');
      
      // Enviar señal de que el content script está listo
      this.safeSendMessage({ action: 'contentScriptReady' }, (response) => {
        if (response) {
          console.log('📡 Content script listo y confirmado');
        } else {
          console.log('📡 Content script listo (sin respuesta del background)');
        }
      });
    } catch (error) {
      console.warn('⚠️ Error configurando message listener:', error);
    }
  }

  debugResults() {
    console.log('🔍 ===== DEBUG WALLAPOP FILTER =====');
    
    const results = this.getSearchResults();
    console.log(`📊 Total de resultados encontrados: ${results.length}`);
    
    if (results.length === 0) {
      console.log('❌ No se encontraron resultados');
      return;
    }
    
    let reservedCount = 0;
    let availableCount = 0;
    
    results.forEach((item, index) => {
      const isReserved = this.isItemReserved(item);
      if (isReserved) reservedCount++;
      else availableCount++;
      
      if (index < 5) {
        console.log(`📦 Producto ${index + 1}:`, {
          reserved: isReserved,
          url: item.href,
          title: item.querySelector('h3')?.textContent || 'Sin título'
        });
      }
    });
    
    console.log(`📊 Resumen:`);
    console.log(`  - Disponibles: ${availableCount}`);
    console.log(`  - Reservados: ${reservedCount}`);
    console.log(`  - Filtro actual: ${this.filterMode}`);
    
    return {
      total: results.length,
      reserved: reservedCount,
      available: availableCount,
      filterMode: this.filterMode
    };
  }
}

// Inicializar la extensión
let wallapopFilter;

function initializeFilter() {
  if (wallapopFilter) {
    console.log('🔄 Reinicializando filtro...');
    // Limpiar instancia anterior
    wallapopFilter.destroy();
  }
  
  wallapopFilter = new WallapopFilter();
  
  // Exponer para debugging
  window.wallapopFilter = wallapopFilter;
}

// Inicializar según el estado del documento
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFilter);
} else {
  initializeFilter();
}

// Reinicializar en navegación SPA con debounce y guards
let spaNavigationTimeout = null;
window.addEventListener('popstate', () => {
  // Limpiar timeout anterior
  if (spaNavigationTimeout) {
    clearTimeout(spaNavigationTimeout);
  }
  
  // Marcar contexto como inválido durante navegación
  if (window.wallapopFilter) {
    window.wallapopFilter.contextInvalidated = true;
  }
  
  // Reinicializar con debounce
  spaNavigationTimeout = setTimeout(() => {
    if (window.wallapopFilter) {
      // Limpiar instancia anterior
      window.wallapopFilter.destroy?.();
    }
    initializeFilter();
  }, 500);
});

// Funcionalidad de debug (solo para desarrollo)
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.shiftKey && e.key === 'D' && wallapopFilter) {
    e.preventDefault();
    wallapopFilter.debugResults();
    console.log('🔍 Debug activado');
  }
});

  // Funciones de debug globales
setTimeout(() => {
  window.testReservedFilter = function() {
    console.log('🧪 TEST MANUAL DE FILTRO RESERVADOS:');
    const products = document.querySelectorAll(ML_CARD_SELECTOR);
    const reserved = document.querySelectorAll('wallapop-badge[badge-type="reserved"]');
    console.log(`📦 Productos: ${products.length}`);
    console.log(`🔒 Reservados: ${reserved.length}`);
    
    let visibleCount = 0;
    products.forEach(product => {
      const isReserved = product.querySelector('wallapop-badge[badge-type="reserved"]');
      const card = product.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || product;
      
      if (isReserved) {
        card.classList.remove('rs-hidden');
        visibleCount++;
        console.log(`✅ Mostrando reservado: ${product.href}`);
      } else {
        card.classList.add('rs-hidden');
      }
    });
    
    console.log(`🎯 Filtro aplicado: ${visibleCount} productos visibles`);
    return { total: products.length, reserved: reserved.length, visible: visibleCount };
  };

  window.showAllProducts = function() {
    const products = document.querySelectorAll(ML_CARD_SELECTOR);
    products.forEach(product => {
      const card = product.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || product;
      card.classList.remove('rs-hidden');
    });
    console.log(`🎯 Mostrando todos los ${products.length} productos`);
  };

}, 1000);

console.log('✅ MarketLens cargado');
console.log('🎯 Usa el menú lateral para filtrar productos');
console.log('🧪 Test manual: testReservedFilter()');
console.log('🧪 Mostrar todos: showAllProducts()');
console.log('🔍 Debug: Alt+Shift+D');
