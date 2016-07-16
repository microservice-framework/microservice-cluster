/**
 * Handle HTTP startup and shutdown.
 * Parse request and s
 */
"use strict";

var http = require( "http" );

// Debug module.
const debugF = require( "debug" );

const bind = function( fn, me ) { return function() { return fn.apply( me, arguments ); }; };


/**
 * Constructor.
 *   Prepare data for deploy.
 */
function WebServer( data ) {
  // Use a closure to preserve `this`
  var self = this;
  self.data = data;

  this.RequestHandler = bind( this.RequestHandler, this );
  this.callbackExecutor = bind( this.callbackExecutor, this );

  self.server = http.createServer( self.RequestHandler );
  self.debug.log( "Listen on :%s", self.data.port );
  self.server.listen( self.data.port );
}

// Processed by tokens data structure
WebServer.prototype.data = {};

WebServer.prototype.server = false;

WebServer.prototype.RequestHandler = function( request, response ) {
  var self = this;

  self._response = response;
  self.debug.log( "%s: %s", request.method, request.url );
  var data = "";
  var request_details = {};

  request.addListener( "data", function( chunk ) { data += chunk; } );
  request.addListener( "end", function( ) {
    if(data != "") {
      self.debug.debug( "Data: %s", data );
      try {
        data = JSON.parse( data );
      } catch ( e ) {
        response.writeHead( 500, { "content-type": "application/json" } );
        response.write( JSON.stringify( { "error": "Internal error" }, null, 2 ) );
        response.end( "\n" );
        self.debug.debug( "Error intersepted:\n %s", e.stack );
      }
    } else {
      data = {};
    }

    request_details.url = request.url.substr(1);
    request_details.headers = request.headers;

    self.debug.debug( "Parsed data: %s", JSON.stringify( data, null, 2 ) );
    try {
      switch ( request.method ) {
        case "POST":
            if(self.data.callbacks.post) {
              self.data.callbacks.post(data, request_details, self.callbackExecutor)
            } else {
              throw new Error( "POST" );
            }
          break;
        case "GET":
            if(self.data.callbacks.get) {
              self.data.callbacks.get(data, request_details, self.callbackExecutor)
            } else {
              throw new Error( "GET" );
            }
          break;
        case "PUT":
            if(self.data.callbacks.put) {
              self.data.callbacks.put(data, request_details, self.callbackExecutor)
            } else {
              throw new Error( "PUT" );
            }
          break;
        case "DELETE":
            if(self.data.callbacks.delete) {
              self.data.callbacks.delete(data, request_details, self.callbackExecutor)
            } else {
              throw new Error( "DELETE" );
            }
          break;
        case "PATCH":
            if(self.data.callbacks.patch) {
              self.data.callbacks.patch(data, request_details, self.callbackExecutor)
            } else {
              throw new Error( "PATCH" );
            }
          break;
        default:
            throw new Error( "UNKNOW" );
      }
      //response.writeHead( 500, { "content-type": "application/json" } );
      //response.write( JSON.stringify( { "error": "Internal error" }, null, 2 ) );
      //response.end( "\n" );
    } catch ( e ) {
      response.writeHead( 500, { "content-type": "application/json" } );
      response.write( JSON.stringify( { "error": "Internal error" }, null, 2 ) );
      response.end( "\n" );
      self.debug.debug( "Error intersepted:\n %s", e.stack );
    }
  });
};
WebServer.prototype.callbackExecutor = function(err, handler_response) {
  var self = this;
  self.debug.debug( "Handler responce:\n %s", JSON.stringify( handler_response , null, 2 ) );
  if(err) {
    throw err;
  }else{
    self._response.writeHead( handler_response.code, { "content-type": "application/json" } );
    self._response.write( JSON.stringify( handler_response.answer , null, 2 ) );
    self._response.end( "\n" );
  }
}
WebServer.prototype.stop = function() {
  var self = this;
  self.server.close( function() {
      self.debug.log( "Worker stopped" );
      process.exit();
  } );
};

WebServer.prototype.debug = {
  log: debugF( "http:log" ),
  request: debugF( "http:request" ),
  debug: debugF( "http:debug" )
};

module.exports = WebServer;
