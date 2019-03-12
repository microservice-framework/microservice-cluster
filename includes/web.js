/**
 * Handle HTTP startup and shutdown.
 * Parse request and send answer.
 */
'use strict';

var http = require('http');
const debugF = require('debug');

const bind = function(fn, me) { return function() { return fn.apply(me, arguments); }; };


/**
 * Constructor.
 *   Prepare data for deploy.
 */
function WebServer(data) {
  // Use a closure to preserve `this`
  var self = this;
  self.data = data;

  this.RequestHandler = bind(this.RequestHandler, this);
  this.callbackExecutor = bind(this.callbackExecutor, this);

  self.server = http.createServer(self.RequestHandler);

  // Use random port if port settings is not provided.
  if (!self.data.port) {
    self.data.port = 0;
  }

  // Use address if provided.
  if (self.data.hostname) {
    self.server.listen(self.data.port, self.data.hostname);
  } else {
    self.server.listen(self.data.port);
  }

  self.server.on('listening', function() {
    self.debug.log('Listen on :%s', self.server.address().port);
  });
  self.server.on('clientError', function(err, socket) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  
}

// Processed by tokens data structure
WebServer.prototype.data = {};

WebServer.prototype.server = false;

/**
 * Process http request and collect POSt and PUT data.
 */
WebServer.prototype.RequestHandler = function(request, response) {
  var self = this;
  try {
    request.url = decodeURI(request.url);
  } catch (e) {
    self.debug.log('decodeURIfailed: %s: %s', request.url);
  }
  self.debug.log('Request: %s: %s', request.method, request.url);
  var _buffer = '';

  request.addListener('data', function(chunk) { _buffer += chunk; });
  request.addListener('end', function() {
    var requestDetails = {};
    requestDetails.url = request.url.substr(1);
    requestDetails.headers = request.headers;
    requestDetails._buffer = _buffer;
    requestDetails.method = request.method;
    requestDetails.remoteAddress = request.connection.remoteAddress
    let decodedData = false;

    if (_buffer != '') {
      self.debug.debug('Data: %s', _buffer);
      
      try {
        decodedData = self.decodeData(request.headers['content-type'], _buffer)
      } catch (e) {
        if (self.data.callbacks['responseHandler']) {
          return self.data.callbacks['responseHandler'](e, null, response, requestDetails);
        }
        response.writeHead(503, { 'content-type': 'application/json' });
        response.write(JSON.stringify({ error: e.message }, null, 2));
        response.end('\n');
        self.debug.debug('Error catched:\n %s', e.stack);
        return;
      }
    } else {
      decodedData = requestDetails.url;
    }
    if (self.data.callbacks.loader) {
      self.data.callbacks.loader(request.method, _buffer, requestDetails, function(err) {
        if (err) {
          if (!err.code) {
            err.code = 403;
          }
          if (self.data.callbacks['responseHandler']) {
            return self.data.callbacks['responseHandler'](err, null, response, requestDetails);
          }
          response.writeHead(err.code, { 'content-type': 'application/json' });
          response.write(JSON.stringify({ message: err.message }, null, 2));
          response.end('\n');
          self.debug.debug('Validation error: %s', err.message);
          return
        }
        return self.RequestValidate(request, response, _buffer, requestDetails, decodedData)
      })
      return
    }
    return self.RequestValidate(request, response, _buffer, requestDetails, decodedData)
  });
};

/**
 * decode buffer to specidied by content-type format.
 */
WebServer.prototype.decodeData = function(contentType, buffer){
  let data = false
  switch (contentType) {
    case undefined: // version 1.x compatibility. If no content-type provided, assume json.
    case 'application/json': {
      data = JSON.parse(buffer);
      break;
    }
    // Todo support more decoders here?
    default: {
      data = buffer
    }
  }
  return data
}

/**
 * Encode answer property if nesessary.
 */
WebServer.prototype.encodeHandlerResponseAnswer = function(handlerResponse){
  if (!handlerResponse.headers) {
    handlerResponse.headers = {};
  }

  if (!handlerResponse.headers['content-type']) {
    if (typeof handlerResponse.answer == 'string') {
      handlerResponse.headers['content-type'] = 'text/plain';
    } else {
      handlerResponse.headers['content-type'] = 'application/json';
    }
  }

  switch (handlerResponse.headers['content-type']) {
    case 'application/json': {
      handlerResponse.answer = JSON.stringify(handlerResponse.answer, null, 2)
      break;
    }
  }
}

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestValidate = function(request, response, _buffer, requestDetails, data) {
  var self = this;
  if (self.data.callbacks.validate) {
    self.data.callbacks.validate(request.method, _buffer, requestDetails, function(err) {
      if (err) {
        if (!err.code) {
          err.code = 403;
        }
        if (self.data.callbacks['responseHandler']) {
          return self.data.callbacks['responseHandler'](err, null, response, requestDetails);
        }
        response.writeHead(err.code, { 'content-type': 'application/json' });
        response.write(JSON.stringify({ message: err.message }, null, 2));
        response.end('\n');
        self.debug.debug('Validation error: %s', err.message);
        return;
      }
      return self.RequestProcess(request.method, response, requestDetails, data);
    });
    return;
  }
  return self.RequestProcess(request.method, response, requestDetails, data);
}

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestProcess = function(method, response, requestDetails, data) {
  var self = this;

  self.debug.debug('Parsed data: %O', data);
  try {
    if (self.data.callbacks[method]) {
      if (method == 'OPTIONS') {
        return self.data.callbacks[method](data, requestDetails, self.data.callbacks,
          function(err, handlerResponse) {
            self.callbackExecutor(err, handlerResponse, response, requestDetails);
          });
      }
      self.data.callbacks[method](data, requestDetails, function(err, handlerResponse) {
        self.callbackExecutor(err, handlerResponse, response, requestDetails);
      });
    } else {
      throw new Error(method + ' is not supported.');
    }
  } catch (e) {
    self.debug.debug('Error intersepted:\n %s', e.stack);
    e.code = 500;

    if (self.data.callbacks['responseHandler']) {
      return self.data.callbacks['responseHandler'](e, null, response, requestDetails);
    }
    response.writeHead(e.code, { 'content-type': 'application/json' });
    response.write(JSON.stringify({ error: e.message }, null, 2));
    response.end('\n');
  }
}

/**
 * Output answer from handlers.
 */
WebServer.prototype.callbackExecutor = function(err, handlerResponse, response, requestDetails) {
  var self = this;
  if (!response.connection) {
    if (err) {
      self.debug.log('Writing after socket is closed err: %O', err)  
    }
    self.debug.log('Writing after socket is closed handlerResponse: %O', handlerResponse)
    self.debug.log('Writing after socket is closed requestDetails: %O', requestDetails)
    return
  }

  if (self.data.callbacks['responseHandler']) {
    return self.data.callbacks['responseHandler'](err, handlerResponse, response, requestDetails);
  }
  
  if (err) {
    if (!err.code) {
      err.code = 503
    }
    self.debug.debug('Handler responce error:\n %O', err);
    response.writeHead(err.code, { 'content-type': 'application/json' });
    response.write(JSON.stringify({message: err.message }, null, 2));
    response.end('\n');
  } else {
    self.debug.debug('Handler responce:\n %O', handlerResponse);
    self.encodeHandlerResponseAnswer(handlerResponse)
    
    response.writeHead(handlerResponse.code, handlerResponse.headers);
    response.write(handlerResponse.answer);
    response.end('\n');
  }
}

/**
 * Process server stop request.
 */
WebServer.prototype.stop = function(callback) {
  var self = this;
  self.server.close(function() {
    self.debug.log('Worker stopped');
    callback()
  });
};

/**
 * Define debug methods.
 */
WebServer.prototype.debug = {
  log: debugF('http:log'),
  request: debugF('http:request'),
  debug: debugF('http:debug')
};

module.exports = WebServer;
