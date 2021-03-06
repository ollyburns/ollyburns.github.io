// If at any point you want to force pages that use this service worker to start using a fresh
// cache, then increment the CACHE_VERSION value. It will kick off the service worker update
// flow and the old cache(s) will be purged as part of the activate event handler when the
// updated service worker is activated.
var CACHE_VERSION = 4;
var CURRENT_CACHES = {
  prefetch: 'prefetch-cache-v' + CACHE_VERSION,
  inline: 'inline-cache-v' + CACHE_VERSION
};
var urlsToPrefetch = [
'https://d3js.org/d3.v6.js',
'/index-min.js',
'/favicon.ico',
'/favicon-32x32.png',
'/favicon-16x16.png',
'/site.webmanifest',
'/graph.html'
];
var urlsToCacheInline = [
'https://api.octopus.energy/v1/electricity-meter-points',
'https://api.octopus.energy/v1/products'
];
var databaseName = 'UsageVsPrice';
var cacheKeyStoreName = 'tempcachekeys';

self.importScripts('/index-min.js');

self.addEventListener('install', function(event) {
  var now = Date.now();

  console.log('Handling install event. Resources to prefetch:', urlsToPrefetch);
  console.log('Handling install event. Resources to cache inline:', urlsToCacheInline);

  event.waitUntil(idb.openDB(databaseName, 1, {upgrade(db) {db.createObjectStore(cacheKeyStoreName);}}));

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

function getDBPromise() {
  return idb.openDB(databaseName);
}

function addToCacheKeys(cacheKey, date) {	
  var dbPromise = getDBPromise();
  dbPromise.then(function(db) { db.put(cacheKeyStoreName, date, cacheKey) });
}

function getFromCacheKeys(cacheKey) {
  var dbPromise = getDBPromise();
  return dbPromise.then(function(db) { return db.get(cacheKeyStoreName, cacheKey) });
}

function deleteFromCacheKeys(cacheKey) {
  var dbPromise = getDBPromise();
  dbPromise.then(function(db) { db.delete(cacheKeyStoreName, cacheKey) });
}

self.addEventListener('fetch', function(event) {
  console.log('Handling fetch event for', event.request.url);

  event.respondWith(
    // caches.match() will look for a cache entry in all of the caches available to the service worker.
    // It's an alternative to first opening a specific named cache and then matching on that.
    caches.match(event.request).then(function(response) {
		
	  var fetchFromNetwork = function(request) {
        return fetch(request).then(function(response) {
		  var responseCopy = response.clone();
          console.log('Response from network is:', response);
		
		  //Add response to cache if in cache whitelist
		  urlsToCacheInline.forEach(function(expectedCacheName){
		    if (event.request.url.indexOf(expectedCacheName) > -1) {
			  caches.open(CURRENT_CACHES.inline).then(function(cache) {
				cache.put(event.request, responseCopy);
				var now = new Date();
				var todayDateString = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2) + 'T'; //2021-03-11T
				if (event.request.url.indexOf(todayDateString) > -1) {
				  //now.setDate(now.getDate() - 1); //uncomment to test stale cache logic
			      addToCacheKeys(event.request.url, now);
				}
			  });
			}
		  });
		
          return response;
        }).catch(function(error) {
          // This catch() will handle exceptions thrown from the fetch() operation.
          // Note that a HTTP error response (e.g. 404) will NOT trigger an exception.
          // It will return a normal response object that has the appropriate error code set.
          console.error('Fetching failed:', error);

          throw error;
        });		  
	  }

      if (response) {
        console.log('Found response in cache:', response);
		
		return getFromCacheKeys(event.request.url).then(function(oldCacheTimeStamp) {
		  var today = new Date();
		  //console.log(today - oldCacheTimeStamp);
		  if (oldCacheTimeStamp && ((today - oldCacheTimeStamp) > 3600000)) {	
			console.log('Stale cache. About to fetch from network...');
			event.waitUntil(deleteFromCacheKeys(event.request.url));
			return fetchFromNetwork(event.request);
		  }
		  else
			return response;
		});
      }

	  console.log('No response found in cache. About to fetch from network...');
      return fetchFromNetwork(event.request);
    })
  );
});
