var _ = require('lodash');
var Promise = require('bluebird');
var sift = require('sift');
var async = require('async');

module.exports = {

  construct: function(self, options) {

    var optimizer = self.apos.modules['apostrophe-optimizer'];
    if (optimizer.options.stats) {
      optimizer.statsSoon();
    }

    var superLowLevelMongoCursor = self.lowLevelMongoCursor;

    self.optimizeKeys = [ '_id', 'slug', 'path' ];

    self.lowLevelMongoCursor = function(req, criteria, projection, options) {

      var docs;

      self.optimizeDiscoverQueries(req, criteria);

      if (!self.optimizeCompatible(req, criteria, projection, options)) {
        if (optimizer.options.debug) {
          optimizer.debug('cannot handle query due to constraints beyond optimized\nkeys for this req, kicking it over to MongoDB.\nNote: this logging call takes enough time to impact benchmarks,\ndo not enable debug and stats at the same time when comparing speed.', require('util').inspect(criteria, { depth: 20 }));
        }
        if (optimizer.options.stats) {
          optimizer.stats.direct++;
        }
        return superLowLevelMongoCursor(req, criteria, projection, options);
      }
      try {
        docs = self.optimizeFilterDocs(req, criteria, projection, options);
      } catch (e) {
        if (optimizer.options.debug) {
          optimizer.debug('cannot handle query due to sift limitation, kicking it over to MongoDB: ', e, require('util').inspect(criteria, { depth: 20 }));
        }
        if (optimizer.options.stats) {
          optimizer.stats.direct++;
        }
        return superLowLevelMongoCursor(req, criteria, projection, options);
      }

      // return a fake MongoDB cursor offering up the above docs.
      //
      // TODO: a more complete emulation, but this is what Apostrophe currently requires

      if (optimizer.options.stats) {
        optimizer.stats.optimized++;
      }

      return {
        toObject: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return callback(null, docs[0]);
          }
        },
        toArray: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return callback(null, docs);
          }
        },
        count: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return callback(null, docs.length);
          }
        }
      };
    };

    // Discovers simple, unique key-driven queries within the given criteria
    // object that set an outer bound on what that criteria object could return,
    // and adds them to req.optimize.nextQueries for future prefetches of
    // the current URL

    self.optimizeDiscoverQueries = function(req, criteria) {
      req.optimize = req.optimize || {};
      req.optimize.nextQueries = req.optimize.nextQueries || {};
      _.each(self.optimizeKeys, function(key) {
        var val = criteria[key];
        if (typeof(val) === 'string') {
          req.optimize.nextQueries[key] = req.optimize.nextQueries[key] || [];
          req.optimize.nextQueries[key].push(val);
        } else if (val && val.$in && Array.isArray(val.$in)) {
          req.optimize.nextQueries[key] = req.optimize.nextQueries[key] || [];
          req.optimize.nextQueries[key] = req.optimize.nextQueries[key].concat(val.$in);
        }
      });
      if (criteria.$and) {
        _.each(criteria.$and, function(clause) {
          self.optimizeDiscoverQueries(req, clause);
        });
      }
    };

    // Reject anything that isn't constrained by a query for a unique field value
    // present in req.optimize.queries.
    //
    // Also reject projections that use metafields we can't replicate
    // (we can't do text search without real mongo). We do not have to worry
    // about unsupported mongo operators in `sift` because sift will throw
    // an exception, which we catch in `optimizeFilterDocs`.

    self.optimizeCompatible = function(req, criteria, projection, options) {

      req.optimize = req.optimize || {};

      if (!req.optimize.queries) {
        return false;
      }

      return criteriaSafe(criteria) && projectionSafe();

      function criteriaSafe(criteria) {
        var safe = false;
        _.each(self.optimizeKeys, function(key) {
          if (!req.optimize.queries[key]) {
            return false;
          }
          var val = criteria[key];
          if ((typeof val) === 'string') {
            if (_.includes(req.optimize.queries[key], val)) {
              safe = true;
              return false;
            }
          } else if (val && val.$in && Array.isArray(val.$in)) {
            if (_.difference(val.$in, req.optimize.queries[key]).length === 0) {
              safe = true;
              return false;
            }
          }  
        });
        if (criteria.$and) {
          _.each(criteria.$and, function(clause) {
            if (criteriaSafe(clause)) {
              safe = true;
              return false;
            }
          });
        }
        // We could do $or (every subclause must be safe), but
        // I don't think every subclause will be safe very often. -Tom
        return safe;
      }

      function projectionSafe() {
        return self.optimizeProjectionSafe(projection);
      }

    };
  
    // May throw an exception if the implementation cannot support some of
    // the criteria (sift will throw an exception on unknown operators).

    self.optimizeFilterDocs = function(req, criteria, projection, options) {
      var docs;
      docs = sift(criteria, (req.optimize && req.optimize.docs) || []);
      if (_.isNumber(options.skip)) {
        docs = docs.slice(options.skip);
      }
      if (_.isNumber(options.limit)) {
        docs = docs.slice(0, options.limit);
      }
      self.optimizeSort(docs, options.sort);
      if (projection) {
        docs = self.optimizeProjection(docs, projection);
      }
      // "Why are we cloning?" Because we would otherwise return the same
      // objects from multiple queries, which might modify them differently
      // with no expectation of side effects.
      //
      // "Why with this method?" Because we already trust it to cope with
      // all types of content stored to the database in Apostrophe. 
      return self.apos.utils.clonePermanent(docs);
    };

    // Carry out projection in a MongoDB-compatible way
    // (subject to limitations detectable beforehand by
    // optimizeProjectionSafe)

    self.optimizeProjection = function(docs, projection) {
      if (_.values(projection)[0]) {
        return _.map(docs, function(doc) {
          return _.pick(doc, _.keys(projection));
        });
      } else {
        return _.map(docs, function(doc) {
          return _.omit(doc, _.keys(projection));
        });
      }
    };

    // Returns true if the projection can be safely handled by the
    // `optimizeProjection` method, otherwise you should fall back
    // to MongoDB native
    self.optimizeProjectionSafe = function(projection) {
      var result = !_.some(_.keys(projection), function(key) {
        // All projection values must be simple flags, objects imply something
        // fancy like $meta is going on
        return projection[key] && ((typeof projection[key]) === 'object');
      });
      return result;
    };

    // MongoDB-compatible sorting. See the MongoDB `sort` method.
    self.optimizeSort = function(docs, sort) {
      return docs.sort(function(a, b) {
        var keys = _.keys(sort);
        var i;
        for (i = 0; (i < keys.length); i++) {
          var av = a[keys[i]];
          var bv = b[keys[i]];
          if (sort[keys[i]] < 0) {
            if (av < bv) {
              return 1;
            } else if (av > bv) {
              return -1;
            }
          } else {
            if (av < bv) {
              return -1;
            } else if (av > bv) {
              return 1;
            }
          }
        }
        // equal according to all criteria
        return 0;
      });

    };

  }

};
