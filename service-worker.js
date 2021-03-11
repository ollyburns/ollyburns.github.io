
// If at any point you want to force pages that use this service worker to start using a fresh
// cache, then increment the CACHE_VERSION value. It will kick off the service worker update
// flow and the old cache(s) will be purged as part of the activate event handler when the
// updated service worker is activated.
var CACHE_VERSION = 3;
var CURRENT_CACHES = {
  prefetch: 'prefetch-cache-v' + CACHE_VERSION,
  inline: 'inline-cache-v' + CACHE_VERSION
};
var urlsToPrefetch = [
'https://d3js.org/d3.v6.js',
'/favicon.ico',
'/favicon-32x32.png',
'/favicon-16x16.png',
'/site.webmanifest'
];
var urlsToCacheInline = [
'https://api.octopus.energy/v1/electricity-meter-points',
'https://api.octopus.energy/v1/products'
];
var tempCacheKeys = {};
  
self.addEventListener('install', function(event) {
  var now = Date.now();

  // All of these logging statements should be visible via the "Inspect" interface
  // for the relevant SW accessed via chrome://serviceworker-internals
  console.log('Handling install event. Resources to prefetch:', urlsToPrefetch);
  console.log('Handling install event. Resources to cache inline:', urlsToCacheInline);

  event.waitUntil(
    caches.open(CURRENT_CACHES.prefetch).then(function(cache) {
      var cachePromises = urlsToPrefetch.map(function(urlToPrefetch) {
        // This constructs a new URL object using the service worker's script location as the base
        // for relative URLs.
        var url = new URL(urlToPrefetch, location.href);
        // Append a cache-bust=TIMESTAMP URL parameter to each URL's query string.
        // This is particularly important when precaching resources that are later used in the
        // fetch handler as responses directly, without consulting the network (i.e. cache-first).
        // If we were to get back a response from the HTTP browser cache for this precaching request
        // then that stale response would be used indefinitely, or at least until the next time
        // the service worker script changes triggering the install flow.
        url.search += (url.search ? '&' : '?') + 'cache-bust=' + now;

        // It's very important to use {mode: 'no-cors'} if there is any chance that
        // the resources being fetched are served off of a server that doesn't support
        // CORS (http://en.wikipedia.org/wiki/Cross-origin_resource_sharing).
        // In this example, www.chromium.org doesn't support CORS, and the fetch()
        // would fail if the default mode of 'cors' was used for the fetch() request.
        // The drawback of hardcoding {mode: 'no-cors'} is that the response from all
        // cross-origin hosts will always be opaque
        // (https://slightlyoff.github.io/ServiceWorker/spec/service_worker/index.html#cross-origin-resources)
        // and it is not possible to determine whether an opaque response represents a success or failure
        // (https://github.com/whatwg/fetch/issues/14).
        //var request = new Request(url, {mode: 'no-cors'});
        var request = new Request(url);
        return fetch(request).then(function(response) {
          if (response.status >= 400) {
            throw new Error('request for ' + urlToPrefetch +
              ' failed with status ' + response.statusText);
          }

          // Use the original URL without the cache-busting parameter as the key for cache.put().
          return cache.put(urlToPrefetch, response);
        }).catch(function(error) {
          console.error('Not caching ' + urlToPrefetch + ' due to ' + error);
        });
      });

      return Promise.all(cachePromises).then(function() {
        console.log('Pre-fetching complete.');
      });
    }).catch(function(error) {
      console.error('Pre-fetching failed:', error);
    })
  );
});

self.addEventListener('activate', function(event) {
  // Delete all caches that aren't named in CURRENT_CACHES.
  var expectedCacheNames = Object.keys(CURRENT_CACHES).map(function(key) {
    return CURRENT_CACHES[key];
  });

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
		cacheNames.map(function(cacheName) {
		  var found = false;
		  expectedCacheNames.forEach(function(expectedCacheName) {
			if (cacheName.indexOf(expectedCacheName) > -1)
		      found = true;
		  });
		  if (!found) {
			// If this cache name isn't present in the array of "expected" cache names, then delete it.
			console.log('Deleting out of date cache:', cacheName);
			return caches.delete(cacheName);
		  }
		})
      );
    })
  );
  
});

self.addEventListener('fetch', function(event) {
  console.log('Handling fetch event for', event.request.url);
  console.log(tempCacheKeys);

  event.respondWith(
    // caches.match() will look for a cache entry in all of the caches available to the service worker.
    // It's an alternative to first opening a specific named cache and then matching on that.
    caches.match(event.request).then(function(response) {
      if (response) {
        console.log('Found response in cache:', response);
		
		var oldCacheTimeStamp = tempCacheKeys[event.request.url];
		var today = new Date();
		if (oldCacheTimeStamp && ((today.getDate() !== oldCacheTimeStamp.getDate()) || (today.getMonth() !== oldCacheTimeStamp.getMonth()))) {	
			console.log('Stale cache. About to fetch from network...');
			delete tempCacheKeys[event.request.url];
		}
		else
		  return response;
      }
	  else
		console.log('No response found in cache. About to fetch from network...');

      // event.request will always have the proper mode set ('cors, 'no-cors', etc.) so we don't
      // have to hardcode 'no-cors' like we do when fetch()ing in the install handler.
      return fetch(event.request).then(function(response) {
		var responseCopy = response.clone();
        console.log('Response from network is:', response);
		
		//Add response to cache if in cache whitelist
		urlsToCacheInline.forEach(function(expectedCacheName){
		  if (event.request.url.indexOf(expectedCacheName) > -1)
			  caches.open(CURRENT_CACHES.inline).then(function(cache) {
				cache.put(event.request, responseCopy);
				var now = new Date();
				var todayDateString = now.getFullYear() + '-' + ('0' + now.getMonth()).slice(-2) + '-' + ('0' + now.getDate()).slice(-2) + 'T'; //2021-03-11T
				console.log(todayDateString);
				if (event.request.url.indexOf(todayDateString) > -1)
					tempCacheKeys[event.request.url] = new Date();
			  });
		  });
		
        return response;
      }).catch(function(error) {
        // This catch() will handle exceptions thrown from the fetch() operation.
        // Note that a HTTP error response (e.g. 404) will NOT trigger an exception.
        // It will return a normal response object that has the appropriate error code set.
        console.error('Fetching failed:', error);

        throw error;
      });
    })
  );
});