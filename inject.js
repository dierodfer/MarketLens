// Script que se inyecta en el contexto de la página para interceptar llamadas
(function() {
    'use strict';
    
    console.log('🔍 Wallapop API Sniffer inyectado');
    
    // Interceptar fetch
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0];
        
        // Solo interceptar llamadas de búsqueda principal (search?)
        // Para futuras implementaciones: agregar && !url.includes('components') si se quiere excluir components
        if (typeof url === 'string' && url.includes('api.wallapop.com/api/v3/search?') && !url.includes('searchalerts')) {
            console.log('🎯 Interceptando llamada a Wallapop API:', url);
            
            return sniffResponse(originalFetch.apply(this, args), url);
        }
        
        return originalFetch.apply(this, args);
    };
    
    // Devuelve la respuesta tal cual y lee una copia en segundo plano
    async function sniffResponse(responsePromise, url) {
        let response;
        try {
            response = await responsePromise;
        } catch (error) {
            console.log('❌ Error en la llamada:', error);
            throw error;
        }
        
        void readSearchBody(response.clone(), response, url);
        return response;
    }
    
    async function readSearchBody(clonedResponse, response, url) {
        try {
            const data = await clonedResponse.json();
            console.log('📦 Respuesta JSON de Wallapop API:');
            console.log('URL:', url);
            console.log('Status:', response.status);
            console.log('Headers:', Object.fromEntries(response.headers.entries()));
            console.log('Data:', data);
            console.log('---');
            
            // Extraer user_ids de la respuesta
            extractUserIds(data, url);
        } catch (err) {
            console.log('❌ Error al parsear JSON:', err);
        }
    }
    
    // Interceptar XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._url = url;
        this._method = method;
        return originalXHROpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(data) {
        // Solo interceptar llamadas de búsqueda principal (search?)
        // Para futuras implementaciones: agregar && !this._url.includes('components') si se quiere excluir components
        if (this._url?.includes('api.wallapop.com/api/v3/search?') && !this._url.includes('searchalerts')) {
            console.log('🎯 Interceptando XMLHttpRequest a Wallapop API:', this._url);
            
            const originalOnReadyStateChange = this.onreadystatechange;
            
            this.onreadystatechange = function() {
                if (this.readyState === 4 && this.status === 200) {
                        try {
                            const responseData = JSON.parse(this.responseText);
                            console.log('📦 Respuesta JSON de Wallapop API (XHR):');
                            console.log('URL:', this._url);
                            console.log('Method:', this._method);
                            console.log('Status:', this.status);
                            console.log('Data:', responseData);
                            console.log('---');
                            
                            // Extraer user_ids de la respuesta
                            extractUserIds(responseData, this._url);
                        } catch (err) {
                            console.log('❌ Error al parsear JSON (XHR):', err);
                            console.log('Raw response:', this.responseText);
                        }
                }
                
                if (originalOnReadyStateChange) {
                    originalOnReadyStateChange.apply(this, arguments);
                }
            };
        }
        
        return originalXHRSend.apply(this, arguments);
    };
    
    // Función para extraer user_ids de la respuesta
    function extractUserIds(data, url) {
        try {
            const userIds = new Set();
            
            // Buscar user_ids en diferentes estructuras de datos
            if (data?.data) {
                // Estructura: data.section.payload.items
                if (data.data.section?.payload?.items) {
                    data.data.section.payload.items.forEach(item => {
                        if (item.user_id) {
                            userIds.add(item.user_id);
                        }
                    });
                }
                
                // Estructura: data.search_objects
                if (data.data.search_objects) {
                    data.data.search_objects.forEach(item => {
                        if (item.user_id) {
                            userIds.add(item.user_id);
                        }
                    });
                }
                
                // Estructura: data.items (fallback)
                if (data.data.items) {
                    data.data.items.forEach(item => {
                        if (item.user_id) {
                            userIds.add(item.user_id);
                        }
                    });
                }
            }
            
            // Si encontramos user_ids, enviarlos al content script
            if (userIds.size > 0) {
                const userIdsArray = Array.from(userIds);
                console.log('👥 User IDs encontrados:', userIdsArray);
                
                // Enviar mensaje al content script
                window.postMessage({
                    type: 'WALLAPOP_USER_IDS',
                    userIds: userIdsArray,
                    url: url,
                    count: userIdsArray.length
                }, '*');
            }
            
            // Extraer también los items completos para hacer matching con el HTML
            const items = [];
            if (data?.data) {
                console.log('🔍 Estructura de datos encontrada:', Object.keys(data.data));
                
                // Estructura: data.section.payload.items
                if (data.data.section?.payload?.items) {
                    console.log(`📦 Procesando ${data.data.section.payload.items.length} items de data.section.payload.items`);
                    data.data.section.payload.items.forEach((item, index) => {
                        if (item.user_id && item.title) {
                            // Extraer URL de imagen medium si existe
                            const imageUrl = item.images?.[0]?.urls?.medium ?? null;
                            
                            console.log(`📝 Item ${index + 1}: ${item.title} | User ID: ${item.user_id} | Image URL: ${imageUrl}`);
                            
                            items.push({
                                user_id: item.user_id,
                                title: item.title,
                                id: item.id,
                                image_url: imageUrl
                            });
                        }
                    });
                }
                
                // Estructura: data.search_objects
                if (data.data.search_objects) {
                    console.log(`📦 Procesando ${data.data.search_objects.length} items de data.search_objects`);
                    data.data.search_objects.forEach((item, index) => {
                        if (item.user_id && item.title) {
                            // Extraer URL de imagen medium si existe
                            const imageUrl = item.images?.[0]?.urls?.medium ?? null;
                            
                            console.log(`📝 Item ${index + 1}: ${item.title} | User ID: ${item.user_id} | Image URL: ${imageUrl}`);
                            
                            items.push({
                                user_id: item.user_id,
                                title: item.title,
                                id: item.id,
                                image_url: imageUrl
                            });
                        }
                    });
                }
            }
            
            // Enviar los items para hacer matching con el HTML
            if (items.length > 0) {
                console.log('📋 Items para matching:', items);
                window.postMessage({
                    type: 'WALLAPOP_ITEMS_MATCHING',
                    items: items,
                    url: url
                }, '*');
            }
        } catch (error) {
            console.log('❌ Error extrayendo user_ids:', error);
        }
    }
    
    console.log('✅ Sniffer inyectado correctamente');
})();

