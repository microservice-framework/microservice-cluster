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

  self.server = http.createServer( self.RequestHandler );
  self.debug.main( "Listen on :%s", self.data.port );
  self.server.listen( self.data.port );
}

// Processed by tokens data structure
WebServer.prototype.data = {};

WebServer.prototype.server = false;

WebServer.prototype.RequestHandler = function( request, response ) {
  var self = this;
  self.debug.request( "%s: %s", request.method, request.url );
  var data = "";
  request.addListener( "data", function( chunk ) { data += chunk; } );
  request.addListener( "end", function( ) {
    if(data) {
      self.debug.request( "Data: %s", data );
    }
    try {
      switch ( request.method ) {
        case "POST":
            throw new Error( "POST" );
          break;
        case "GET":
            throw new Error( "GET" );
          break;
        case "PUT":
            throw new Error( "PUT" );
          break;
        case "DELETE":
            throw new Error( "DELETE" );
          break;
        case "PATCH":
            throw new Error( "PATCH" );
          break;
        default:
            throw new Error( "UNKNOW" );
      }
      response.writeHead( 500, { "content-type": "application/json" } );
      response.end( "\n" );
    } catch ( e ) {
      response.writeHead( 500, { "content-type": "application/json" } );
      response.write( JSON.stringify( { "error": "Internal error" }, null, 2 ) );
      response.end( "\n" );
      self.debug.request( "Error intersepted:\n %s", e.stack );
    }
  }
};

WebServer.prototype.stop = function() {
  var self = this;
  self.server.close( function() {
      self.debug.main( "Worker stopped" );
      process.exit();
  } );
};

WebServer.prototype.debug = {
  main: debugF( "http:main" ),
  request: debugF( "http:request" )
};

module.exports = WebServer;
