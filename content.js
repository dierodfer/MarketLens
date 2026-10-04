// MarketLens - Content Script
// Filtra, analiza precios y bloquea vendedores en los resultados de Wallapop

// Iconos de línea (SVG inline, heredan el color del texto)
const ML_SVG = (size, body, extra = '') =>
  `<svg class="ml-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const ML_ICONS = {
  logo: (size = 22) => ML_SVG(size, '<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path><path d="M7.5 12.5l2-2 1.8 1.5 2.4-3"></path>'),
  close: ML_SVG(12, '<path d="M5 5l14 14M19 5L5 19"></path>', ' stroke-width="2.6"'),
  trend: ML_SVG(16, '<path d="M3 17l6-6 4 4 8-8"></path><path d="M15 7h6v6"></path>'),
  book: ML_SVG(18, '<path d="M3 4.5h6a3 3 0 013 3V20a2 2 0 00-2-2H3z"></path><path d="M21 4.5h-6a3 3 0 00-3 3V20a2 2 0 012-2h7z"></path>', ' stroke-width="1.7"'),
  coffee: ML_SVG(18, '<path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"></path><path d="M16 10h1.5a2.5 2.5 0 010 5H16"></path><path d="M8 3.5v2M12 3.5v2"></path>', ' stroke-width="1.7"'),
  user: ML_SVG(11, '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"></path>', ' stroke-width="2.4"'),
  check: ML_SVG(14, '<path d="M5 12.5l4.5 4.5L19 7"></path>', ' stroke-width="2.6"'),
  alert: ML_SVG(14, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5M12 16.5v.5"></path>', ' stroke-width="2.4"')
};

class WallapopFilter {
  constructor() {
    this.filterMode = 'all'; // 'all', 'reserved', 'available'
    this.extensionEnabled = true;
    this.isInitialized = false;
    this.observer = null;
    this.filterIndicator = null;
    
    // Constante para límite de precio máximo
    this.PRICE_MAX = 100000;
    
    // Flag para detectar si el contexto está invalidado
    this.contextInvalidated = false;
    
    // Nuevas funcionalidades del injector
    this.priceAnalysis = {
      allPrices: [],
      averagePrice: 0,
      isComplete: false,
      attempts: 0,
      maxAttempts: 5
    };
    
    this.userBlocking = {
      blockedUsers: new Set(),
      blockedAdsCount: 0,
      uniqueAuthors: new Set()
    };
    
    this.kpiStats = {
      totalItems: 0,
      matchedItems: 0,
      apiItems: []
    };
    
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
      callback && callback(null);
    }
  }

  // Detectar si el contexto está invalidado
  checkContextValidity() {
    if (this.contextInvalidated) return false;
    
    // Verificar si chrome está disponible
    if (!chrome || !chrome.runtime) {
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
      console.warn('⚠️ Contexto invalidado detectado, activando modo fallback');
      this.contextInvalidated = true;
      return false;
    }
  }

  // Verificar si podemos usar Chrome APIs de forma segura
  canUseChromeAPIs() {
    // Verificaciones básicas
    if (!chrome || !chrome.runtime) return false;
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
      if (error.message && error.message.includes('Extension context invalidated')) {
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
    this.loadSettings();
    
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
      const result = await chrome.storage.local.get(['filterMode', 'extensionEnabled']);
      this.filterMode = result.filterMode || 'all';
      this.extensionEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : true;
      console.log(`📋 Configuración cargada - Filtro: ${this.filterMode}, Activa: ${this.extensionEnabled}`);
      
      // Actualizar toggle en el sidebar si existe
      setTimeout(() => {
        const toggle = document.querySelector('#extension-toggle');
        if (toggle) toggle.checked = this.extensionEnabled;
        this.updateStatusIndicators();
      }, 100);
    } catch (error) {
      console.log('⚠️ No se pudo cargar configuración, usando valores por defecto');
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

  getSearchResults() {
    // ✅ Usar el selector específico de Wallapop
    const specificSelector = '.item-card_ItemCard--vertical__CNrfk';
    let results = document.querySelectorAll(specificSelector);
    
    if (results.length > 0) {
      console.log(`✅ Usando selector específico: ${specificSelector} (${results.length} elementos)`);
      return results;
    }
    
    // Fallback
    const fallbackSelector = 'a[href*="/item/"]';
    results = document.querySelectorAll(fallbackSelector);
    
    if (results.length > 0) {
      console.log(`✅ Usando selector fallback: ${fallbackSelector} (${results.length} elementos)`);
    } else {
      console.log('❌ No se encontraron productos');
    }
    
    return results;
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
              const newProducts = node.matches && node.matches('.item-card_ItemCard--vertical__CNrfk') ? [node] : 
                                 node.querySelectorAll ? node.querySelectorAll('.item-card_ItemCard--vertical__CNrfk') : [];
              
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

    results.forEach((productLink, index) => {
      const isReserved = this.isItemReserved(productLink);
      let shouldShow = true;
      
      switch (this.filterMode) {
        case 'reserved':
          shouldShow = isReserved;
          break;
          
        case 'available':
          shouldShow = !isReserved;
          break;
          
        default: // 'all'
          shouldShow = true;
      }
      
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

  // Buscador de precios robusto con múltiples selectores
  findPriceElements(root = document) {
    // 1) selector "bueno" si existe
    const candidates = [
      'strong[class*="ItemCard__price"]',
      'strong[aria-label*="price" i]',
      '[data-testid*="price" i]',
      '[data-e2e*="price" i]',
      '[class*="__price" i]',
      '[class*="price" i]',
      '[class*="Price" i]'
    ];

    for (const sel of candidates) {
      const els = root.querySelectorAll(sel);
      if (els.length) {
        console.log(`💰 Encontrados ${els.length} elementos de precio con selector: ${sel}`);
        return Array.from(els);
      }
    }

    // 2) fallback por contenido "€" dentro de la card
    const all = Array.from(root.querySelectorAll('strong, span, div, p'));
    const withEuro = all.filter(el => el.textContent && el.textContent.includes('€'));
    if (withEuro.length) {
      console.log(`💰 Encontrados ${withEuro.length} elementos de precio por contenido "€"`);
      return withEuro;
    }

    console.log('⚠️ No se encontraron elementos de precio');
    return [];
  }

  // Extraer precio de un elemento
  extractPrice(priceElement) {
    if (!priceElement) return null;
    
    // Normalizar texto del precio para formato europeo
    const text = priceElement.textContent
      .replace(/\s|&nbsp;/g, '')  // Eliminar espacios y &nbsp;
      .replace(/\./g, '')         // Eliminar puntos (separadores de miles)
      .replace(',', '.');         // Convertir coma a punto decimal
    
    // Buscar patrón de número con decimales opcionales
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const price = parseFloat(match[1]);
      // Aumentar límite para vehículos y productos caros
      if (price && !isNaN(price) && price <= 100000) {
        return price;
      }
    }
    
    return null;
  }

  // Helper para crear botón de ocultar anuncio
  ensureDeleteButton(itemContainer, price) {
    // evita clipping y asegura stacking
    itemContainer.style.position = itemContainer.style.position || 'relative';
    itemContainer.style.overflow = 'visible';
    itemContainer.style.zIndex = '2';

    if (itemContainer.querySelector('.wallapop-delete-ad-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wallapop-delete-ad-btn';
    btn.title = `Ocultar este anuncio (${this.formatPrice(price)})`;
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = `<span class="ml-hide-circle">${ML_ICONS.close}</span>`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const confirmed = await this.confirmDialog({
        title: '¿Ocultar este anuncio?',
        message: `Se quitará de esta página (${this.formatPrice(price)}).`,
        confirmLabel: 'Ocultar'
      });
      if (confirmed) this.hideIndividualAd(itemContainer);
    });

    itemContainer.appendChild(btn);
    console.log(`✅ Botón de ocultar agregado para anuncio de ${price}€`);
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

  // Pinta la diferencia de un precio respecto a la media
  renderPriceIndicator(indicator, price) {
    const average = this.priceAnalysis.averagePrice;
    const diff = Math.round(price - average);

    indicator.classList.toggle('ml-above', diff > 0);
    indicator.classList.toggle('ml-below', diff < 0);
    indicator.textContent = diff === 0
      ? '= media'
      : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
    indicator.title = `Comparado con la media de ${this.formatPrice(average)}`;
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
        <span class="ml-avg__value">${this.formatPrice(this.priceAnalysis.averagePrice)} <span class="ml-avg__count">· ${count} anuncios</span></span>
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

  // Agregar indicadores de comparación de precios y botones de eliminar
  addPriceButtons() {
    console.log('🔍 Agregando indicadores de comparación de precios y botones de eliminar...');
    
    const priceElements = this.findPriceElements();
    
    let indicatorsAdded = 0;
    let deleteButtonsAdded = 0;
    
    priceElements.forEach((priceElement, index) => {
      // Buscar el contenedor del item
      const itemContainer = priceElement.closest('a[class*="ItemCard"]') || 
                          priceElement.closest('div[class*="ItemCard"]') ||
                          priceElement.closest('article') ||
                          priceElement.parentNode;
      
      const price = this.extractPrice(priceElement);
      
      if (price && price > 0 && price <= this.PRICE_MAX) {
        // 2) Botón de eliminar: SIEMPRE
        if (itemContainer && !itemContainer.querySelector('.wallapop-delete-ad-btn')) {
          this.ensureDeleteButton(itemContainer, price);
          deleteButtonsAdded++;
        }

        // 1) Indicador: solo si ya hay media calculada
        if (this.priceAnalysis.allPrices.length > 0 && !itemContainer.querySelector('.wallapop-price-indicator')) {
          this.insertPriceIndicator(priceElement, price);
          indicatorsAdded++;
        }
      }
    });
    
    console.log(`✅ ${indicatorsAdded} indicadores de precio y ${deleteButtonsAdded} botones de eliminar agregados`);
  }

  // NOTA: Los botones de eliminar autor solo se crean con IDs reales de la API
  // a través de la función matchItemsWithHTML() - NO se generan IDs simulados

  // Ocultar anuncio individual
  hideIndividualAd(itemContainer) {
    const priceElement = itemContainer.querySelector('strong[class*="ItemCard__price"], strong[aria-label="Item price"]');
    let removedPrice = null;
    
    if (priceElement) {
      removedPrice = this.extractPrice(priceElement);
    }
    
    itemContainer.remove();
    this.userBlocking.blockedAdsCount++;
    
    if (removedPrice && !isNaN(removedPrice)) {
      // Eliminar solo una ocurrencia del precio (no todas)
      const index = this.priceAnalysis.allPrices.indexOf(removedPrice);
      if (index > -1) {
        this.priceAnalysis.allPrices.splice(index, 1);
      }
      
      if (this.priceAnalysis.allPrices.length > 0) {
        this.priceAnalysis.averagePrice = this.priceAnalysis.allPrices.reduce((sum, price) => sum + price, 0) / this.priceAnalysis.allPrices.length;
        console.log(`📊 Nuevo precio promedio: ${this.priceAnalysis.averagePrice.toFixed(2)}€ (${this.priceAnalysis.allPrices.length} items restantes)`);
        
        this.updateAllPriceIndicators();
        this.showAveragePriceDisplay();
      } else {
        const averagePriceDisplay = document.getElementById('wallapop-average-price-display');
        if (averagePriceDisplay) {
          averagePriceDisplay.remove();
        }
        this.updatePriceSummary();
      }
    }
    
    this.updateKpiStats();
    this.showNotification(removedPrice ? `Anuncio de ${this.formatPrice(removedPrice)} ocultado` : 'Anuncio ocultado');
  }

  // Actualizar todos los indicadores de precio
  updateAllPriceIndicators() {
    const existingIndicators = document.querySelectorAll('.wallapop-price-indicator');

    existingIndicators.forEach((indicator) => {
      // El precio se guarda en el propio indicador al crearlo
      const price = parseFloat(indicator.dataset.price);
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
      const priceElements = document.querySelectorAll('strong[class*="ItemCard__price"]');
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
        const priceElements = document.querySelectorAll('strong[class*="ItemCard__price"]');
        const currentPriceCount = priceElements.length;
        
        // Verificar si hay nuevos productos
        const productElements = document.querySelectorAll('a[class*="ItemCard"], a[href*="/item/"]');
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
      // Solo aceptar mensajes de la propia página (inject.js)
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
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
    const itemCards = document.querySelectorAll('a[class*="ItemCard"], div[class*="ItemCard"]');
    console.log(`🎯 Total de ItemCards en el DOM: ${itemCards.length}`);
    
    // Debug adicional: Verificar si hay elementos de precio
    const priceElements = document.querySelectorAll('strong[class*="ItemCard__price"]');
    console.log(`💰 Total de elementos de precio en el DOM: ${priceElements.length}`);
    
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

          // Buscar el contenedor principal del anuncio (el <a> que contiene todo)
          const itemContainer = imageElement.closest('a[class*="ItemCard"]') ||
                              imageElement.closest('a[href*="/item/"]') ||
                              imageElement.closest('div[class*="ItemCard"]') ||
                              imageElement.closest('div[class*="item-card"]') ||
                              imageElement.closest('article') ||
                              imageElement.closest('div[class*="card"]') ||
                              imageElement.closest('div[class*="item"]');

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
                  });
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

                // Insertar después del elemento de texto
                titleElement.parentNode.insertBefore(userIdContainer, titleElement.nextSibling);
                
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
    console.log(`🗑️ Eliminando completamente todos los anuncios del usuario: ${userId}`);
    
    // Agregar usuario a la lista de bloqueados
    this.userBlocking.blockedUsers.add(userId);
    
    // Buscar todos los contenedores que tienen el user_id de este usuario
    const userAds = document.querySelectorAll(`.wallapop-user-id-container`);
    let removedCount = 0;
    let removedPrices = [];
    
    userAds.forEach(container => {
      if (container.dataset.userId === String(userId)) {
        // Encontrar el contenedor principal del anuncio
        const itemContainer = container.closest('a[class*="ItemCard"]') ||
                            container.closest('a[href*="/item/"]') ||
                            container.closest('div[class*="ItemCard"]') ||
                            container.closest('div[class*="item-card"]') ||
                            container.closest('article');
        
        if (itemContainer) {
          // Extraer el precio del anuncio antes de eliminarlo
          const priceElement = itemContainer.querySelector('strong[class*="ItemCard__price"]');
          if (priceElement) {
            const price = this.extractPrice(priceElement);
            if (price && price > 0 && price <= this.PRICE_MAX) {
              removedPrices.push(price);
            }
          }
          
          // Eliminar completamente el anuncio del DOM
          itemContainer.remove();
          removedCount++;
          
          console.log(`✅ Anuncio eliminado: ${itemContainer.querySelector('h3')?.textContent || 'Sin título'}`);
        }
      }
    });
    
    // Actualizar contador de anuncios bloqueados
    this.userBlocking.blockedAdsCount += removedCount;
    
    // Recalcular precio promedio si se eliminaron precios
    if (removedPrices.length > 0 && this.priceAnalysis.allPrices.length > 0) {
      console.log(`💰 Recalculando precio promedio después de eliminar ${removedPrices.length} precios...`);
      
      // Remover los precios eliminados de allPrices
      removedPrices.forEach(price => {
        const index = this.priceAnalysis.allPrices.indexOf(price);
        if (index > -1) {
          this.priceAnalysis.allPrices.splice(index, 1);
        }
      });
      
      // Recalcular promedio
      if (this.priceAnalysis.allPrices.length > 0) {
        this.priceAnalysis.averagePrice = this.priceAnalysis.allPrices.reduce((sum, price) => sum + price, 0) / this.priceAnalysis.allPrices.length;
        
        console.log(`📊 Nuevo precio promedio: ${this.priceAnalysis.averagePrice.toFixed(2)}€ (${this.priceAnalysis.allPrices.length} items restantes)`);
        
        // Actualizar el display del precio promedio
        this.showAveragePriceDisplay();
        
        // Recalcular y actualizar todos los indicadores de precio
        this.updateAllPriceIndicators();
      } else {
        console.log('⚠️ No quedan precios para calcular promedio');
        // Remover el display del precio promedio
        const averagePriceDisplay = document.querySelector('#wallapop-average-price-display');
        if (averagePriceDisplay) {
          averagePriceDisplay.remove();
        }
        this.updatePriceSummary();
      }
    }
    
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

      <div class="ml-card ml-toggle-row">
        <div class="ml-toggle-row__text">
          <span class="ml-toggle-row__title">Filtrado automático</span>
          <span class="ml-subtitle">Aplica el filtro al cargar anuncios</span>
        </div>
        <label class="ml-switch">
          <input type="checkbox" id="extension-toggle" checked aria-label="Filtrado automático">
          <span class="ml-switch__track"></span>
        </label>
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
        <div class="ml-list__row">
          <span>Precio medio</span>
          <span class="ml-list__value ml-list__value--strong" id="ml-avg-price">–</span>
        </div>
        <div class="ml-list__row">
          <span>Rango</span>
          <span class="ml-list__value" id="ml-price-range">–</span>
        </div>
        <div class="ml-list__row">
          <span>Vendedores bloqueados</span>
          <span class="ml-list__value" id="ml-blocked">0 · 0 anuncios</span>
        </div>
      </div>

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
  }

  // Punto de estado de la pestaña: verde activo, gris en pausa
  updateStatusIndicators() {
    const dot = this.sidebarTab && this.sidebarTab.querySelector('#ml-tab-dot');
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

    // Interruptor de filtrado automático
    const extensionToggle = this.filterIndicator.querySelector('#extension-toggle');
    if (extensionToggle) {
      extensionToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        this.extensionEnabled = isEnabled;

        if (isEnabled) {
          this.applyFilter();
          console.log('✅ Filtrado activado');
        } else {
          // Mostrar todos los productos
          this.getSearchResults().forEach(product => {
            const card = product.closest('article, li, [data-testid="item-card"], .ItemCard, .item-card, [class*="ItemCard"], [class*="Card"]') || product;
            card.classList.remove('rs-hidden');
          });
          console.log('⏸️ Filtrado en pausa - mostrando todos los productos');
        }

        // Guardar estado
        try { chrome.storage.local.set({ extensionEnabled: isEnabled }); } catch (err) {}

        this.updateStatusIndicators();
        setTimeout(() => this.updateFilterIndicator(), 100);
      });
    }

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
    const products = document.querySelectorAll('.item-card_ItemCard--vertical__CNrfk');
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
    const products = document.querySelectorAll('.item-card_ItemCard--vertical__CNrfk');
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
