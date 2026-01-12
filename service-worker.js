const CACHE_NAME = 'reservin-v1.0.1';
const DYNAMIC_CACHE = 'reservin-dynamic-v1.0.1';

// Assets yang akan di-cache saat install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Bootstrap CSS & JS
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  // Bootstrap Icons
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css',
  // Google Fonts - Poppins
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap'
];

// Assets yang perlu di-cache dengan strategi Network First
const NETWORK_FIRST = [
  '/index.html'
];

// Assets yang perlu di-cache dengan strategi Cache First
const CACHE_FIRST = [
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// =====================================================================
// INSTALL EVENT - Cache static assets
// =====================================================================
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing Service Worker...', event);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch(err => {
        console.error('[Service Worker] Cache installation failed:', err);
      })
  );
  
  // Force service worker to activate immediately
  self.skipWaiting();
});

// =====================================================================
// ACTIVATE EVENT - Clean up old caches
// =====================================================================
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating Service Worker...', event);
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Delete old versions of cache
            if (cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

// =====================================================================
// FETCH EVENT - Advanced caching strategies
// =====================================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other schemes
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Check if request has accept header
  const acceptHeader = request.headers.get('accept');
  if (!acceptHeader) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Handle different types of requests with different strategies
  
  // 1. HTML - Network First (always try to get fresh content)
  if (acceptHeader.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // 2. Images - Cache First (images don't change often)
  if (acceptHeader.includes('image')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // 3. CSS, JS, Fonts - Cache First
  if (
    request.url.includes('.css') ||
    request.url.includes('.js') ||
    request.url.includes('fonts.googleapis') ||
    request.url.includes('fonts.gstatic') ||
    request.url.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // 4. Default - Network First with cache fallback
  event.respondWith(networkFirst(request));
});

// =====================================================================
// CACHING STRATEGIES
// =====================================================================

/**
 * Network First Strategy
 * Try network first, fall back to cache if offline
 * Best for: HTML, API calls, dynamic content
 */
async function networkFirst(request) {
  try {
    // Try to fetch from network
    const networkResponse = await fetch(request);
    
    // If successful, cache the response
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // If network fails, try cache
    console.log('[Service Worker] Network failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If both fail and it's a navigation request, return offline page
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    
    // Otherwise return error
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Cache First Strategy
 * Try cache first, fall back to network
 * Best for: Images, CSS, JS, Fonts
 */
async function cacheFirst(request) {
  // Try cache first
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    console.log('[Service Worker] Found in cache:', request.url);
    return cachedResponse;
  }
  
  // If not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    
    // Cache the new response
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[Service Worker] Cache and network both failed:', error);
    
    // Return a fallback response
    return new Response('Resource not available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale While Revalidate Strategy
 * Return cached response immediately, update cache in background
 * Best for: Frequently updated content that can be slightly stale
 */
async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);
  
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.status === 200) {
        const cache = caches.open(DYNAMIC_CACHE);
        cache.then(c => c.put(request, response.clone()));
      }
      return response;
    })
    .catch(err => {
      console.error('[Service Worker] Network fetch failed:', err);
    });
  
  // Return cached version immediately, or wait for network
  return cachedResponse || networkFetch;
}

// =====================================================================
// BACKGROUND SYNC - Sync offline bookings when back online
// =====================================================================
self.addEventListener('sync', event => {
  console.log('[Service Worker] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-bookings') {
    event.waitUntil(syncOfflineBookings());
  }
});

async function syncOfflineBookings() {
  try {
    console.log('[Service Worker] Syncing offline bookings...');
    
    // Get offline bookings from IndexedDB or localStorage
    // This is a placeholder - implement actual sync logic
    const offlineBookings = await getOfflineBookings();
    
    if (offlineBookings && offlineBookings.length > 0) {
      // Send bookings to server
      for (const booking of offlineBookings) {
        await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(booking)
        });
      }
      
      // Clear offline bookings after successful sync
      await clearOfflineBookings();
      
      console.log('[Service Worker] Bookings synced successfully');
    }
  } catch (error) {
    console.error('[Service Worker] Sync failed:', error);
    throw error; // Retry sync
  }
}

async function getOfflineBookings() {
  // Placeholder - implement actual logic to get offline bookings
  return [];
}

async function clearOfflineBookings() {
  // Placeholder - implement actual logic to clear offline bookings
}

// =====================================================================
// PUSH NOTIFICATIONS - Handle push notifications
// =====================================================================
self.addEventListener('push', event => {
  console.log('[Service Worker] Push notification received:', event);
  
  let notificationData = {
    title: 'Reservin',
    body: 'Anda memiliki notifikasi baru',
    icon: '/logo/logo6.png',
    badge: '/logo/logo5.png',
    vibrate: [200, 100, 200],
    data: {
      url: '/'
    }
  };
  
  // Parse notification data if available
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = { ...notificationData, ...data };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }
  
  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    vibrate: notificationData.vibrate,
    data: notificationData.data,
    tag: 'reservin-notification',
    requireInteraction: false,
    actions: [
      {
        action: 'open',
        title: 'Buka',
        icon: '/logo/logo6.png'
      },
      {
        action: 'close',
        title: 'Tutup',
        icon: '/logo/logo6.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  // Open the app
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Check if there's already a window/tab open
        for (let client of windowClients) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        
        // If not, open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// =====================================================================
// MESSAGE EVENT - Handle messages from clients
// =====================================================================
self.addEventListener('message', event => {
  console.log('[Service Worker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// =====================================================================
// PERIODIC BACKGROUND SYNC (Experimental)
// =====================================================================
self.addEventListener('periodicsync', event => {
  console.log('[Service Worker] Periodic sync triggered:', event.tag);
  
  if (event.tag === 'update-bookings') {
    event.waitUntil(updateBookings());
  }
});

async function updateBookings() {
  // Placeholder for periodic booking updates
  console.log('[Service Worker] Updating bookings in background...');
}

// =====================================================================
// ERROR HANDLING
// =====================================================================
self.addEventListener('error', event => {
  console.error('[Service Worker] Error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('[Service Worker] Unhandled rejection:', event.reason);
});

console.log('[Service Worker] Service Worker loaded successfully');