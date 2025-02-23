/**
 * Central Startup file.
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */
"use strict";

import Cluster from "../index.js";

var mcluster = new Cluster( {
  port: 10000,
  count: 3,
  pid: './cluster.pid',
  callbacks: {
    singleton: function(isStart, variables) {
      console.log('singleton',isStart, variables );
      if(isStart) { variables({test: 1}) }
    },
    init: function(callback) {
      callback({test: 1});
      console.log('init');
    },
    POST: function(data, requestDetails, callback) {
      console.log('post %O %O', data, requestDetails);
      callback(null, {
        code: 200,
        answer: {test: 1, data: data},
        headers: { test: 100}
      })
    },
  }
} ).on('online', function(worker) {
  console.log('Worker %s is online', worker.process.pid);
}).on('exit', function(worker, code, signal) {
  console.log('Worker %s died. code %s signal %s', worker.process.pid, code, signal);
});

console.log('mcluster:!');

