/**
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */

'use strict';

import fs from 'fs';
import { spawn } from 'child_process';
import { cpus } from 'node:os';
import cluster from 'node:cluster';
import debug from 'debug';
import WebHttp from './includes/web.js';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import { EventEmitter } from 'node:events';

export function Cluster(settings) {
  this.settings = settings;
  this.isShutdown = false;
  this.multipleInt = false;
  this.sharedData = {};
  EventEmitter.call(this); // Call EventEmitter constructor
  this.init();
}

// Inherit from EventEmitter
Object.setPrototypeOf(Cluster.prototype, EventEmitter.prototype);

Cluster.prototype.init = function () {
  let singletonProcess = false;
  if (this.settings.callbacks['singleton']) {
    singletonProcess = true;
  }
  if (cluster.isPrimary) {
    if (this.settings.pid) {
      fs.writeFileSync(this.settings.pid + '', process.pid + '');
    }
    let numCPUs = 1;
    if (this.settings.count) {
      numCPUs = this.settings.count;
    } else {
      numCPUs = cpus().length;
    }

    this.debug.log('Starting up %s workers.', numCPUs);
    for (var i = 0; i < numCPUs; i++) {
      if (singletonProcess === true) {
        let worker = cluster.fork({ IS_SINGLETON: true });
        singletonProcess = worker.id;
        continue;
      }
      cluster.fork();
    }

    cluster.on('online', (worker) => {
      this.debug.log('Worker %s is online', worker.process.pid);
      this.emit('online', worker);
    });

    cluster.on('exit', (worker, code, signal) => {
      this.debug.log('Worker %s died. code %s signal %s', worker.process.pid, code, signal);
      if (this.isShutdown) {
        this.emit('exit', worker, code, signal);
        return;
      }
      this.debug.log('Starting a new worker');
      if (singletonProcess === worker.id) {
        let worker = cluster.fork({ IS_SINGLETON: true });
        singletonProcess = worker.id;
        return;
      }
      cluster.fork();
    });

    cluster.on('listening', (worker, address) => {
      this.emit('listening', worker, address);
    });

    process.on('SIGINT', () => {
      this.stopCluster('SIGINT');
    });

    process.on('SIGTERM', () => {
      this.stopCluster('SIGTERM');
    });

    cluster.on('message', (worker, message) => {
      // Broadcast message from worker to all workers as IPM handler
      this.debug.debug('Broadcast message to workers %s.', message.toString());
      for (var key in cluster.workers) {
        cluster.workers[key].send(message);
      }
    });
  } else {
    this.webServer = new WebHttp(this.settings);

    if (process.env.IS_SINGLETON) {
      if (this.settings.callbacks['singleton']) {
        this.debug.log('Starting singleton');
        this.settings.callbacks['singleton'](true, (variables) => {
          this.sharedData.singleton = variables;
        });
      } else {
        this.debug.log('No singleton defined');
      }
    } else {
      if (this.settings.callbacks['init']) {
        this.debug.log('Starting init');
        this.settings.callbacks['init']((variables) => {
          this.sharedData.init = variables;
        });
      }
    }

    process.on('message', (message) => {
      this.debug.debug('IPM Message received: %s', message.toString());
      let method = 'IPM';
      try {
        if (this.settings.callbacks[method]) {
          if (message.type && message.message) {
            this.settings.callbacks[method](message.type, message.message);
          } else {
            this.settings.callbacks[method](message);
          }
        } else {
          throw new Error(method + ' is not supported.');
        }
      } catch (e) {
        this.debug.debug('Error intersepted:\n %s', e.stack);
      }
    });

    process.on('SIGINT', () => {
      this.debug.worker('Caught interrupt signal');
      if (this.multipleInt) {
        // force termination on multiple SIGINT
        process.exit(0);
      }
      this.shutdownFunction();
      this.multipleInt = true;
    });

    process.on('SIGTERM', () => {
      this.debug.worker('Caught termination signal');
      this.shutdownFunction();
      // On terminate we force termination in 15 sec.
      let termIn = 15000;
      if (process.env.TERMINATE_IN && parseInt(process.env.TERMINATE_IN) > 0) {
        termIn = parseInt(process.env.TERMINATE_IN);
      }
      setTimeout(function () {
        process.exit(0);
      }, termIn);
    });
  }
  return this;
};

// Inherit from EventEmitter
Object.setPrototypeOf(Cluster.prototype, EventEmitter.prototype);

Cluster.prototype.stopCluster = function (signal) {
  this.isShutdown = true;
  this.debug.log('Caught interrupt signal');
  if (this.settings.pid) {
    if (fs.existsSync(this.settings.pid)) {
      fs.unlinkSync(this.settings.pid);
    }
  }
  if (this.multipleInt) {
    // force termination on multiple SIGINT
    process.exit(0);
  }
  // send signal to all workers
  for (const id in cluster.workers) {
    process.kill(cluster.workers[id].process.pid, signal);
  }
  this.multipleInt = true;
};

Cluster.prototype.shutdownFunction = function () {
  this.debug.worker('shutdownFunction');
  this.webServer.stop(() => {
    this.debug.worker('disconnect worker');
    cluster.worker.disconnect();
  });

  // call singleton on stop if it is singleton process
  if (process.env.IS_SINGLETON) {
    if (this.settings.callbacks['singleton']) {
      this.settings.callbacks['singleton'](false, this.sharedData.singleton);
    }
  } else {
    if (this.settings.callbacks['shutdown']) {
      this.settings.callbacks['shutdown'](this.sharedData.init);
    }
  }
};

Cluster.prototype.debug = {
  log: debug('cluster:main'),
  debug: debug('cluster:debug'),
  worker: debug('cluster:worker'),
};

// Processed by tokens data structure
Cluster.prototype.settings = {};

export default Cluster;
