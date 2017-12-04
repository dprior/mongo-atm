var Cache = module.exports = function(options){
	this.options = options || {};
	this.ttl = this.options.ttl || 60; //instance ttl -- override in set function for non-standard ttl
	this.limit = this.options.limit || 600;
	this.mongoClient = this.options.mongoClient || null;
	this.onMongoFail = this.options.onMongoFail || null;
	this.cache = {};
	this.requestQueued = {};
	this.deprecated = {};
}
var events = require('events');
var emitter = new events.EventEmitter();

Cache.prototype.get = function(key,callback){
	if(arguments.length === 1){
		if(this.cache[key].expires < (new Date()))
			return null;
		return this.cache[key].data || null;
	} else if(typeof this.cache[key] === 'undefined'){
		callback(null);
	} else if(this.cache[key].expires < (new Date())){
		if(typeof this.cache[key].updating !== "undefined" && this.cache[key].updating === true){
			callback(this.cache[key].data);
		}else{
			this.cache[key].updating=true;
			callback(null,this.cache[key].data); //NOTE: the second parameter needs to be used intelligently.
		}
	} else {
		callback(this.cache[key].data);
	}
}
//Legacy Support
Cache.prototype.getCache = function(key, callback){
	if(!this.deprecated.getCache){ //Only display deprecation warning once
		this.deprecated.getCache = true;
		console.log("**WARNING in mongo-atm: getCache() is deprecated, please use get() instead");
	}
	this.get(key, callback);
}
Cache.prototype.getCustom = function(key, customGetter, ttl, callback){
	var _cache = this;
	if(arguments.length === 3 && typeof ttl !== 'number'){
		callback = ttl;
		ttl = this.ttl;
	} else {
		ttl = (typeof ttl === 'number') ? ttl : this.ttl;
	}
	if(typeof key !== 'string' || key == ''){
		console.log('Error with mongo-atm: In getCustom(): Invalid/Missing key passed')
		return null;
	}else if(typeof customGetter !== 'function'){
		console.log('Error with mongo-atm: In getCustom(): Missing custom getter function');
		return null;
	}else if(typeof callback !== 'function'){
		console.log('Error with mongo-atm: In getCustom(): Missing required callback function');
		return null;
	}
	_cache.get(key, function(cacheResponse, oldData){
		//Response was cached - pass it back
		if(cacheResponse)
			return callback(cacheResponse);
		//Cached response expired - pass back old data and load new from customGetter
		else if(typeof oldData !== 'undefined'){
			callback(oldData);
			customGetter(function(newData){
				if(typeof newData !== 'undefined' && newData !== null){
					_cache.set(key, newData, ttl) //No need for callback - user has their data already
				}
			})
		}
		//No cached response - use getter to set new cache item
		else{
			emitter.once('requestCompleted'+key,function(cb){ return function(data){
					delete _cache.requestQueued[key];
					return cb(data);
			}}(callback))

			//Start getter if it hasn't been started
			if(typeof _cache.requestQueued[key] === 'undefined'){
				_cache.requestQueued[key] = true;
				customGetter(function(newData){
					if(typeof newData !== 'undefined' && newData !== null){
						_cache.set(key,newData, ttl, function(success){
							if(success)
								emitter.emit('requestCompleted'+key,newData);
							else
								emitter.emit('requestCompleted'+key,[]);
						});
					}else{
						emitter.emit('requestCompleted'+key,[]);
					}
				})
			}
		}
	})
}
Cache.prototype.getMongo = function(collection,searchObj,options,callback) {
	var _cache = this;
	var defaultLimit = 50; //NOTE: forcing a limit if one isn't defined. Bad/Good idea?
	if(arguments.length === 3){
		callback = options;
		options = {};
	}
	options = options || {};
	options.mongoClient = options.mongoClient || this.mongoClient;
	if(typeof options.mongoClient === 'undefined' || options.mongoClient === null){
		console.log('Error with mongo-atm: In getMongo(): No Mongo connection has been defined.')
		callback(null);
		return;
	}
	options.altKey = (typeof options.altKey === 'undefined') ? "" : function(){
		try{
			return JSON.stringify(options.altKey);
		}catch(e){
			return options.altKey;
		}
	}();
	options.preSetFunction = (typeof options.preSetFunction === 'function') ? options.preSetFunction : function(d,c){return c(d);};
	options.queryOptions = (typeof options.queryOptions === 'object') ? options.queryOptions : {};
	options.sort = (typeof options.sort === 'object') ? options.sort : {};
	options.limit = options.limit || defaultLimit;
	options.projection = options.projection || {};
	var ttl = options.ttl || this.ttl;
	var key = (options.altKey !== "") ? options.altKey : collection + JSON.stringify(searchObj) + JSON.stringify(options,function(k,v){
		if(k==='mongoClient' || k==='preSetFunction') return undefined; // not a good idea to stringify our mongo client
		else return v;
	});
	var mongoGetter = createMongoGetter(collection, searchObj, options, _cache.onMongoFail);
	//Run getCustom with the custom mongo getter
	_cache.getCustom(key, mongoGetter, ttl, callback);
	return;
};
Cache.prototype.set = function(key,data,ttl,callback){
	if(arguments.length === 3 && typeof ttl !== 'number'){
		callback = ttl;
		ttl = this.ttl;
	} else {
		ttl = (typeof ttl === 'number') ? ttl : this.ttl;
	}
	this.cache[key] = {};
	this.cache[key].data = data;
	this.cache[key].updating = false;
	this.cache[key].expires = new Date(new Date().getTime() + ttl * 1000);
	freezeObj(this.cache[key].data);
	if(objSize(this.cache) > this.limit)
		trimCache(this.cache,this.limit);
	if(typeof callback !== 'undefined')
		callback(data)
}
//Legacy Support
Cache.prototype.setCache = function(key, data, ttl, callback){
	if(!this.deprecated.setCache){ //Only display deprecation warning once
		this.deprecated.setCache = true;
		console.log("**WARNING in mongo-atm: setCache() is deprecated, please use set() instead");
	}
	this.set(key, data, ttl, callback);
}
Cache.prototype.flush = function(){
	this.cache = {};
}
Cache.prototype.del = function(key){
	this.cache[key] = {};
}

function createMongoGetter(collection, searchObj, options, onMongoFail){
	//Pass back our getter function
	return function(cb){
		options.mongoClient.collection(collection).find(searchObj,options.projection,options.queryOptions).sort(options.sort).limit(options.limit).toArray(function(err,results){
			if(err && typeof onMongoFail == 'function') return onMongoFail(err);
			if(typeof results !== 'undefined' && !err){ //NOTE: don't want to pollute our cache if the database is down
				options.preSetFunction(results,function(processedResults){
					return cb(processedResults);
				});
			}
		});
	}
}
function trimCache(obj, limit){
	//for now this just removes the oldest item in the object. The alternative would be to convert to array, sort, 
	//trim and convert back to object
	//limit is included for futured reference but is unused currently
	var oldest = {date: null, key: null};
	for(var key in obj)
		if(obj.hasOwnProperty(key) && (oldest.date == null || obj[key].expires < oldest.date)){
			oldest.date = obj[key].expires;
			oldest.key = key;
		}
	delete obj[oldest.key];
}
var objSize = function(obj){
	var size = 0;
	for(var key in obj)
		if(obj.hasOwnProperty(key)) size++;
	return size;
}
function freezeObj(obj){
	if(typeof obj === 'object' && obj !== null){
		var props = Object.getOwnPropertyNames(obj);
		props.forEach(function(name){
			if(obj.hasOwnProperty(name) && typeof obj[name] == 'object' && obj[name] !== null && !Object.isFrozen(obj[name]))
				freezeObj(obj[name]);
		});
	}
	return obj;
}