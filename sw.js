const CACHE_NAME = 'finals-widget-cache-v1';
const TEMPLATE_URL = '/finals-widget-template.json';
const DATA_URL = '/finals-widget-data.json';

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        TEMPLATE_URL,
        DATA_URL
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Helper: Calculate days remaining
function getDaysRemaining(datetimeStr) {
  const targetDate = new Date(datetimeStr);
  const today = new Date();
  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Update the Windows 11 Widget by instance ID
async function updateWidgetState(widgetInstance) {
  try {
    let exams = [];
    
    // 1. Try to read user's custom exams from Cache Storage first
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(DATA_URL);
    if (cachedResponse) {
      const cachedData = await cachedResponse.json();
      if (cachedData && cachedData.exams) {
        exams = cachedData.exams;
      }
    }

    // 2. If cache is empty, fall back to fetching from the API endpoint
    if (!exams.length) {
      const apiResponse = await fetch('/api/exams').catch(() => null);
      if (apiResponse && apiResponse.ok) {
        const apiData = await apiResponse.json();
        exams = apiData.map(e => ({
          code: e.subject,
          subjectName: e.subject,
          dateStr: e.datetime
        }));
      }
    }

    // 3. Format exams for the Adaptive Card
    const now = new Date();
    const formattedExams = exams
      .filter(e => new Date(e.dateStr || e.datetime) > now)
      .map(e => ({
        subject: e.code || e.subject || 'Subject',
        daysRemaining: getDaysRemaining(e.dateStr || e.datetime)
      }))
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const payload = {
      exams: formattedExams
    };

    // 4. Fetch the widget Adaptive Card template
    let templateText = '';
    const templateResponse = await cache.match(TEMPLATE_URL);
    if (templateResponse) {
      templateText = await templateResponse.text();
    } else {
      templateText = await (await fetch(TEMPLATE_URL)).text();
    }

    // 5. Update the Widget Board instance
    if (self.widgets && typeof self.widgets.updateByInstanceId === 'function') {
      await self.widgets.updateByInstanceId(widgetInstance.id, {
        template: templateText,
        data: JSON.stringify(payload)
      });
    }
  } catch (error) {
    console.error('Failed to update PWA widget:', error);
  }
}

// Listen to messages from the frontend to synchronize saved exams
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'UPDATE_EXAMS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.put(DATA_URL, new Response(JSON.stringify({ exams: event.data.exams })));
      })
    );
  }
});

// Windows Widget Events
self.addEventListener('widgetinstall', event => {
  event.waitUntil(updateWidgetState(event.widget));
});

self.addEventListener('widgetresume', event => {
  event.waitUntil(updateWidgetState(event.widget));
});

self.addEventListener('widgetclick', event => {
  if (event.action === 'refresh') {
    event.waitUntil(updateWidgetState(event.widget));
  }
});

self.addEventListener('widgetuninstall', event => {
  console.log(`Widget ${event.widget.id} uninstalled.`);
});

// Push Notification Listeners
self.addEventListener('push', event => {
  let data = { title: 'Finals+ Alert', body: 'You have an upcoming exam.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Finals+ Alert', body: event.data.text() };
    }
  }
  const options = {
    body: data.body,
    icon: '/assets/logo-icon.png',
    badge: '/assets/logo-icon.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
