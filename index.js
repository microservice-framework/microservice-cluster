/**
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const spawn = require('child_process').spawn;

if (!process.env.DEVEL && process.env.LOGFILE && !process.env.BACKGROUND) {
  var spawnArgvs = [];
  for (var i in process.argv) {
    if (i > 0) {
      spawnArgvs.push(process.argv[i]);
    }
  }
  var env = process.env;
  env.BACKGROUND = true;
  spawn(process.argv0, spawnArgvs, {
    stdio: 'ignore',
    detached: true,
    env: env,
  }).unref();
  process.exit();
}

if (process.env.DEVEL) {
  if (process.env.DEVEL_DEBUG) {
    process.env.DEBUG = process.env.DEVEL_DEBUG;
  } else {
    process.env.DEBUG = '*';
  }
}

if (process.env.BACKGROUND) {
  process.env.DEBUG_COLORS = false;
  var logFile = fs.createWriteStream(process.env.LOGFILE, { flags: 'a' });
  process.stdout.write = process.stderr.write = logFile.write.bind(logFile);
}

const cluster = require('cluster');
const WebHttp = require('./includes/web.js');
const debugF = require('debug');

/**
 * Constructor.
 *   Prepare data for deploy.
 */
function Cluster(data) {
  var self = this;
  self.data = data;
  let singletonProcess = false;
  if (self.data.callbacks['singleton']) {
    singletonProcess = true
  }

  let isLegacyInit = false;
  if (self.data.callbacks['init']) {
    if(self.data.callbacks['init'].length == 3) {
      isLegacyInit = true
    }
  }

  if (cluster.isMaster) {
    
    if (data.pid) {
      fs.writeFileSync(data.pid, process.pid);
    }
    let numCPUs = 1;
    if (data.count) {
      numCPUs = data.count;
    } else {
      numCPUs = require('os').cpus().length;
    }

    self.debug.log('Starting up %s workers.', numCPUs);
    for (var i = 0; i < numCPUs; i++) {
      if (singletonProcess === true) {
        let worker = cluster.fork({'IS_SINGLETON': true});
        singletonProcess = worker.id;
        continue;
      } 
      cluster.fork();
    }

    cluster.on('online', function(worker) {
      self.debug.log('Worker %s is online', worker.process.pid);
    });

    cluster.on('exit', function(worker, code, signal) {
      self.debug.log('Worker %s died. code %s signal %s', worker.process.pid, code, signal);
      self.debug.log('Starting a new worker');
      if (singletonProcess === worker.id) {
        let worker = cluster.fork({'IS_SINGLETON': true});
        singletonProcess = worker.id;
        return
      }
      cluster.fork();
    });

    cluster.on('listening', function(worker, address) {
      // backward compatibility 1.x.
      if (isLegacyInit) {
        self.data.callbacks['init'](cluster, worker, address);
      }
    });

    process.on('SIGINT', function() {
      self.debug.log('Caught interrupt signal');
      if (data.pid) {
        if(fs.existsSync(data.pid)) {
          fs.unlinkSync(data.pid);
        }
      }
    });

    cluster.on('message', function(worker, message) {
      // Broadcast message from worker to all workers as IPM handler
      self.debug.debug('Broadcast message to workers %s.', message.toString());
      for (var key in cluster.workers) {
        cluster.workers[key].send(message);
      }
    })
  } else {
    var webServer = new WebHttp(self.data);

    if (process.env.IS_SINGLETON) {
      if (self.data.callbacks['singleton']) {
        self.debug.log('Starting singleton');
        self.data.callbacks['singleton'](true, cluster);
      } else {
        self.debug.log('No singleton defined');
      }
    } else {
      // No starting init in singleton
      // If it's is not legacy init, start it in every child
      if (!isLegacyInit) {
        self.data.callbacks['init'](cluster);
      }
    }

    process.on('message', function(message) {
      self.debug.debug('IPM Message received: %s', message.toString());
      let method = 'IPM'
      try {
        if (self.data.callbacks[method]) {
          if(message.type && message.message) {
            self.data.callbacks[method](message.type, message.message);
          } else {
            self.data.callbacks[method](message);
          }
        } else {
          throw new Error(method + ' is not supported.');
        }
      } catch (e) {
        self.debug.debug('Error intersepted:\n %s', e.stack);
      }
    });

    let shutdownFunction = function(){
      webServer.stop();
      // call singleton on stop if it is singleton process
      if (process.env.IS_SINGLETON) {
        if (self.data.callbacks['singleton']) {
          self.data.callbacks['singleton'](false);
        }
      } else {
        if (self.data.callbacks['shutdown']) {
          self.data.callbacks['shutdown']();
        }
      }
    }
    
    let multipleInt = false
    process.on('SIGINT', function() {
      self.debug.worker('Caught interrupt signal');
      shutdownFunction()
      if(multipleInt) {
        // force termination on multiple SIGINT
        process.exit(0)
      }
      multipleInt = true
    });

    process.on('SIGTERM', function() {
      self.debug.worker('Caught termination signal');
      shutdownFunction()
      // On terminate we force termination in 15 sec.
      let termIn = 15000
      if(process.env.TERMINATE_IN && parseInt(process.env.TERMINATE_IN) > 0) {
        termIn = parseInt(process.env.TERMINATE_IN)
      }
      setTimeout(function(){
        process.exit(0)
      }, termIn)
    });
  }
  cluster.message = function(type, message) {
    let send = {
      type: type,
      message: message
    }
    process.send(send);
  }
  return cluster;
}

Cluster.prototype.debug = {
  log: debugF('cluster:main'),
  debug: debugF('cluster:debug'),
  worker: debugF('cluster:worker')
};

// Processed by tokens data structure
Cluster.prototype.data = {};

module.exports = Cluster;
