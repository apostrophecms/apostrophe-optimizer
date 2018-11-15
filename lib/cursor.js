var _ = require('lodash');
var Promise = require('bluebird');
var sift = require('sift');
var now = require('performance-now');

module.exports = {

  construct: function(self, options) {

    var optimizer = self.apos.modules['apostrophe-optimizer'];
    if (optimizer.options.stats) {
      optimizer.statsSoon();
    }

    var superLowLevelMongoCursor = self.lowLevelMongoCursor;

    self.optimizeKeys = [ '_id', 'slug', 'path' ];

    self.lowLevelMongoCursor = function(req, criteria, projection, options) {

      if (!req.optimize) {
        // Probably a task, leave it alone.
        return superLowLevelMongoCursor(req, criteria, projection, options);
      }

      var docs;

      self.optimizeDiscoverQueries(req, criteria);

      if (!req.optimize.queries) {
        optimizer.debug('No queries optimized for this URL yet, asking MongoDB');
        return direct();
      }

      if (!self.optimizeCompatible(req, criteria, projection, options)) {
        optimizer.debug('optimizeCompatible says no, cannot handle query due to constraints beyond optimized\nkeys for this req, kicking it over to MongoDB.\nNote: this logging call takes enough time to impact benchmarks,\ndo not enable debug and stats at the same time when comparing speed.', require('util').inspect(criteria, { depth: 20 }));
        return direct();
      }
      try {
        var start;
        if (optimizer.options.stats) {
          start = now();
        }
        docs = self.optimizeFilterDocs(req, criteria, projection, options);
        if (optimizer.options.stats) {
          optimizer.stats.jsMS += (now() - start);
        }
      } catch (e) {
        optimizer.debug('exception thrown in optimizeFilterDocs, cannot handle query due to sift limitation, kicking it over to MongoDB: ', e, require('util').inspect(criteria, { depth: 20 }));
        return direct();
      }

      // return a fake MongoDB cursor offering up the above docs.
      //
      // TODO: a more complete emulation, but this is what Apostrophe currently requires

      if (optimizer.options.stats) {
        optimizer.stats.optimized++;
      }

      return {
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

      function direct() {
        if (optimizer.options.stats) {
          optimizer.stats.direct++;
        }
        return superLowLevelMongoCursor(req, criteria, projection, options);
      }
    };

    // Discovers simple, unique key-driven queries within the given criteria
    // object that set an outer bound on what that criteria object could return,
    // and adds them to req.optimize.nextQueries for future prefetches of
    // the current URL

    self.optimizeDiscoverQueries = function(req, criteria) {
      req.optimize = req.optimize || {};
      req.optimize.nextQueries = req.optimize.nextQueries || {};

      var locale = self.optimizeDiscoverQueryLocale(req, criteria) || '__none';
      req.optimize.nextQueries[locale] = req.optimize.nextQueries[locale] || {};

      discoverKeys(criteria);

      function discoverKeys(criteria) {
        _.each(self.optimizeKeys, function(key) {
          var val = criteria[key];
          if (typeof (val) === 'string') {
            req.optimize.nextQueries[locale][key] = req.optimize.nextQueries[locale][key] || [];
            req.optimize.nextQueries[locale][key].push(val);
          } else if (val && val.$in && Array.isArray(val.$in)) {
            req.optimize.nextQueries[locale][key] = req.optimize.nextQueries[locale][key] || [];
            req.optimize.nextQueries[locale][key] = req.optimize.nextQueries[locale][key].concat(val.$in);
          }
        });
        if (criteria.$and) {
          _.each(criteria.$and, function(clause) {
            discoverKeys(clause);
          });
        }
      }
    };

    // If workflow is in play it can be a big perf win to constrain queries by slug and path
    // by locale, if this was done in the original query
    self.optimizeDiscoverQueryLocale = function(req, criteria) {
      var locale;
      // Detect the special $in clause that checks for a locale, or for a doc that doesn't have a locale
      if (criteria.workflowLocale && criteria.workflowLocale.$in) {
        return criteria.workflowLocale.$in[0];
      }
      // Detect exact string match for workflow locale
      if (criteria.workflowLocale && ((typeof criteria.workflowLocale) === 'string')) {
        return '=' + criteria.workflowLocale;
      }
      if (criteria.$and) {
        _.each(criteria.$and, function(clause) {
          locale = self.optimizeDiscoverQueryLocale(req, clause);
          if (locale) {
            return false;
          }
        });
      }
      return locale;
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
        // for bc, the main call to this method now checks this directly
        return false;
      }

      if (criteriaSafe(criteria)) {
        if (projectionSafe()) {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }

      function criteriaSafe(criteria, locale) {
        locale = locale || self.optimizeDiscoverQueryLocale(req, criteria) || '__none';
        var safe = false;
        _.each(self.optimizeKeys, function(key) {
          var val = criteria[key];
          if ((typeof val) === 'string') {
            if (_.includes(req.optimize.queries[locale][key], val)) {
              safe = true;
              return false;
            }
          } else if (val && val.$in && Array.isArray(val.$in)) {
            if (_.difference(val.$in, req.optimize.queries[locale][key]).length === 0) {
              safe = true;
              return false;
            }
          }
        });
        if (criteria.$and) {
          _.each(criteria.$and, function(clause) {
            if (criteriaSafe(clause, locale)) {
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

    // Filter the given docs with the given criteria, projection, options.sort, options.skip
    // and options.limit. Returns a deep clone so you may safely modify your copy.
    // May throw an exception if the implementation cannot support some of
    // the criteria (sift will throw an exception on unknown operators). If
    // the module-level `tagOptimized` option is true, an `__optimized: true` flag
    // is set on the returned docs.

    self.optimizeFilterDocs = function(req, criteria, projection, options) {
      var docs;
      docs = sift(criteria, (req.optimize && req.optimize.docs) || []);
      self.optimizeSort(docs, options.sort);
      if (_.isNumber(options.skip)) {
        docs = docs.slice(options.skip);
      }
      if (_.isNumber(options.limit)) {
        docs = docs.slice(0, options.limit);
      }
      if (projection) {
        docs = self.optimizeProjection(docs, projection);
      }
      // "Why are we cloning?" Because we would otherwise return the same
      // objects from multiple queries, which might modify them differently
      // with no expectation of side effects.
      //
      // "Why with this method?" Because we already trust it to cope with
      // all types of content stored to the database in Apostrophe.
      docs = self.apos.utils.clonePermanent(docs);
      if (optimizer.options.tagOptimized) {
        _.each(docs, function(doc) {
          doc.__optimized = true;
        });
      }
      return docs;
    };

    // Carry out projection in a MongoDB-compatible way
    // (subject to limitations detectable beforehand by
    // optimizeProjectionSafe)

    self.optimizeProjection = function(docs, projection) {
      if (_.values(projection)[0]) {
        return _.map(docs, function(doc) {
          var after = _.pick(doc, _.keys(projection));
          after._id = doc._id;
          return after;
        });
      } else {
        return _.map(docs, function(doc) {
          var after = _.omit(doc, _.keys(projection));
          after._id = doc._id;
          return after;
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
