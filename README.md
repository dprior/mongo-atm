# mongo-atm

A simple in-memory cache for node.js with optional mongoDB helper

## Installation

```javascript
npm install mongo-atm
```

## Simple Examples

```javascript
var Cache = require('mongo-atm');
var myCache = new Cache ({
    ttl: 120, // OPTIONAL: time to live in seconds -- Defaults to 60 seconds.
    limit: 400, // OPTIONAL: maximum objects to keep in cache -- Defaults to 600.
    mongoClient: dbClient // OPTIONAL: mongoDB instance to allow mongo-atm to make calls to mongo. This can also be sent with the getMongo() call.
});

//Simple Caching
myCache.setCache('foo', 'bar');
console.log(myCache.getCache('foo')); //bar

//Custom TTL
myCache.setCache('foo2', 'bar2', 10); //sets ttl to 10 seconds
setTimeout(function(){
    console.log(myCache.getCache('foo2')); //null
},15000);


//Using Callbacks
myCache.setCache('foo3', 'bar3', function(data){
    console.log(data); //bar3
});
myCache.getCache('foo3',function(cachedResponse){
    if(cachedResponse)
        console.log(cachedResponse); //bar3
    else
        console.log('No cache for you!');
});

//If you're worried about latency waiting to re-cache expired items, 
//the getCache callback can also return expired items:
myCache.getCache('foo3',function(cachedResponse, expiredResponse){
    if(cachedResponse)
        console.log(cachedResponse); //bar3
    else if (expiredResponse){
        //now would be a good time to refresh the data and use setCache
        console.log(expiredResponse); //bar3
        myCache.setCache('foo3','newbar');
    } else {
        //not found in cache
        myCache.setCache('foo3','newbar',function(data){
            console.log(data); //newbar
        });
    }
});

//This method implements the above function by accepting a custom getter function
// - The custom getter receives a callback function as its argument
// - The custom getter sends back the data to be cached through the callback function
myCache.getCustom('foo4', myCustomGetter, function(data){
    //Returns an empty array by default
    if(data && typeof data.length !== 'undefined' && data.length == 0){
        console.log("Nothing found!!");
    }else{
        console.log(data); //foo
    }
})
function myCustomGetter(callback){
    //Do some asynchronous processing here and pass back some data
    callback('foo');
}

//And finally for the fun part!! The getMongo() call automates the above method by
//creating a custom getter that handles querying mongodb for you!!
myCache.getMongo('myCollection',{firstName:"David"},function(data){ //returns an array
    if(data.length > 0)
        console.log(data[0].firstName); //David
    else
        console.log("Nothing found!!");
});
```

## API

**Required constructor to create an instance of mongo-atm**

```javascript
var myCache = new Cache(options);
```

  * **options** is an optional settings object containing some or all of the following:
    * **ttl** is a number setting the time to live in seconds for the instance. Defaults to 60.
    * **limit** is a number setting the maximum number of objects kept in cache. Defaults to 600.
    * **mongoClient** is a mongoDB instance should you want/need mongo-atm to interact with your mongo collections.

- - -

**Writes to cache**

```javascript
myCache.setCache(key, value, ttl, callback);
```

  * **key** is a string that identifies your cached object. [Required]
  * **value** is what ever you are wanting to cache. [Required]
  * **ttl** is a number that sets a custom time to live in seconds for the cached object. [Optional]
  * **callback** is a callback function that returns the object that was written to cache. [Optional]

- - -

**Retrieves from cache for a given key**

```javascript
myCache.getCache(key, callback);
```

  * **key** is a string that identifies your cached object. [Required]
  * **callback** is a callback function that returns two values. [Optional]
    * **cachedResponse** is whatever was found in cache or returns null if cache was expired or missing. [Required]
    * **expiredResponse** is returned as the second parameter if the requested cached item has expired. [Optional]

- - -

**Deletes a single item from cache for a given key**

```javascript
myCache.del(key);
```

  * **key** is a string that identifies the cached object to be removed. [Required]

- - -

**Deletes all items from cache**

```javascript
myCache.flush();
```

- - -

**Custom Getter Helper**
```javascript
myCache.getCustom(key, customGetter, ttl, callback);
```

  * **key** is a string that identifies your cached object. [Required]
  * **customGetter** is a custom function that meets the following requirements: [Required]
    * **callback arugment** gets passed to your getter by the getCustom method
    * **callback** gets called by your custom getter to send data back to get cached
  * **ttl** is a number that sets a custom time to live in seconds for the cached object. [Optional]
  * **callback** is a callback function that returns the object that was written to cache. [Optional]

- - -

**mongoDB Helper**

```javascript
myCache.getMongo(collection, searchObj, options, callback);
```

Queries a provided mongoDB instance based on the criteria provided and automatically utilizes cache for the results. Please reference [mongoDB docs](http://docs.mongodb.org/manual/reference/method/db.collection.find/) for requirements for specific parameters.

  * **collection** is a string that identifies the mongoDB collection you wish to query. [Required]
  * **searchObj** is the search criteria for mongoDB in the form {key: value}. [Required]
  * **options** is an optional settings object containing some or all of the following:
    * **mongoClient** is your mongoDB instance. It is required if it wasn't declared with the constructor. [Conditionally Required]
    * **queryOptions** is an object used as the 3rd parameter in mongo find() function and includes options such as limit and skip in the form {limit: size, skip: page} [Optional]
    * **sort** is the field used to sort by in the form {field: 1} [Optional]
    * **limit** is a number setting the maximum number of results to return. Defaults to 50. [Optional]
    * **projection** is the projection fields to include in the results in the form {field: 1} [Optional]
    * **callback** is a callback function that returns the cached mongoDB results in the form of an array. [Required]