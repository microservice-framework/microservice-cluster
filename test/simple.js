/**
 * Central Startup file.
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */
"use strict";

var Cluster = require( "../index.js" );

var mcluster = new Cluster( {
  port: 5000
} );
