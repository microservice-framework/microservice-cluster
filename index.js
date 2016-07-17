/**
 * Central Startup file.
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */
"use strict";

const cluster = require( "cluster" );
var webHttp = require( "./includes/web.js" );

// Debug module.
const debugF = require( "debug" );

/**
 * Constructor.
 *   Prepare data for deploy.
 */
function Cluster( data ) {
  var self = this;
  self.data = data;

  if ( cluster.isMaster ) {
    const numCPUs = require( "os" ).cpus().length;
    self.debug.log( "Starting up %s workers.", numCPUs );
    for ( var i = 0; i < numCPUs; i++ ) {
      cluster.fork();
    }
    cluster.on( "online", function( worker ) {
      self.debug.log( "Worker %s is online", worker.process.pid );
    } );
    cluster.on( "exit", function( worker, code, signal ) {
      self.debug.log( "Worker %s died. code %s signal %s", worker.process.pid, code, signal );
      self.debug.log( "Starting a new worker" );
      cluster.fork();
    } );

    process.on( "SIGINT", function() {
      self.debug.log( "Caught interrupt signal" );
      process.exit();
    } );
  } else {
    var webServer = new webHttp( self.data );

    process.on( "SIGINT", function() {
      self.debug.worker( "Caught interrupt signal" );
      webServer.stop();
    } );

    process.on( "SIGTERM", function() {
      self.debug.worker( "Caught termination signal" );
      webServer.stop();
      }
    );
  }
}

Cluster.prototype.debug = {
  log: debugF( "cluster:main" ),
  worker: debugF( "cluster:worker" )
};

// Processed by tokens data structure
Cluster.prototype.data = {};

module.exports = Cluster;
