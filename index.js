var _ = require('lodash');
var now = require('performance-now');
var Promise = require('bluebird');

module.exports = {

  construct: function(self, options) {

    if (self.options.enable !== false) {

      self.queries = {};

      self.expressMiddleware = {
        before: 'apostrophe-global',
        middleware: function(req, res, next) {
          // So you can make queries that don't try to use the prefetched docs
          // and can see changes made during the lifetime of `req`
          req.deoptimize = function() {
            req.optimizeDocs = null;
          };
          req.optimize = req.optimize || {};
          req.optimize.key = req.url;
          // chance to modify req.optimize.key, for instance to take
          // locales into account
          self.apos.emit('optimizeKey', req);
          var queries = self.queries[req.optimize.key];
          if (!queries) {
            return next();
          }
          req.optimize.queries = queries;
          var clauses = [];
          _.each(queries, function(query, locale) {
            _.each(query, function(values, key) {
              var clause = {};
              clause[key] = { $in: values };
              if (locale !== '__none') {
                clause.$or = [
                  {
                    workflowLocale: locale
                  },
                  {
                    workflowLocale: { $exists: 0 }
                  }
                ];
              }
              clauses.push(clause);
            });
          });
          if (!clauses.length) {
            return next();
          }
          // console.log(JSON.stringify(clauses, null, '  '));
          return self.apos.docs.db.find({ $or: clauses }).toArray(function(err, docs) {
            if (err) {
              self.apos.utils.error('apostrophe-optimizer: error prefetching related docs, nonfatal: ', err);
              return next();
            }
            self.debug('docs retrieved by optimizer: ', _.map(docs, function(doc) {
              return _.pick(doc, '_id', 'slug', 'path');
            }));
            req.optimize.docs = docs;
            return next();
          });
        }
      };

      self.debug = function(msg) {
        if (!self.options.debug) {
          return;
        }
        msg = 'apostrophe-optimizer: ' + msg;
        self.apos.utils.debug.apply(self, [ msg ].concat([].slice.call(arguments, 1)));
      };

      self.pageBeforeSend = function(req) {
        if (req.optimize && req.optimize.key) {
          self.queries[req.optimize.key] = req.optimize.nextQueries;
        }
      };

      self.apos.define('apostrophe-cursor', require('./lib/cursor.js'));
    }

    if (self.options.stats) {
      if (!self.stats) {
        self.stats = {
          direct: 0,
          aggregating: 0,
          optimized: 0,
          mongoFindMS: 0,
          mongoFindCount: 0,
          mongoAggregateMS: 0,
          mongoAggregateCount: 0,
          jsMS: 0
        };
      }
      var superFind = self.apos.docs.db.find;
      self.apos.docs.db.find = function() {
        var cursor = superFind.apply(this, arguments);
        var superToArray = cursor.toArray;
        cursor.toArray = function(callback) {
          if (self.options.latency) {
            setTimeout(function() {
              if (callback) {
                return body(callback);
              } else {
                return Promise.promisify(body)();
              }
              // x2 to simulate latency both coming and going
            }, self.options.latency * 2 + ((self.options.latency * 2) || 0));
            return;
          }
          if (callback) {
            return body(callback);
          } else {
            return Promise.promisify(body)();
          }
          function body(callback) {
            var start = now();
            return superToArray.call(cursor, function(err, docs) {
              if (err) {
                return callback(err);
              }
              self.stats.mongoFindMS += (now() - start);
              self.stats.mongoFindCount++;
              self.statsSoon();
              return callback(null, docs);
            });
          }
        };
        var superCount = cursor.count;
        cursor.count = function(callback) {
          if (self.options.latency) {
            setTimeout(function() {
              if (callback) {
                return body(callback);
              } else {
                return Promise.promisify(body)();
              }
              // x2 to simulate latency both coming and going
            }, self.options.latency * 2);
            return;
          }
          if (callback) {
            return body(callback);
          } else {
            return Promise.promisify(body)();
          }
          function body(callback) {
            var start = now();
            return superCount.call(cursor, function(err, count) {
              if (err) {
                return callback(err);
              }
              self.stats.mongoFindMS += (now() - start) + ((self.options.latency * 2) || 0);
              self.stats.mongoFindCount++;
              self.statsSoon();
              return callback(null, count);
            });
          }
        };
        return cursor;
      };
      var superAggregate = self.apos.docs.db.aggregate;
      self.apos.docs.db.aggregate = function() {
        var cursor = superAggregate.apply(this, arguments);
        var superToArray = cursor.toArray;
        cursor.toArray = function(callback) {
          if (self.options.latency) {
            setTimeout(function() {
              if (callback) {
                return body(callback);
              } else {
                return Promise.promisify(body)();
              }
              // x2 to simulate latency both coming and going
            }, self.options.latency * 2);
            return;
          }
          if (callback) {
            return body(callback);
          } else {
            return Promise.promisify(body)();
          }
          function body(callback) {
            var start = now();
            return superToArray.call(cursor, function(err, docs) {
              if (err) {
                return callback(err);
              }
              self.stats.mongoAggregateMS += (now() - start) + ((self.options.latency * 2) || 0);
              self.stats.mongoAggregateCount++;
              self.statsSoon();
              return callback(null, docs);
            });
          }
        };
        return cursor;
      };

      self.statsSoon = function() {
        if (!self.statsTimeout) {
          self.statsTimeout = setTimeout(function() {
            self.apos.utils.debug(self.stats);
            self.statsTimeout = false;
          }, 2000);
        }
      };

    }
  }
};
