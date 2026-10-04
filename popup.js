// MarketLens - Popup
class SimplePopup {
  init() {
    const version = document.getElementById('version');
    if (version) version.textContent = `Versión ${chrome.runtime.getManifest().version}`;

    this.refresh();
    this.setupStatusUpdater();
  }

  // loadCurrentStatus() captura sus propios errores; el catch cubre lo imprevisto
  refresh() {
    this.loadCurrentStatus().catch((error) => console.error('❌ Error:', error));
  }

  async loadCurrentStatus() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tab) {
        this.setConnection('No se encontró la pestaña activa', 'warn');
        return;
      }

      if (!tab.url?.includes('wallapop.com')) {
        this.setConnection('Abre una búsqueda en Wallapop', 'warn');
        return;
      }

      // Intentar obtener estado del content script
      const response = await this.sendMessageToContentScript(tab.id, { action: 'getStatus' });

      if (response?.success) {
        this.updateStatus(response);
        this.setConnection('Conectado a Wallapop', 'ok');
      } else {
        this.updateStatus({ totalResults: '–', isInitialized: false, filterMode: 'all' });
        this.setConnection('Recarga la página de Wallapop', 'warn');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      this.setConnection('Error de conexión', 'warn');
    }
  }

  sendMessageToContentScript(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  updateStatus(statusData) {
    const resultsElement = document.getElementById('results-count');
    if (resultsElement && statusData.totalResults !== undefined) {
      resultsElement.textContent = statusData.totalResults.toString();
    }

    const initElement = document.getElementById('initialization-status');
    if (initElement) {
      initElement.textContent = statusData.isInitialized ? 'Sí' : 'No';
    }

    const statusElement = document.getElementById('current-status');
    if (statusElement) {
      const modeTexts = {
        'all': 'Todos',
        'available': 'Disponibles',
        'reserved': 'Reservados'
      };
      statusElement.textContent = modeTexts[statusData.filterMode] || 'Todos';
    }
  }

  setConnection(message, type) {
    const banner = document.getElementById('connection');
    if (!banner) return;
    banner.textContent = message;
    banner.className = `banner ${type}`;
  }

  setupStatusUpdater() {
    setInterval(() => this.refresh(), 5000);
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  const popup = new SimplePopup();
  popup.init();
});
