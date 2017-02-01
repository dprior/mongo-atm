var Cache = module.exports = function(options){
	this.options = options || {};
	this.ttl = this.options.ttl || 60; //instance ttl -- override in set function for non-standard ttl
	this.limit = this.options.limit || 600;
	this.mongoClient = this.options.mongoClient || null;
	this.onMongoFail = this.options.onMongoFail || null;
	this.cache = {};
	this.requestQueued = {};
}
var events = require('events');
var emitter = new events.EventEmitter();

Cache.prototype.getCache = function(key,callback){
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
Cache.prototype.getMongo = function(collection,searchObj,options,callback) {
	var _cache = this;
	var defaultLimit = 50; //NOTE: forcing a limit if one isn't defined. Bad/Good idea?
	if(arguments.length === 3){
		callback = options;
		options = {};
	}
	options = options || {};
	var mongoClient = options.mongoClient || this.mongoClient;
	if(typeof mongoClient === 'undefined' || mongoClient === null){
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
	options.ttl = options.ttl || this.ttl;
	var key = (options.altKey !== "") ? options.altKey : collection + JSON.stringify(searchObj) + JSON.stringify(options,function(k,v){
		if(k==='mongoClient' || k==='preSetFunction') return undefined; // not a good idea to stringify our mongo client
		else return v;
	});
	_cache.getCache(key,function(cacheResponse,oldData){
		if(cacheResponse){
			callback(cacheResponse);
		}else if(typeof oldData !== "undefined"){
			callback(oldData);
			mongoClient.collection(collection).find(searchObj,options.projection,options.queryOptions).sort(options.sort).limit(options.limit).toArray(function(err,results){
				if(err && _cache.onMongoFail) _cache.onMongoFail(err);
				if(typeof results !== 'undefined' && !err){ //NOTE: don't want to pollute our cache if the database is down
					options.preSetFunction(results,function(processedResults){
						_cache.setCache(key,processedResults,options.ttl,function(success){
							//NOTE: already performed callback.
							return;
						});
					});
				}
			});
		}else{
			emitter.once('requestCompleted'+key,function(cb){ return function(data){
				delete _cache.requestQueued[key];
				cb(data);
			}}(callback));

			if(typeof _cache.requestQueued[key] === 'undefined'){
				_cache.requestQueued[key]=true;
				mongoClient.collection(collection).find(searchObj,options.projection,options.queryOptions).sort(options.sort).limit(options.limit).toArray(function(err,results){
					if(err && _cache.onMongoFail){
						_cache.onMongoFail(err);
						emitter.emit('requestCompleted'+key,[]); //???
					}
					if(typeof results !== 'undefined' && !err){
						options.preSetFunction(results,function(processedResults){
							_cache.setCache(key,processedResults,options.ttl,function(success){
								if(success)
									emitter.emit('requestCompleted'+key,processedResults);
								else emitter.emit('requestCompleted'+key,[]);
							});
						});
					} else {emitter.emit('requestCompleted'+key,[]);}
				});
			}
		}
	});
};
Cache.prototype.setCache = function(key,data,ttl,callback){
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
	if(objSize(this.cache) > this.limit)
		trimCache(this.cache,this.limit);
	if(typeof callback !== 'undefined')
		callback(data)
}
Cache.prototype.flush = function(){
	this.cache = {};
}
Cache.prototype.del = function(key){
	this.cache[key] = {};
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