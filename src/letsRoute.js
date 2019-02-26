'use strict'

const getFirstMatche = require("./util").getFirstMatche;
const getAllMatches = require("./util").getAllMatches;
const doesMatch = require("./util").doesMatch;
const {urlSlice, urlBreak} = require("./util");
const namedExpressionsStore = require("./namedExpressionsStore");
const semverStore = require("./semver-store");
const processPathParameters = require("./../src/paramsProcessor");
const events = require('events');

const http = require('http')
const httpMethods = http.METHODS;

// These objects are used to print the registered routes to screen
var listOfRoutes = [];
var listOfMethods = [];

Anumargak.prototype.addNamedExpression = function (arg1, arg2) {
    this.namedExpressions.addNamedExpression(arg1, arg2);
}

const supportedEvents = [ "request", "found", "not found", "route", "default" , "end"];

Anumargak.prototype._onEvent = function (eventName, fn) {
    let _name = eventName.toLowerCase();
    if(_name === "route"){
        _name = "found";
    }else if(_name === "default"){
        _name = "not found";
    }
    if( supportedEvents.indexOf(_name) === -1 ) throw Error(`Router: test casse failure? Unsupported event ${eventName}`);
    this.eventEmitter.on(_name, fn);
}

/**
 * Adds routes against the given method and URL
 * @param {string | array} method 
 * @param {string} url 
 * @param {function} fn 
 */
Anumargak.prototype.on = function (method, url, options, fn, extraData) {

   // Save the method, url and options.version into the listOfRoutes object 
//    listOfRoutes.push({
//     method:  method,
//     url:     url,
//     version: "tx"//options.version ? console.log("left exists") : console.log("right not exist")
// });


// Save all the methods which we will use to itereate through to print the routes
// listOfMethods[method]; 

    if (Array.isArray(url)) {
        for (var i = 0; i < url.length; i++) {
            this.on(method, url[i], options, fn, extraData);
        }
        return this;
    }

    if (typeof url === 'function') {
        this._onEvent(method, url);
        return this;
    } else if (typeof options === 'function' || Array.isArray(options)) {
        extraData = fn;
        fn = options;
        options = {};
    }

    if (typeof method === "string") {
        if( method.toLocaleLowerCase() === 'all'){
            this.all(url, options, fn, extraData);
        }else{
            this._on(method, url, options, fn, extraData);
        }
    } else if (Array.isArray(method)) {
        for (var i = 0; i < method.length; i++) {
            this._on(method[i], url, options, fn, extraData);
        }
    } else {
        throw Error("Invalid method argument. String or array is expected.");
    }
  

    //   if( options.version)
    // {
    //     console.log("version exists");
    // }

    return this;
}

var wildcardRegexStr = "\\/([^\\/:]*)\\*";
var enumRegexStr = ":([^\\/\\-\\(]+)-?(\\(([\\w\\|]+)\\))";



Anumargak.prototype._on = function (method, url, options, fn, extraData) {
    //validate for correct input
    if (httpMethods.indexOf(method) === -1) throw Error("Invalid method type " + method);

    url = this.normalizeUrl(url);
    const data = {
        handler: fn,
        store: extraData
    }
    this._addRoute(method, url, options, data);
}

Anumargak.prototype.normalizeUrl = function (url) {
    //Normalize URL
    if (this.ignoreLeadingSlash) {
        if (url.startsWith("/") === false) {
            url = "/" + url;
        }
    }

    url = this.namedExpressions.replaceNamedExpression(url);

    var matches = getFirstMatche(url, wildcardRegexStr);
    if (matches) {
        url = url.substr(0, matches.index + 1) + matches[0].substr(1, matches[0].length - 2) +":*(.*)"
    }

    return url;
}

/*
paramas is useful in case of enum url where we know the parameter value in advance.
*/
Anumargak.prototype._addRoute = function (method, url, options, data, params) {

    var done = this._checkForEnum(method, url, options, data, params);
    if( done ) { //All the enumerated URLs are registered
        return;
    }else{
        if (url.indexOf(":") > 0) {//DYNAMIC
            this._addDynamic(method, url, options, data, params);
        } else {//STATIC
            this._addStatic(method, url, options, data, params);
        }
    }
}

/**
 * Check and register if given URL need enumerated params.
 * @param {string} method 
 * @param {string} url 
 * @param {object | function} options 
 * @param {function} fn 
 * @param {object} params 
 */
Anumargak.prototype._checkForEnum = function(method, url, options, data, params){
    var matches = getFirstMatche(url, enumRegexStr);
    if (matches) {
        var name = matches[1];
        var pattern = matches[3];

        var arr = pattern.split("\|");
        for (var i = 0; i < arr.length; i++) {
            var newurl = url.replace(matches[0], arr[i]);
            if (params) {
                params = Object.assign({}, params);
                params[name] = arr[i];
            } else {
                params = {};
                params[name] = arr[i];
            }
            this.count--;
            this._addRoute(method, newurl, options, data, params);
        }
        this.count++;
        return true;
    }
}

/**
 * Register a static route if not registered. Register it twice if `ignoreTrailingSlash:true`
 */
Anumargak.prototype._addStatic = function(method, url, options, data, params){
    this.checkIfRoutIsPresent(this.staticRoutes, method, url, options, data.handler);
    this.count++;
    this._setMinUrlLength( url.length );

    this.__addStatic(method, url, options, data, params);
    if (this.ignoreTrailingSlash) {
        if (url.endsWith("/")) {
            url = url.substr(0, url.length - 1);
        } else {
            url = url + "/";
        }
        this.__addStatic(method, url, options, data, params);
    }
}

/**
 * Register a static route without checking any condition. It should be called by this._addStatic()
 */
Anumargak.prototype.__addStatic = function(method, url, options, data, params){
    var routeHandlers = this.getRouteHandlers(this.staticRoutes[method][url], method, url, options, data);
    this.staticRoutes[method][url] = { 
        data : routeHandlers.data,
        verMap: routeHandlers.verMap, 
        params: params,
    };
}

Anumargak.prototype._addDynamic = function(method, url, options, data, params){
    const indexOfFirstPathParam = url.indexOf(":");
    this._setMinUrlLength( indexOfFirstPathParam );

    var normalizedUrl = this.normalizeDynamicUrl(url);
    url = normalizedUrl.url;
    
    this.checkIfRoutIsPresent(this.dynamicRoutes, method, url, options, data.handler);
    var routeHandlers = this.getRouteHandlers(this.dynamicRoutes[method][url], method, url, options, data);
    
    var regex = new RegExp("^" + url + "$");
    this.dynamicRoutes[method][url] = { 
        data : routeHandlers.data,
        regex: regex, 
        verMap: routeHandlers.verMap, 
        params: params || {}, 
        paramNames: normalizedUrl.paramNames ,
    };  
    this.count++;  
}

Anumargak.prototype.normalizeDynamicUrl = function (url) {
    var result = processPathParameters(url, this.allowUnsafeRegex);
    if ( this.ignoreTrailingSlash) {
        if (result.url.endsWith("/")) {
            result.url = result.url + "?";
        } else {
            result.url = result.url + "/?";
        }
    }

    return {
        paramNames : result.paramNames,
        url : result.url
    };
}

Anumargak.prototype.getRouteHandlers = function (route, method, url, options, data) {
    if(route){ //existing route
        if(options.version){ //with version
            let verMap;
            if(route.verMap){
                verMap = route.verMap;
            }else{
                verMap = new semverStore()
            }
            verMap.set(options.version, data);
            return{
                verMap : verMap,
                data: route.data
            }
        }else{//without version
            return {
                data: data,
                verMap: route.verMap
            }
        }
    }else{//new route
        if(options.version){// with version
            const dataHandler =  {
                verMap : new semverStore()
            }
            dataHandler.verMap.set(options.version, data);
            return dataHandler;
        }else{ //without version
            return { 
                data: data
            };
        }
    }
}

Anumargak.prototype.checkIfRoutIsPresent = function (routesArr, method, url, options, fn) {
    var result = this.checkIfUrlIsPresent(routesArr, method, url);
    if (result) {
        if(options.version){//check if the version is same
            var route;
            if( this.dynamicRoutes[method][result] ){
                route = this.dynamicRoutes[method][result];
            }else {
                route = this.staticRoutes[method][result];
            }

            if(route.verMap && route.verMap.get( options.version )){
                throw Error(`Given route is matching with already registered route`);
            }
        }else if(routesArr[method][url].data){
            throw Error(`Given route is matching with already registered route`);
        }
    }
}

//var urlPartsRegex = new RegExp("(\\/\\(.*?\\)|\\/[^\\(\\)\\/]+)");
var urlPartsRegex = new RegExp(/(\/\(.*?\)|\/[^\(\)\/]+)/g);

Anumargak.prototype.checkIfUrlIsPresent = function (arr, method, url) {
    if (arr[method][url]) {//exact route is already present
        return url;
    } else {
        //check if tricky similar route is already present
        //"/this/path/:is/dynamic"
        //"/this/:path/is/dynamic"
        var urls = Object.keys( arr[method] );
        //var givenUrlParts = getAllMatches(url, urlPartsRegex);
        var givenUrlParts = getAllMatches(url, urlPartsRegex);
        for (var u_i in urls) {//compare against all the saved URLs
            //var urlParts = getAllMatches(urls[u_i], urlPartsRegex);
            var urlParts = getAllMatches(urls[u_i], urlPartsRegex);
            if (urlParts.length !== givenUrlParts.length) {
                continue;
            } else {
                var matchUrl = true;
                for (var urlPart_i in urlParts) {
                    if (doesMatch(urlParts[urlPart_i][1], givenUrlParts[urlPart_i][1])) {
                        continue
                    } else {
                        matchUrl = false;
                        break;
                    }
                }
                if (matchUrl) {
                    return urls[u_i];
                }
            }
        }

        return false;
    }
}


//Anumargak.prototype.quickFind = function (req) {
Anumargak.prototype.quickFind = function (method, url, version) {
    if( arguments.length === 1){ //method overiding
        const req = method;
        url = req.url;
        method = req.method;
        version = req.headers['accept-version'];
    }

    url = urlSlice(url, this.minUrlLength);
    let result = this.staticRoutes[method][url];
    if (result) { //static
        return this.getData(result, version);
    }else { //dynamic
        var urlRegex = Object.keys(this.dynamicRoutes[method]);
        for (var i = 0; i < urlRegex.length; i++) {
            result = this.dynamicRoutes[method][ urlRegex[i] ];
            var matches = result.regex.exec( url );
            if ( matches ){
                return this.getData(result, version);
            }
        }
    }
    return null;
}


Anumargak.prototype.lookupWithEvents = async function (req, res) {
    this.eventEmitter.emit("request", req, res); //unnecessary
    var method = req.method;
    var version = req.headers['accept-version'];

    var result = this.find(method, req.url, version);
    req._path = {
        url : result.urlData.url,
        params : result.params,
    }; 
    req._queryStr = result.urlData.queryStr;
    req._hashStr = result.urlData.hashStr;

    if(result.handler){
        this.eventEmitter.emit("found", req, res); //unnecessary
        if(Array.isArray(result.handler) ){
            const len = result.handler.length;
            for(let i=0; i<len;i++){
                if( !res.finished ) {
                    await result.handler[i](req, res, result.store);
                }else{
                    break;
                }
            }
        }else{
            result.handler(req, res, result.store);
        }
        
        this.eventEmitter.emit("end", req, res); //unnecessary

    }else{
        this.eventEmitter.emit("not found", req, res); //unnecessary
        this.defaultFn(req, res);
    }
}

Anumargak.prototype.lookup = async function (req, res) {
    var method = req.method;
    var version = req.headers['accept-version'];

    var result = this.find(method, req.url, version);
    req._path = {
        url : result.urlData.url,
        params : result.params,
    }; 
    req._queryStr = result.urlData.queryStr;
    req._hashStr = result.urlData.hashStr;

    if(result.handler){
        if(Array.isArray(result.handler) ){
            const len = result.handler.length;
            for(let i=0; i<len;i++){
                if( !res.finished ) {
                    await result.handler[i](req, res, result.store);
                }else{
                    break;
                }
            }
        }else{
            result.handler(req, res, result.store);
        }
        
    }else{
        this.defaultFn(req, res);
    }
}

Anumargak.prototype.find = function (method, url, version) {
    const urlData = urlBreak(url, this.minUrlLength);
    let result = this.staticRoutes[method][urlData.url];
    if (result) { //static
        const data = this.getData(result, version);
        if( !data ) {
            return {
                urlData : urlData
            };
        }else{
            return { 
                handler: data.handler,
                params: result.params,
                store: data.store,
                urlData : urlData
            };
        }

    }else { //dynamic
        var urlRegex = Object.keys(this.dynamicRoutes[method]);
        for (var i = 0; i < urlRegex.length; i++) {
            var route = this.dynamicRoutes[method][urlRegex[i]];
            var matches = route.regex.exec( urlData.url );
            var params = route.params;
            if (matches) {
                const data = this.getData(route, version);
                if( !data ) {
                    return {
                        urlData : urlData
                    };
                }else{
                    for (var m_i = 1; m_i < matches.length; m_i++) {
                        params[route.paramNames[m_i - 1]] = matches[m_i];
                    }
                    return { 
                        handler: data.handler,
                        params: params,
                        store: data.store,
                        urlData : urlData
                    };
                }
            }
        }
    }
    return {
        urlData : urlData
    };
}

/**
 * return data for versioned or non-versioned routes
 */
Anumargak.prototype.getData = function (route, version) {
    if(version){
        if( !route.verMap ) return;
        return route.verMap.get(version);
    }else{
        return route.data;
    }
}

Anumargak.prototype.off = function (method, url, version) {
    url = this.normalizeUrl(url);

    var done = this.removeEnum(method, url);
    if(done) return;

    var hasPathParam = url.indexOf(":");
    var result;
    let rootRoute;
    if ( hasPathParam > -1) {//DYNAMIC
        url = this.normalizeDynamicUrl(url).url;
        result = this.checkIfUrlIsPresent(this.dynamicRoutes, method, url);
        rootRoute = this.dynamicRoutes[method]
    } else {//STATIC
        result = this.checkIfUrlIsPresent(this.staticRoutes, method, url);
        rootRoute = this.staticRoutes[method]
    }

    if (result) {
        if(version ){ //remove versioned route
            let route = rootRoute[result];
            if(route.verMap && route.verMap.get( version )){
                var delCount = route.verMap.delete( version );
                this.count -= delCount;
            }
            if(route.verMap.count() === 0){
                if(route.data){
                    delete route.verMap;
                }else{
                    delete rootRoute[result];
                }
            }
        }else{ //remove non-versioned route
            if( rootRoute[result].verMap ){
                delete rootRoute[result].data;
            }else{
                delete rootRoute[result];
            }
            this.count--;
        }
    }

}

Anumargak.prototype.removeEnum = function(method, url){
    var matches = getFirstMatche(url, enumRegexStr);
    if (matches) {
        var name = matches[1];
        var pattern = matches[3];

        var arr = pattern.split("\|");
        for (var i = 0; i < arr.length; i++) {
            var newurl = url.replace(matches[0], arr[i]);
            this.off(method, newurl);
            this.count++;
        }
        this.count--;
        return true ;
    }
}

/* 
Anumargak.prototype.print = function(){
    var urlTree = {

    }

    for(var i=0; i < httpMethods.length; i++){
        this.staticRoutes [ httpMethods[i] ]
    }
}
 */

  /* 
 *  Print out all registered routes
 */ 
Anumargak.prototype.printRoutes = function(){

    // variable which we will print to the screen
    var stringToPrint;

    // TEST
    // console.log("kyes are " + Object.keys(this.staticRoutes.GET['/some/route'].verMap.tree.children['1'].children['2'].children ) + " "  );
    // console.log("kyes are " + Object.keys(this.staticRoutes.GET['/a'].verMap)  );
if (this.staticRoutes.GET['/a'].verMap)
{
    console.log("success it works route /a")
}
if (this.staticRoutes.GET['/some/route'].verMap)
{
    console.log("success it works some route")
    console.dir(this.staticRoutes.GET['/some/route'].verMap)
}
     // console.dir(this.staticRoutes.GET['/some/route'].verMap.tree.children['1'].children['2'] )
      console.dir(this.staticRoutes.GET['/a'].verMap )
// TEST END

    // process.stdout.write("\nLIST OF STATIC AND DYNAMIC ROUTES\n"+
    //                        "---------------------------------\n\n");

    // // Iterate through each of the methods 
    // Object.keys(listOfMethods).forEach(function(key, index){

    //     process.stdout.write(key + "\n { \n");

    //     // Iterate through all of the objects which hold the route url's and versions 
    //     for(var i=0; i < listOfRoutes.length; i++){

    //         // reset the string we use to print to the screen
    //         stringToPrint = "";

    //         // We will print this object if its method matches the listOfMethods object 
    //         if ( key == listOfRoutes [ i ] . method)
    //         {
    //             // start constructing the string which will be printed out
    //             stringToPrint =  "     " + listOfRoutes [ i ] .url;

    //             // check to see if there is a version and if there is append it to the string
    //            if ( listOfRoutes [i] .version)
    //            {
    //             stringToPrint += " { with version => " + listOfRoutes [i] .version + " }\n";
    //            } else { 
    //                // no version, append a newline to the string
    //                stringToPrint += "\n" 
    //             }
    //             // print out route to screen
    //             process.stdout.write(stringToPrint);
    //         }
    //     }
    //     // newlines for the next method
    //     process.stdout.write(" }\n\n");
    // });
}

//register shorthand methods
for (var index in httpMethods) {
    const methodName = httpMethods[index];
    const methodNameInSmall = methodName.toLowerCase();
  
    Anumargak.prototype[methodNameInSmall] = function (url, options, fn, store) {
      return this.on(methodName, url, options, fn, store);
    }
}

Anumargak.prototype.all = function (url, options, fn, store) {
    this.on(httpMethods, url, options, fn, store);
}

Anumargak.prototype._setMinUrlLength =  function (num){
    if( num < this.minUrlLength) this.minUrlLength = num;
}

function Anumargak(options) {
    if (!(this instanceof Anumargak)) return new Anumargak(options);

    options = options || {};
    this.count = 0;
    this.minUrlLength = 0;
    this.namedExpressions = namedExpressionsStore();
    this.eventEmitter = new events.EventEmitter();

    this.allowUnsafeRegex = options.allowUnsafeRegex || false;
    this.dynamicRoutes = {};
    this.staticRoutes = {};

    for (var index in http.METHODS) {
        const methodName = httpMethods[index];
        this.dynamicRoutes [ methodName ] = {};
        this.staticRoutes [ methodName ] = {};
    }
    
    if (options) {
        if (options.defaultRoute) {
            this.defaultFn = options.defaultRoute;
        }else{
            this.defaultFn = defaultRoute;
        }
        this.ignoreTrailingSlash = options.ignoreTrailingSlash || false;
        this.ignoreLeadingSlash = options.ignoreLeadingSlash || true;
        this.overwriteAllow = options.overwriteAllow || false;
    }

    
}

function defaultRoute(req, res) {
    res.statusCode = 404
    res.end()
}
module.exports = Anumargak;
